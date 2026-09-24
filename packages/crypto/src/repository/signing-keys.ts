import { type TenantScopedDatabase } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { and, asc, eq, ne } from 'drizzle-orm';
import { signingKeys, type SigningKeyRecord } from '#/schema/signing-keys';

export type { SigningKeyRecord } from '#/schema/signing-keys';

function toRecord(row: typeof signingKeys.$inferSelect): SigningKeyRecord {
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

function firstOrThrow(rows: readonly SigningKeyRecord[]): SigningKeyRecord {
  const row = rows[0];
  if (row === undefined) {
    throw new OduduError('signing_key_not_found', 'No active signing key for this tenant');
  }
  return row;
}

export interface NewSigningKey {
  id: string;
  tenantId: string;
  kid: string;
  alg: 'RS256' | 'ES256';
  status: 'active' | 'rotating' | 'retired';
  publicJwk: Record<string, unknown>;
  privateJwkEncrypted: string;
  notAfter?: Date | null;
}

export function signingKeyRepository(tx: TenantScopedDatabase) {
  return {
    async listPublishable(): Promise<SigningKeyRecord[]> {
      const rows = await tx
        .select()
        .from(signingKeys)
        .where(ne(signingKeys.status, 'retired'))
        .orderBy(asc(signingKeys.createdAt));
      return rows.map(toRecord);
    },

    async active(): Promise<SigningKeyRecord> {
      const rows = await tx.select().from(signingKeys).where(eq(signingKeys.status, 'active'));
      return firstOrThrow(rows.map(toRecord));
    },

    // `active` remains the fallback a caller reaches for when it has no
    // algorithm to ask for; this is the selection a caller with one uses
    // instead. Staging a same-algorithm key as `rotating` must not move
    // what an algorithm-less caller gets, so `active` wins the tie.
    async forAlg(alg: 'RS256' | 'ES256'): Promise<SigningKeyRecord | null> {
      const rows = await tx
        .select()
        .from(signingKeys)
        .where(and(ne(signingKeys.status, 'retired'), eq(signingKeys.alg, alg)));
      const records = rows.map(toRecord);
      return records.find((record) => record.status === 'active') ?? records[0] ?? null;
    },

    async algorithmsAvailable(): Promise<readonly string[]> {
      const rows = await tx
        .select({ alg: signingKeys.alg })
        .from(signingKeys)
        .where(ne(signingKeys.status, 'retired'));
      return [...new Set(rows.map((row) => row.alg))];
    },

    // Demotes whatever is currently active and promotes `id` in the same
    // transaction, so no window has two actives or none. Locked before
    // either write: two concurrent promotes must serialise on whichever row
    // is active right now, or each can finish believing it alone holds it
    // and collide on `signing_keys_one_active` instead. `null` for a
    // missing or already-retired target.
    async promote(id: string): Promise<SigningKeyRecord | null> {
      const targetRows = await tx
        .select()
        .from(signingKeys)
        .where(eq(signingKeys.id, id))
        .for('update');
      const target = targetRows[0];
      if (target === undefined || target.status === 'retired') return null;

      const activeRows = await tx
        .select()
        .from(signingKeys)
        .where(eq(signingKeys.status, 'active'))
        .for('update');
      for (const row of activeRows) {
        if (row.id !== target.id) {
          await tx
            .update(signingKeys)
            .set({ status: 'rotating' })
            .where(eq(signingKeys.id, row.id));
        }
      }

      const promoted = await tx
        .update(signingKeys)
        .set({ status: 'active' })
        .where(eq(signingKeys.id, target.id))
        .returning();
      const row = promoted[0];
      if (row === undefined) {
        throw new OduduError('signing_key_not_found', `signing key ${id} vanished mid-promotion`);
      }
      return toRecord(row);
    },

    // A primitive with no business rule attached — whether a key may be
    // retired (not active, not the last producer of an algorithm a client
    // still needs) is decided by the caller before this runs.
    async retire(id: string): Promise<SigningKeyRecord | null> {
      const rows = await tx
        .update(signingKeys)
        .set({ status: 'retired' })
        .where(eq(signingKeys.id, id))
        .returning();
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // The bootstrap seed command is the only caller today: a tenant cannot
    // issue a token, and /jwks has nothing to publish, until it has one.
    async create(input: NewSigningKey): Promise<SigningKeyRecord> {
      const rows = await tx
        .insert(signingKeys)
        .values({
          id: input.id,
          tenantId: input.tenantId,
          kid: input.kid,
          alg: input.alg,
          status: input.status,
          publicJwk: input.publicJwk,
          privateJwkEncrypted: input.privateJwkEncrypted,
          notAfter: input.notAfter ?? null,
        })
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('insert_returned_no_row', 'insert into signing_keys returned no row');
      }
      return toRecord(row);
    },
  };
}
