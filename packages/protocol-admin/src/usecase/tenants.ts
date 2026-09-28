import { provisionTenant } from '@odudu/authn-flows';
import { type ListTenantsQuery, type Tenant } from '@odudu/contracts/admin';
import { generateSigningKey, signingKeyRepository } from '@odudu/crypto';
import {
  isUniqueViolation,
  tenants,
  withTenant,
  type Database,
  type RequestContext,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  isReservedTenantName,
  isValidTenantName,
  SYSTEM_TENANT_DISABLE_REFUSED,
  SYSTEM_TENANT_NAME,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { provisionAdminClient } from '@odudu/protocol-oidc';
import { and, asc, eq, gt, sql, type SQL } from 'drizzle-orm';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';
import { AMENDABLE_TENANT_FIELDS, refusalFor } from '#/service/tenant-patch';
import {
  prefixRangeConditions,
  requireSearchKey,
  type Executor,
  type ListPosition,
} from '#/usecase/prefix-search';

const COLLECTION = 'tenants';

const TENANT_COLUMNS = {
  id: tenants.id,
  name: tenants.name,
  displayName: tenants.displayName,
  enabled: tenants.enabled,
  createdAt: tenants.createdAt,
};

export interface TenantRecord {
  readonly id: string;
  readonly name: string;
  readonly displayName: string | null;
  readonly enabled: boolean;
  readonly createdAt: Date;
}

export interface TenantAuditEvent {
  readonly action: 'tenant.create' | 'tenant.amend' | 'tenant.smtp_delete';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/**
 * Writes one row to `audit_events`, in the same transaction as the mutation
 * — the composition root wires this to `auditRepository(tx).record` (see
 * `#/index.ts`'s `recordAudit`). `tx` is the seam a test uses to prove a
 * mutation's audit write shares its own transaction.
 */
export type Audit = (tx: TenantScopedDatabase, event: TenantAuditEvent) => Promise<void>;

export interface CreateTenantInput {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateTenantDeps {
  readonly database: Database;
  // Encrypts the signing key minted for the new tenant — the same KEK
  // `seedAdmin` and `seed tenant` (apps/server/src/cli/seed.ts) pass to
  // `generateSigningKey`.
  readonly kek: Uint8Array;
  readonly audit: Audit;
}

export type CreateTenantOutcome =
  | { kind: 'created'; tenant: TenantRecord }
  | { kind: 'name_invalid' }
  | { kind: 'name_refused' }
  | { kind: 'name_taken' };

// Mirrors `ensureSigningKey` (apps/server/src/cli/seed.ts): a freshly
// inserted tenant has none yet, so there is nothing to check first — a
// tenant with no client yet still needs one the instant it can issue
// tokens.
async function mintSigningKey(
  tx: TenantScopedDatabase,
  tenantId: string,
  kek: Uint8Array,
): Promise<void> {
  const generated = await generateSigningKey('ES256', kek);
  await signingKeyRepository(tx).create({
    id: newId(),
    tenantId,
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
  });
}

/**
 * Thrown by `insertProvisionedTenant` when the tenants row alone collides
 * on its name — never for a violation anywhere in provisioning after it.
 */
export class TenantNameTakenError extends Error {
  constructor() {
    super('a tenant already holds that name');
    this.name = 'TenantNameTakenError';
  }
}

/**
 * The row, its browser flow, its built-in admin client and its signing key,
 * inside a transaction `withTenant` has already bound to `row.id` — shared
 * by creating a tenant and importing one, so the two cannot provision
 * differently.
 */
export async function insertProvisionedTenant(
  tx: TenantScopedDatabase,
  kek: Uint8Array,
  row: { readonly id: string; readonly name: string; readonly displayName: string | null },
): Promise<TenantRecord> {
  let rows: TenantRecord[];
  try {
    rows = await tx.insert(tenants).values(row).returning(TENANT_COLUMNS);
  } catch (error) {
    if (isUniqueViolation(error)) throw new TenantNameTakenError();
    throw error;
  }
  const created = rows[0];
  if (created === undefined) throw new Error('insert into tenants returned no row');
  await provisionTenant(tx, row.id);
  await provisionAdminClient(tx, row.id);
  await mintSigningKey(tx, row.id, kek);
  return created;
}

/**
 * One transaction: the row, its browser flow, its built-in admin client and
 * its signing key. `withTenant` binds `app.tenant_id` to the id about to be
 * inserted before the row exists — the same RLS-satisfying order
 * `insertSystemTenant` uses (apps/server/src/cli/seed.ts) — so nothing here
 * needs the owner connection's bypass. A failure at any step rolls the
 * whole thing back, rather than leaving a tenant row with no flow, no
 * client or no key to sign a token with.
 */
export async function createTenant(
  deps: CreateTenantDeps,
  input: CreateTenantInput,
  context: RequestContext,
): Promise<CreateTenantOutcome> {
  // Checked before the reserved-name door: an invalid shape and a reserved
  // name can both be true of the same input, and the shape is the more
  // specific complaint.
  if (!isValidTenantName(input.name)) return { kind: 'name_invalid' };

  // Left to the unique index, this would surface as a constraint violation
  // with no reason attached. `seed tenant`'s equivalent guard refuses the
  // identical names through the same predicate, so the two doors cannot
  // disagree.
  if (isReservedTenantName(input.name)) return { kind: 'name_refused' };

  const id = newId();
  let tenant: TenantRecord;
  try {
    tenant = await withTenant(
      deps.database,
      id,
      async (tx) => {
        const created = await insertProvisionedTenant(tx, deps.kek, {
          id,
          name: input.name,
          displayName: input.displayName ?? null,
        });

        // Written inside the same transaction as the row it describes: a
        // rollback below leaves no audit row for a tenant that never existed.
        await deps.audit(tx, {
          action: 'tenant.create',
          resourceType: 'tenant',
          resourceId: id,
          actorSubjectId: input.actorSubjectId,
          actorTenantId: input.actorTenantId,
          actorClientId: input.actorClientId,
          outcome: 'allowed',
        });

        return created;
      },
      context,
    );
  } catch (error) {
    // Caught outside the transaction, which the violation has already
    // aborted and `withTenant` has already rolled back — the same shape
    // `createClient` leaves `ClientIdConflictError` in
    // (#/usecase/clients.ts). Under row-level security a tenant holding
    // this name is not even visible to a lookup here, so the unique index
    // is the only thing that can answer.
    if (error instanceof TenantNameTakenError) return { kind: 'name_taken' };
    throw error;
  }

  return { kind: 'created', tenant };
}

/** Every `listTenantsQuerySchema` parameter except the page controls. */
export type TenantFilters = Omit<ListTenantsQuery, 'cursor' | 'limit'>;

export interface ListTenantsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  // Cursors are bound to the tenant that scopes this listing — `system`,
  // since only a system admin ever reaches this collection — so one minted
  // here cannot be replayed against a list bound to another tenant's path.
  readonly tenantId: string;
  readonly filters: TenantFilters;
}

export type ListTenantsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly TenantRecord[]; next: string | null };

type TenantSearchKey = typeof tenants.nameSearch | typeof tenants.displayNameSearch;

function tenantSearchOf(
  filters: TenantFilters,
): { readonly column: TenantSearchKey; readonly prefix: string } | undefined {
  if (filters.name !== undefined) return { column: tenants.nameSearch, prefix: filters.name };
  if (filters.display_name !== undefined) {
    return { column: tenants.displayNameSearch, prefix: filters.display_name };
  }
  return undefined;
}

/** The WHERE clause of the tenants listing, and of its count, which passes no position. */
export async function tenantListConditions(
  database: Executor,
  filters: TenantFilters,
  after: ListPosition | undefined,
): Promise<SQL[]> {
  const conditions: SQL[] = [];
  if (filters.enabled !== undefined) {
    conditions.push(eq(tenants.enabled, filters.enabled === 'true'));
  }
  const search = tenantSearchOf(filters);
  if (search === undefined) {
    if (after !== undefined) conditions.push(gt(tenants.id, after.id));
    return conditions;
  }
  const position = after?.sort === undefined ? undefined : { id: after.id, sort: after.sort };
  conditions.push(
    ...(await prefixRangeConditions(database, search.column, tenants.id, search.prefix, position)),
  );
  return conditions;
}

/** The tenants listing's order, which its keyset cursor and its count both follow. */
export function tenantListOrder(filters: TenantFilters): SQL[] {
  const search = tenantSearchOf(filters);
  return search === undefined ? [asc(tenants.id)] : [asc(search.column), asc(tenants.id)];
}

// The system tenant appears in this listing like any other — hiding it
// would make the one tenant an operator most needs to inspect the one they
// cannot. A searched listing is one range scan of the search column's
// index (0074_list_indexes_tenants_clients.sql).
export async function listTenants(
  database: Database,
  input: ListTenantsInput,
): Promise<ListTenantsOutcome> {
  const filters = filterDigest(input.filters);
  const search = tenantSearchOf(input.filters);
  let after: ListPosition | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    if (search !== undefined && decoded.sort === undefined) return { kind: 'invalid_cursor' };
    after = { id: decoded.after, sort: decoded.sort };
  }

  const conditions = await tenantListConditions(database, input.filters, after);
  const rows = await database
    .select({ record: TENANT_COLUMNS, searchKey: search?.column ?? sql<null>`null` })
    .from(tenants)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(...tenantListOrder(input.filters))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const page = hasMore ? rows.slice(0, input.limit) : rows;
  const last = page[page.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.record.id,
          ...(search === undefined ? {} : { sort: requireSearchKey(last.searchKey) }),
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;

  return { kind: 'ok', items: page.map((row) => row.record), next };
}

export function tenantWireShape(record: TenantRecord): Tenant {
  return {
    id: record.id,
    name: record.name,
    display_name: record.displayName,
    enabled: record.enabled,
    created_at: record.createdAt.toISOString(),
  };
}

export type ReadTenantOutcome =
  { kind: 'not_found' } | { kind: 'ok'; tenant: Tenant; etag: string };

export async function readTenant(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ReadTenantOutcome> {
  const rows = await tx.select(TENANT_COLUMNS).from(tenants).where(eq(tenants.id, tenantId));
  const row = rows[0];
  if (row === undefined) return { kind: 'not_found' };
  const tenant = tenantWireShape(row);
  return { kind: 'ok', tenant, etag: etagOf(tenant) };
}

export interface AmendTenantInput {
  readonly tenantId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly ifMatch: string | undefined;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface AmendTenantDeps {
  readonly audit: Audit;
}

export type AmendTenantOutcome =
  | { kind: 'not_found' }
  | { kind: 'refused_field'; field: string; reason: string }
  | { kind: 'invalid_value'; field: string; description: string }
  | { kind: 'system_tenant_guarded'; reason: string }
  | { kind: 'precondition_failed' }
  | { kind: 'ok'; tenant: Tenant; etag: string };

/**
 * `display_name` and `enabled` — `name` is refused, since it is already in
 * the issuer URL of every token this tenant has minted. The row is locked
 * before its `ETag` is computed, the same order `amendSettings` uses, so
 * two amendments cannot both match the same pre-write state.
 */
export async function amendTenant(
  tx: TenantScopedDatabase,
  deps: AmendTenantDeps,
  input: AmendTenantInput,
): Promise<AmendTenantOutcome> {
  for (const field of Object.keys(input.values)) {
    if (!AMENDABLE_TENANT_FIELDS.includes(field)) {
      return {
        kind: 'refused_field',
        field,
        reason: refusalFor(field) ?? `${field} is not a tenant field`,
      };
    }
  }

  const locked = await tx
    .select(TENANT_COLUMNS)
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .for('no key update');
  const current = locked[0];
  if (current === undefined) return { kind: 'not_found' };

  // The same lockout the built-in admin client's own guard refuses
  // (`amendClient`, #/usecase/clients.ts), one level up: every
  // cross-tenant administrator authenticates against the system tenant,
  // so disabling it locks every tenant's administration out at once, with
  // `psql` the only way back.
  if (input.values.enabled === false && current.name === SYSTEM_TENANT_NAME) {
    const reason = SYSTEM_TENANT_DISABLE_REFUSED;
    await deps.audit(tx, {
      action: 'tenant.amend',
      resourceType: 'tenant',
      resourceId: input.tenantId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'refused',
      detail: { reason },
    });
    return { kind: 'system_tenant_guarded', reason };
  }

  if (matches(input.ifMatch, etagOf(tenantWireShape(current))) === 'mismatch') {
    return { kind: 'precondition_failed' };
  }

  const patch: Partial<Pick<typeof tenants.$inferInsert, 'displayName' | 'enabled'>> = {};
  if ('display_name' in input.values) {
    const value = input.values.display_name;
    if (value !== null && typeof value !== 'string') {
      return {
        kind: 'invalid_value',
        field: 'display_name',
        description: 'display_name must be a string or null',
      };
    }
    patch.displayName = value;
  }
  if ('enabled' in input.values) {
    const value = input.values.enabled;
    if (typeof value !== 'boolean') {
      return {
        kind: 'invalid_value',
        field: 'enabled',
        description: 'enabled must be a boolean',
      };
    }
    patch.enabled = value;
  }

  const after =
    Object.keys(patch).length === 0
      ? current
      : ((
          await tx
            .update(tenants)
            .set(patch)
            .where(eq(tenants.id, input.tenantId))
            .returning(TENANT_COLUMNS)
        )[0] ?? current);

  await deps.audit(tx, {
    action: 'tenant.amend',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  const tenant = tenantWireShape(after);
  return { kind: 'ok', tenant, etag: etagOf(tenant) };
}
