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
// with the owner connection; both reads walk the partial index
// `client_oidc_config_exchange_closed` and stop at their bound, the count at
// the cap and the sample at its limit, so a deployment of 10,000 tenants
// reads at most the cap's rows however many are stranded.
export async function publicExchangeClientsAtRisk(db: Database): Promise<ExchangeUpgradeFinding> {
  const stranded = db
    .select({
      tenantId: clientOidcConfig.tenantId,
      clientDbId: clientOidcConfig.clientId,
      clientId: clients.clientId,
    })
    .from(clientOidcConfig)
    .innerJoin(clients, eq(clients.id, clientOidcConfig.clientId))
    .where(
      and(
        eq(clients.type, 'public'),
        eq(clientOidcConfig.tokenExchangeAllowedForPublic, false),
        sql`${clientOidcConfig.grantTypes} @> ARRAY[${TOKEN_EXCHANGE_GRANT}]::text[]`,
      ),
    )
    .orderBy(asc(clientOidcConfig.tenantId), asc(clientOidcConfig.clientId));

  const counted = await db
    .select({ one: sql<number>`1`.as('one') })
    .from(stranded.limit(EXCHANGE_UPGRADE_COUNT_CAP).as('stranded'));
  const rows = await stranded.limit(EXCHANGE_UPGRADE_SAMPLE_LIMIT);
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
    count: counted.length,
    sample: rows.map((row) => ({
      tenant: nameOf.get(row.tenantId) ?? row.tenantId,
      clientId: row.clientId,
    })),
  };
}
