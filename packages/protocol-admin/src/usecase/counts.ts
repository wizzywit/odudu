import { type CountResponse } from '@odudu/contracts/admin';
import { tenants, type Database, type TenantScopedDatabase } from '@odudu/db';
import { groups, roles } from '@odudu/domain-authz';
import { clients, clientScopes } from '@odudu/domain-tenant';
import { and, count, sql, type SQL } from 'drizzle-orm';
import { clientListConditions, clientListOrder, type ClientFilters } from '#/usecase/clients';
import { groupListConditions, groupListOrder, type GroupFilters } from '#/usecase/groups';
import { roleListConditions, roleListOrder, type RoleFilters } from '#/usecase/roles';
import { scopeListConditions, scopeListOrder, type ScopeFilters } from '#/usecase/scopes';
import {
  subjectListConditions,
  subjectListOrder,
  subjectListRows,
  type SubjectFilters,
} from '#/usecase/subjects';
import { tenantListConditions, tenantListOrder, type TenantFilters } from '#/usecase/tenants';

// Counting stops one row past this, so a count reads at most that many
// rows however large the collection, and says `capped` rather than guess.
// Each count is its list's own statement — WHERE, joins and ORDER BY —
// with a larger LIMIT: without the order the planner may filter a
// sequential scan and hope to reach the LIMIT early, which is unbounded
// when the matches are sparse (tests/list-plans.int.test.ts holds this).
export const COUNT_CAP = 10_000;

export interface CountOptions {
  readonly cap?: number;
}

const ONE = sql<number>`1`.as('one');

function whereOf(conditions: SQL[]): SQL | undefined {
  return conditions.length === 0 ? undefined : and(...conditions);
}

function bounded(rows: readonly { readonly n: number }[], cap: number): CountResponse {
  const n = rows[0]?.n ?? 0;
  return { count: Math.min(n, cap), capped: n > cap };
}

export async function countSubjects(
  tx: TenantScopedDatabase,
  filters: SubjectFilters,
  options: CountOptions = {},
): Promise<CountResponse> {
  const cap = options.cap ?? COUNT_CAP;
  const matching = subjectListRows(tx, { one: ONE })
    .where(whereOf(await subjectListConditions(tx, filters, undefined)))
    .orderBy(...subjectListOrder(filters))
    .limit(cap + 1)
    .as('matching');
  return bounded(await tx.select({ n: count() }).from(matching), cap);
}

// Read through the owner connection, as the tenants listing is.
export async function countTenants(
  database: Database,
  filters: TenantFilters,
  options: CountOptions = {},
): Promise<CountResponse> {
  const cap = options.cap ?? COUNT_CAP;
  const matching = database
    .select({ one: ONE })
    .from(tenants)
    .where(whereOf(await tenantListConditions(database, filters, undefined)))
    .orderBy(...tenantListOrder(filters))
    .limit(cap + 1)
    .as('matching');
  return bounded(await database.select({ n: count() }).from(matching), cap);
}

export async function countClients(
  tx: TenantScopedDatabase,
  filters: ClientFilters,
  options: CountOptions = {},
): Promise<CountResponse> {
  const cap = options.cap ?? COUNT_CAP;
  // No join: client_oidc_config is a 1:1 extension every creation path writes.
  const matching = tx
    .select({ one: ONE })
    .from(clients)
    .where(whereOf(await clientListConditions(tx, filters, undefined)))
    .orderBy(...clientListOrder(filters))
    .limit(cap + 1)
    .as('matching');
  return bounded(await tx.select({ n: count() }).from(matching), cap);
}

export async function countRoles(
  tx: TenantScopedDatabase,
  filters: RoleFilters,
  options: CountOptions = {},
): Promise<CountResponse> {
  const cap = options.cap ?? COUNT_CAP;
  const matching = tx
    .select({ one: ONE })
    .from(roles)
    .where(whereOf(await roleListConditions(tx, filters, undefined)))
    .orderBy(...roleListOrder(filters))
    .limit(cap + 1)
    .as('matching');
  return bounded(await tx.select({ n: count() }).from(matching), cap);
}

export async function countGroups(
  tx: TenantScopedDatabase,
  filters: GroupFilters,
  options: CountOptions = {},
): Promise<CountResponse> {
  const cap = options.cap ?? COUNT_CAP;
  const matching = tx
    .select({ one: ONE })
    .from(groups)
    .where(whereOf(await groupListConditions(tx, filters, undefined)))
    .orderBy(...groupListOrder(filters))
    .limit(cap + 1)
    .as('matching');
  return bounded(await tx.select({ n: count() }).from(matching), cap);
}

export async function countScopes(
  tx: TenantScopedDatabase,
  filters: ScopeFilters,
  options: CountOptions = {},
): Promise<CountResponse> {
  const cap = options.cap ?? COUNT_CAP;
  const matching = tx
    .select({ one: ONE })
    .from(clientScopes)
    .where(whereOf(await scopeListConditions(tx, filters, undefined)))
    .orderBy(...scopeListOrder(filters))
    .limit(cap + 1)
    .as('matching');
  return bounded(await tx.select({ n: count() }).from(matching), cap);
}
