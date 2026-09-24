import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeyRepository } from '@odudu/crypto';
import {
  isUniqueViolation,
  tenants,
  withTenant,
  type Database,
  type TenantScopedDatabase,
} from '@odudu/db';
import { isSystemTenantName } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { provisionAdminClient } from '@odudu/protocol-oidc';
import { asc, gt } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';

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
  readonly action: 'tenant.create';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/**
 * The write an `audit_events` sink gives a real implementation of: until
 * one exists, the composition root supplies a function that does nothing,
 * and this is the only seam a test has to prove a mutation still calls it.
 */
export type Audit = (event: TenantAuditEvent) => Promise<void>;

export interface CreateTenantInput {
  readonly name: string;
  readonly displayName?: string | undefined;
  readonly actorSubjectId: string;
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
): Promise<CreateTenantOutcome> {
  // Left to the unique index, this would surface as a constraint violation
  // with no reason attached. `apps/server/src/cli/seed.ts`'s
  // `refuseSystemTenantName` refuses the identical name through the same
  // predicate, so the two doors cannot disagree.
  if (isSystemTenantName(input.name)) return { kind: 'name_refused' };

  const id = newId();
  let tenant: TenantRecord;
  try {
    tenant = await withTenant(deps.database, id, async (tx) => {
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

      return created;
    });
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

  await deps.audit({
    action: 'tenant.create',
    resourceType: 'tenant',
    resourceId: id,
    actorSubjectId: input.actorSubjectId,
  });

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
