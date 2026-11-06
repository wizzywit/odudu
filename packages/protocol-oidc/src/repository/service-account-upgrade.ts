import { tenants, type Database } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { asc, eq, inArray, sql } from 'drizzle-orm';
import {
  boundedCount,
  withStatementTimeout,
  EXCHANGE_UPGRADE_STATEMENT_TIMEOUT_MS,
  type ExchangeUpgradeFinding,
} from '#/repository/exchange-upgrade';

export const IDLE_ACCOUNT_SAMPLE_LIMIT = 20;
export const IDLE_ACCOUNT_COUNT_CAP = 10_000;

export type IdleAccountFinding = ExchangeUpgradeFinding;

// Clients that hold a service account without the client_credentials grant:
// the ones migration 0122_service_accounts_by_grant.sql left standing because
// something still names the account. Read across tenants with the owner
// connection. `clients_idle_service_account` holds exactly these rows and the
// marker is cleared when an account is retired, so both reads walk the set
// and stop at their bounds: the count at the cap, the sample at its limit.
export function idleServiceAccounts(db: Database): Promise<IdleAccountFinding> {
  return withStatementTimeout(db, EXCHANGE_UPGRADE_STATEMENT_TIMEOUT_MS, async (tx) => {
    const capped = tx
      .select({ one: sql<number>`1`.as('one') })
      .from(clients)
      .where(eq(clients.serviceAccountIdle, true))
      .limit(IDLE_ACCOUNT_COUNT_CAP)
      .as('capped');
    const [counted] = await tx.select({ n: sql<number>`count(*)::int` }).from(capped);
    const rows = await tx
      .select({ tenantId: clients.tenantId, clientId: clients.clientId })
      .from(clients)
      .where(eq(clients.serviceAccountIdle, true))
      .orderBy(asc(clients.tenantId), asc(clients.id))
      .limit(IDLE_ACCOUNT_SAMPLE_LIMIT);
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
  });
}
