import { tenants, type Database } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { clientOidcConfig } from '#/schema/client-oidc-config';
import { TOKEN_EXCHANGE_GRANT } from '#/service/token-exchange';

export const EXCHANGE_UPGRADE_SAMPLE_LIMIT = 20;
export const EXCHANGE_UPGRADE_COUNT_CAP = 10_000;

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

export async function publicExchangeClientsAtRisk(db: Database): Promise<ExchangeUpgradeFinding> {
  const capped = db
    .select({ one: sql<number>`1`.as('one') })
    .from(clientOidcConfig)
    .where(AT_RISK)
    .limit(EXCHANGE_UPGRADE_COUNT_CAP)
    .as('capped');
  const [counted] = await db.select({ n: sql<number>`count(*)::int` }).from(capped);
  const rows = await db
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

  const names = await db
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
    count: counted?.n ?? rows.length,
    sample: rows.map((row) => ({
      tenant: nameOf.get(row.tenantId) ?? row.tenantId,
      clientId: row.clientId,
    })),
  };
}
