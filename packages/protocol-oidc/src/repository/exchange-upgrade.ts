import { tenants, type Database } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { clientOidcConfig } from '#/schema/client-oidc-config';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';

export const EXCHANGE_UPGRADE_SAMPLE_LIMIT = 20;
export const EXCHANGE_UPGRADE_COUNT_CAP = 10_000;
export const EXCHANGE_UPGRADE_STATEMENT_TIMEOUT_MS = 4_000;

export interface ExchangeUpgradeFinding {
  readonly count: number;
  readonly sample: readonly { tenant: string; clientId: string }[];
}

// Public clients that hold the token-exchange grant while their exchange
// setting is off: the ones an upgrade silently stopped. Read across tenants
// with the owner connection. `is_public_client` is in the partial index
// `client_oidc_config_exchange_closed`, so both reads walk exactly the
// at-risk set and stop at their bound: the count at the cap, the sample at its
// limit. A disabled client is counted too, since the index cannot hold a
// setting that changes.
const AT_RISK = and(
  eq(clientOidcConfig.isPublicClient, true),
  eq(clientOidcConfig.tokenExchangeAllowedForPublic, false),
  sql`${clientOidcConfig.grantTypes} @> ARRAY[${TOKEN_EXCHANGE_GRANT}]::text[]`,
);

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

// Both reads of the boot check run in one transaction the database itself
// ends after `ms`, so a slow read frees the connection instead of running on
// after the caller has stopped waiting for it.
export function withStatementTimeout<T>(
  db: Database,
  ms: number,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('statement_timeout', ${String(ms)}, true)`);
    return fn(tx);
  });
}

// The count is read apart from the sample, so a row landing between them
// must not leave it below the clients already named.
export function boundedCount(counted: number | undefined, sampled: number): number {
  return Math.max(counted ?? 0, sampled);
}

export function publicExchangeClientsAtRisk(db: Database): Promise<ExchangeUpgradeFinding> {
  return withStatementTimeout(db, EXCHANGE_UPGRADE_STATEMENT_TIMEOUT_MS, (tx) => read(tx));
}

async function read(tx: Transaction): Promise<ExchangeUpgradeFinding> {
  const capped = tx
    .select({ one: sql<number>`1`.as('one') })
    .from(clientOidcConfig)
    .where(AT_RISK)
    .limit(EXCHANGE_UPGRADE_COUNT_CAP)
    .as('capped');
  const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(capped);
  const rows = await tx
    .select({
      tenantId: clientOidcConfig.tenantId,
      clientId: clients.clientId,
    })
    .from(clientOidcConfig)
    .innerJoin(clients, eq(clients.id, clientOidcConfig.clientId))
    .where(AT_RISK)
    .orderBy(asc(clientOidcConfig.tenantId), asc(clientOidcConfig.clientId))
    .limit(EXCHANGE_UPGRADE_SAMPLE_LIMIT);
  if (rows.length === 0) return { count: 0, sample: [] };

  const names = await tx
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(
      inArray(
        tenants.id,
        rows.map((row) => row.tenantId),
      ),
    );
  const nameOf = new Map(names.map((tenant) => [tenant.id, tenant.name]));
  return {
    count: boundedCount(counted?.n, rows.length),
    sample: rows.map((row) => ({
      tenant: nameOf.get(row.tenantId) ?? row.tenantId,
      clientId: row.clientId,
    })),
  };
}
