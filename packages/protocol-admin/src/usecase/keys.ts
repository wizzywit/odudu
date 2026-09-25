import {
  generateSigningKey,
  signingKeyRepository,
  signingKeys,
  type SigningKeyRecord,
} from '@odudu/crypto';
import { type SigningKey, type SigningKeyAlg } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { clientOidcConfig } from '@odudu/protocol-oidc';
import { newId } from '@odudu/kernel';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { decodeCursor, encodeCursor } from '#/service/cursor';

const COLLECTION = 'keys';

export interface KeyAuditEvent {
  readonly action: 'key.create' | 'key.promote' | 'key.retire';
  readonly resourceType: 'signing_key';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: KeyAuditEvent) => Promise<void>;

// Never `publicJwk` or `privateJwkEncrypted` — a signing key's admin
// representation is metadata about it, never the key itself.
export function keyWireShape(key: SigningKeyRecord): SigningKey {
  return {
    id: key.id,
    status: key.status,
    kid: key.kid,
    alg: key.alg,
    created_at: key.createdAt.toISOString(),
    not_after: key.notAfter === null ? null : key.notAfter.toISOString(),
  };
}

// `status`/`alg` are `text` columns (packages/crypto/src/schema/signing-keys.ts),
// narrowed here the same way @odudu/crypto's own `toRecord` narrows them —
// the one cast site a raw row goes through before `keyWireShape` sees it.
function toSigningKeyRecord(row: typeof signingKeys.$inferSelect): SigningKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    kid: row.kid,
    alg: row.alg as SigningKeyRecord['alg'],
    status: row.status as SigningKeyRecord['status'],
    publicJwk: row.publicJwk as Record<string, unknown>,
    privateJwkEncrypted: row.privateJwkEncrypted,
    createdAt: row.createdAt,
    notAfter: row.notAfter,
  };
}

export interface ListKeysInput {
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
  readonly tenantId: string;
}

export type ListKeysOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: readonly SigningKey[]; next: string | null };

export async function listKeys(
  tx: TenantScopedDatabase,
  input: ListKeysInput,
): Promise<ListKeysOutcome> {
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursorKey, COLLECTION, input.tenantId, input.cursor);
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const rows = await tx
    .select()
    .from(signingKeys)
    .where(after === undefined ? undefined : gt(signingKeys.id, after))
    .orderBy(asc(signingKeys.id))
    .limit(input.limit + 1);

  const hasMore = rows.length > input.limit;
  const items = (hasMore ? rows.slice(0, input.limit) : rows).map((row) =>
    keyWireShape(toSigningKeyRecord(row)),
  );
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

export interface CreateKeyInput {
  readonly tenantId: string;
  readonly alg: SigningKeyAlg;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface CreateKeyDeps {
  readonly audit: Audit;
  // The same KEK `createTenant` (#/usecase/tenants.ts) and `seedAdmin` pass
  // to `generateSigningKey`.
  readonly kek: Uint8Array;
}

// Staged as `rotating`, never `active`: `signing_keys_one_active`
// constrains `active` alone, so this never collides with it, and a caller
// still reaches the tenant's existing default until it explicitly
// promotes this one (#/usecase/keys.ts's own `promoteKey`).
export async function createKey(
  tx: TenantScopedDatabase,
  deps: CreateKeyDeps,
  input: CreateKeyInput,
): Promise<SigningKey> {
  const generated = await generateSigningKey(input.alg, deps.kek);
  const created = await signingKeyRepository(tx).create({
    id: newId(),
    tenantId: input.tenantId,
    kid: generated.kid,
    alg: generated.alg,
    status: 'rotating',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
  });

  await deps.audit(tx, {
    action: 'key.create',
    resourceType: 'signing_key',
    resourceId: created.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return keyWireShape(created);
}

export interface PromoteKeyInput {
  readonly keyId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface PromoteKeyDeps {
  readonly audit: Audit;
}

export type PromoteKeyOutcome = { kind: 'not_found' } | { kind: 'ok'; key: SigningKey };

// The atomicity itself — no window with two actives or none — lives in
// `signingKeyRepository(tx).promote` (@odudu/crypto): `signing_keys_one_active`
// is what rejects the loser of a concurrent promote, not the row locking
// there, which only serialises the two reads. This is only the audit
// wrapper around it.
export async function promoteKey(
  tx: TenantScopedDatabase,
  deps: PromoteKeyDeps,
  input: PromoteKeyInput,
): Promise<PromoteKeyOutcome> {
  const promoted = await signingKeyRepository(tx).promote(input.keyId);
  if (promoted === null) return { kind: 'not_found' };

  await deps.audit(tx, {
    action: 'key.promote',
    resourceType: 'signing_key',
    resourceId: promoted.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'ok', key: keyWireShape(promoted) };
}

export interface RetireKeyInput {
  readonly keyId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

export interface RetireKeyDeps {
  readonly audit: Audit;
}

export type RetireKeyOutcome =
  | { kind: 'not_found' }
  | { kind: 'active' }
  | { kind: 'algorithm_needed'; alg: string; clientIds: readonly string[] }
  | { kind: 'ok'; key: SigningKey };

async function lockKeyForRetire(
  tx: TenantScopedDatabase,
  keyId: string,
): Promise<typeof signingKeys.$inferSelect | null> {
  const rows = await tx.select().from(signingKeys).where(eq(signingKeys.id, keyId)).for('update');
  return rows[0] ?? null;
}

// Two refusals, checked in this order because coverage alone is not
// enough: a key sharing its algorithm with a `rotating` key still cannot
// retire while it is the `active` one, or the tenant is left with no
// default and the selection fallback (`forAlg`'s own doc comment,
// @odudu/crypto) pointing at nothing. Only once that is ruled out does an
// algorithm actually going unproduced matter.
export async function retireKey(
  tx: TenantScopedDatabase,
  deps: RetireKeyDeps,
  input: RetireKeyInput,
): Promise<RetireKeyOutcome> {
  const locked = await lockKeyForRetire(tx, input.keyId);
  if (locked === null) return { kind: 'not_found' };
  if (locked.status === 'active') return { kind: 'active' };
  if (locked.status === 'retired') {
    // Idempotent: the caller asked for the key retired and it is, so this
    // still audits as a retire even though nothing in the row changes.
    await deps.audit(tx, {
      action: 'key.retire',
      resourceType: 'signing_key',
      resourceId: locked.id,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'allowed',
    });
    return { kind: 'ok', key: keyWireShape(toSigningKeyRecord(locked)) };
  }

  const survivors = await tx
    .select({ alg: signingKeys.alg })
    .from(signingKeys)
    .where(and(ne(signingKeys.status, 'retired'), ne(signingKeys.id, locked.id)));
  const stillProduced = new Set(survivors.map((row) => row.alg));

  if (!stillProduced.has(locked.alg)) {
    const offending = await tx
      .select({ oauthClientId: clients.clientId })
      .from(clientOidcConfig)
      .innerJoin(clients, eq(clients.id, clientOidcConfig.clientId))
      .where(eq(clientOidcConfig.userinfoSignedResponseAlg, locked.alg));
    if (offending.length > 0) {
      return {
        kind: 'algorithm_needed',
        alg: locked.alg,
        clientIds: offending.map((row) => row.oauthClientId),
      };
    }
  }

  const retired = await signingKeyRepository(tx).retire(locked.id);
  if (retired === null) {
    throw new Error(`signing key ${locked.id} vanished mid-retirement`);
  }

  await deps.audit(tx, {
    action: 'key.retire',
    resourceType: 'signing_key',
    resourceId: retired.id,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'ok', key: keyWireShape(retired) };
}
