import { provisionTenant } from '@odudu/authn-flows';
import { type Tenant } from '@odudu/contracts/admin';
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
  isSystemTenantName,
  SYSTEM_TENANT_DISABLE_REFUSED,
  SYSTEM_TENANT_NAME,
} from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { provisionAdminClient } from '@odudu/protocol-oidc';
import { asc, eq, gt } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';
import { etagOf, matches } from '#/service/etag';
import { AMENDABLE_TENANT_FIELDS, refusalFor } from '#/service/tenant-patch';

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
  { kind: 'created'; tenant: TenantRecord } | { kind: 'name_refused' } | { kind: 'name_taken' };

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
  // Left to the unique index, this would surface as a constraint violation
  // with no reason attached. `apps/server/src/cli/seed.ts`'s
  // `refuseSystemTenantName` refuses the identical name through the same
  // predicate, so the two doors cannot disagree.
  if (isSystemTenantName(input.name)) return { kind: 'name_refused' };

  const id = newId();
  let tenant: TenantRecord;
  try {
    tenant = await withTenant(
      deps.database,
      id,
      async (tx) => {
        const rows = await tx
          .insert(tenants)
          .values({ id, name: input.name, displayName: input.displayName ?? null })
          .returning(TENANT_COLUMNS);
        const created = rows[0];
        if (created === undefined) {
          throw new Error('insert into tenants returned no row');
        }

        await provisionTenant(tx, id);
        await provisionAdminClient(tx, id);
        await mintSigningKey(tx, id, deps.kek);

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
    if (isUniqueViolation(error)) return { kind: 'name_taken' };
    throw error;
  }

  return { kind: 'created', tenant };
}

export interface ListTenantsInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  // Cursors are bound to the tenant that scopes this listing — `system`,
  // since only a system admin ever reaches this collection — so one minted
  // here cannot be replayed against a list bound to another tenant's path.
  readonly tenantId: string;
}

export type ListTenantsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly TenantRecord[]; next: string | null };

// The system tenant appears in this listing like any other — hiding it
// would make the one tenant an operator most needs to inspect the one they
// cannot.
export async function listTenants(
  database: Database,
  input: ListTenantsInput,
): Promise<ListTenantsOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await database
    .select(TENANT_COLUMNS)
    .from(tenants)
    .where(after === undefined ? undefined : gt(tenants.id, after))
    .orderBy(asc(tenants.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          collection: COLLECTION,
          tenantId: input.tenantId,
        })
      : null;

  return { kind: 'ok', items, next };
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
    .for('update');
  const current = locked[0];
  if (current === undefined) return { kind: 'not_found' };

  // The same lockout the built-in admin client's own guard refuses
  // (`amendClient`, #/usecase/clients.ts), one level up: every
  // cross-tenant administrator authenticates against the system tenant,
  // so disabling it locks every tenant's administration out at once, with
  // `psql` the only way back.
  if (input.values.enabled === false && current.name === SYSTEM_TENANT_NAME) {
    return {
      kind: 'system_tenant_guarded',
      reason: SYSTEM_TENANT_DISABLE_REFUSED,
    };
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
