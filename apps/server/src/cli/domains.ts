import {
  bypassesRowLevelSecurity,
  createDatabase,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import {
  DEFAULT_LOOKUP_TIMEOUT_MS,
  dnsChallengeResolver,
  recheckDomains,
  tenantDomainRepository,
  verifiedDomainPage,
  type RecheckReport,
  type ResolveTxt,
} from '@odudu/domain-tenant';
import { loadConfig, OduduError, type Config } from '@odudu/kernel';
import { sql } from 'drizzle-orm';

/** Own key, distinct from `REAP_LOCK_KEY`: the two passes never wait on each other. */
export const DOMAIN_RECHECK_LOCK_KEY = 20_261_104;

// Lookups in flight at once and verified rows read per page; the per-lookup
// timeout is the resolver adapter's own default.
const LOOKUP_CONCURRENCY = 32;
const PAGE_SIZE = 500;

export interface DomainRecheckOptions {
  readonly threshold: number;
  readonly base: string;
  readonly tls: boolean;
  readonly timeoutMs?: number;
  readonly concurrency?: number;
  readonly pageSize?: number;
}

/** Undefined without a public base URL: no domain can be registered then. */
export function domainRecheckOptionsFromConfig(config: Config): DomainRecheckOptions | undefined {
  if (config.ODUDU_PUBLIC_BASE_URL === undefined) return undefined;
  return {
    threshold: config.ODUDU_DOMAIN_RECHECK_FAILURES,
    base: config.ODUDU_PUBLIC_BASE_URL,
    tls: config.ODUDU_TLS,
  };
}

export interface DomainRecheckDeps {
  /** The serving, row-level-security-constrained connection: every write. */
  readonly database: DatabaseHandle;
  /**
   * The owner connection, for one read: the verified rows of every tenant,
   * which no tenant context can see.
   */
  readonly ownerDatabase: DatabaseHandle;
  readonly resolveTxt?: ResolveTxt;
  /** Fires with the lock result, so a test can hold a winner open. */
  readonly onLockAttempt?: (acquired: boolean) => Promise<void> | void;
}

export type DomainRecheckOutcome =
  { readonly ran: false; readonly reason: string } | ({ readonly ran: true } & RecheckReport);

async function assertRolesAreRight(deps: DomainRecheckDeps): Promise<void> {
  if (!(await bypassesRowLevelSecurity(deps.ownerDatabase))) {
    throw new OduduError(
      'domain_recheck_cannot_read_every_tenant',
      'the domain recheck must read verified domains on a connection that bypasses ' +
        'row-level security; ODUDU_DATABASE_URL names a role that is neither SUPERUSER nor BYPASSRLS',
    );
  }
  if (await bypassesRowLevelSecurity(deps.database)) {
    throw new OduduError(
      'domain_recheck_serving_role_bypasses_rls',
      'the domain recheck writes under the tenant policy, so its serving connection must be ' +
        'subject to it; ODUDU_APP_DATABASE_URL names a SUPERUSER or BYPASSRLS role',
    );
  }
}

interface LockRow {
  got: boolean;
}

/**
 * Rechecks every verified domain under one advisory lock, so replicas and an
 * external schedule never run the pass twice at once. The lock transaction
 * does nothing else: the pass reads and writes on connections of its own.
 */
export async function recheckDomainsLocked(
  deps: DomainRecheckDeps,
  now: Date,
  options: DomainRecheckOptions,
): Promise<DomainRecheckOutcome> {
  await assertRolesAreRight(deps);
  const resolveTxt =
    deps.resolveTxt ??
    dnsChallengeResolver({ timeoutMs: options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS });
  return deps.database.db.transaction(async (lock): Promise<DomainRecheckOutcome> => {
    const rows = await lock.execute(
      sql`select pg_try_advisory_xact_lock(${DOMAIN_RECHECK_LOCK_KEY}::bigint) as got`,
    );
    const acquired = (rows as unknown as LockRow[])[0]?.got === true;
    await deps.onLockAttempt?.(acquired);
    if (!acquired) return { ran: false, reason: 'another instance holds the recheck lock' };
    const report = await recheckDomains(
      {
        resolveTxt,
        domains: {
          page: (after, limit) => verifiedDomainPage(deps.ownerDatabase.db, after, limit),
          inTenant: (tenantId, fn) =>
            withTenant(deps.database.db, tenantId, (tx) =>
              fn({
                domains: tenantDomainRepository(tx),
                audit: (event) =>
                  auditRepository(tx).record({
                    eventType: 'admin_mutation',
                    action: event.action,
                    outcome: 'failed',
                    resourceType: 'domain',
                    resourceId: event.resourceId,
                    detail: event.detail,
                  }),
              }),
            ),
        },
        timeoutMs: options.timeoutMs ?? DEFAULT_LOOKUP_TIMEOUT_MS,
        concurrency: options.concurrency ?? LOOKUP_CONCURRENCY,
        pageSize: options.pageSize ?? PAGE_SIZE,
        threshold: options.threshold,
        base: options.base,
        tls: options.tls,
      },
      now,
    );
    return { ran: true, ...report };
  });
}

// `odudu domains recheck`: reads its own configuration and opens its own
// connections, like `odudu reap`, so a cron entry or a Kubernetes Job can run it.
export async function domainsCommand(argv: readonly string[]): Promise<DomainRecheckOutcome> {
  const [subcommand] = argv;
  if (subcommand !== 'recheck') {
    throw new OduduError(
      'domains_unknown_command',
      `unknown domains subcommand ${JSON.stringify(subcommand)}; expected recheck`,
    );
  }
  const config = loadConfig();
  const appUrl = config.ODUDU_APP_DATABASE_URL;
  if (appUrl === undefined) {
    throw new OduduError(
      'domain_recheck_requires_app_database_url',
      'domains recheck requires ODUDU_APP_DATABASE_URL: its writes run under the tenant ' +
        'policy, which the owner role the migrations use escapes',
    );
  }
  const options = domainRecheckOptionsFromConfig(config);
  if (options === undefined) {
    return { ran: false, reason: 'ODUDU_PUBLIC_BASE_URL is unset, so no domain can be served' };
  }

  const owner = createDatabase(config.ODUDU_DATABASE_URL);
  const runtime = createDatabase(appUrl);
  try {
    return await recheckDomainsLocked(
      { database: runtime, ownerDatabase: owner },
      new Date(),
      options,
    );
  } finally {
    await runtime.close();
    await owner.close();
  }
}
