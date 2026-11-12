import {
  type Database,
  type RequestContext,
  type TenantScopedDatabase,
  withTenant,
} from '@odudu/db';
import { breachedPasswordRepository } from '#/repository/breached-passwords';
import {
  BreachedLookupFailed,
  judgeBreached,
  sourceOfOutcome,
  type BreachedSettings,
  type BreachedVerdict,
  type RemoteOutcome,
} from '#/service/breached-password';
import {
  concurrencyLimiter,
  REMOTE_BREACHED_CONCURRENCY_PER_TENANT,
  REMOTE_BREACHED_PROCESS_CAP,
  remoteBreachedSource,
  type RangeFetch,
} from '#/service/breached-range-source';

/** What `prepare` learned before the writing transaction opened. */
export interface BreachedPrepared {
  settings: BreachedSettings;
  /** Set only for a remote tenant. */
  remote: RemoteOutcome | null;
}

/**
 * Judges a candidate that already passed the tenant's other password rules, in
 * two parts so that no pooled connection spans a network call: `prepare` reads
 * the settings in a transaction of its own, releases it, and only then asks a
 * remote service; `judge` runs inside the writing transaction and does at most
 * one primary-key read.
 */
export interface BreachedPasswordCheck {
  prepare(
    database: Database,
    tenantId: string,
    password: string,
    request?: RequestContext,
  ): Promise<BreachedPrepared>;
  judge(
    tx: TenantScopedDatabase,
    tenantId: string,
    password: string,
    prepared: BreachedPrepared,
  ): Promise<BreachedVerdict>;
  /** Both parts, the second in a short transaction of its own, for a writer with none open. */
  run(
    database: Database,
    tenantId: string,
    password: string,
    request?: RequestContext,
  ): Promise<BreachedVerdict>;
}

export interface BreachedPasswordCheckDeps {
  fetchRange: RangeFetch;
  concurrencyPerTenant?: number;
  concurrencyInProcess?: number;
}

export function createBreachedPasswordCheck(
  deps: BreachedPasswordCheckDeps,
): BreachedPasswordCheck {
  const limiter = concurrencyLimiter(
    deps.concurrencyPerTenant ?? REMOTE_BREACHED_CONCURRENCY_PER_TENANT,
  );
  const processLimiter = concurrencyLimiter(
    deps.concurrencyInProcess ?? REMOTE_BREACHED_PROCESS_CAP,
  );

  const prepare: BreachedPasswordCheck['prepare'] = async (
    database,
    tenantId,
    password,
    request,
  ) => {
    const settings = await withTenant(
      database,
      tenantId,
      (tx) => breachedPasswordRepository(tx).settings(tenantId),
      request,
    );
    if (settings.check !== 'remote') return { settings, remote: null };
    try {
      const breached = await remoteBreachedSource({
        tenantId,
        fetchRange: deps.fetchRange,
        limiter,
        processLimiter,
      }).isBreached(password);
      return { settings, remote: { kind: 'answered', breached } };
    } catch (err) {
      if (!(err instanceof BreachedLookupFailed)) throw err;
      return { settings, remote: { kind: 'failed' } };
    }
  };

  const judge: BreachedPasswordCheck['judge'] = async (tx, _tenantId, password, prepared) => {
    const repository = breachedPasswordRepository(tx);
    const verdict = await judgeBreached(
      prepared.settings,
      {
        dataset: () => repository.datasetSource(),
        remote: () => sourceOfOutcome(prepared.remote),
      },
      password,
    );
    if (verdict.audit === 'passed' && prepared.settings.check === 'dataset') {
      if (await repository.datasetIsEmpty()) return { audit: 'dataset_empty', violations: [] };
    }
    return verdict;
  };

  return {
    prepare,
    judge,
    async run(database, tenantId, password, request) {
      const prepared = await prepare(database, tenantId, password, request);
      return withTenant(
        database,
        tenantId,
        (tx) => judge(tx, tenantId, password, prepared),
        request,
      );
    },
  };
}
