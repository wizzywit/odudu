import { type RealmScopedDatabase } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { asc, eq, ne } from 'drizzle-orm';
import { signingKeys, type SigningKeyRecord } from '#/schema/signing-keys';

export type { SigningKeyRecord } from '#/schema/signing-keys';

function toRecord(row: typeof signingKeys.$inferSelect): SigningKeyRecord {
  return {
    id: row.id,
    realmId: row.realmId,
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
    throw new OduduError('signing_key_not_found', 'No active signing key for this realm');
  }
  return row;
}

export function signingKeyRepository(tx: RealmScopedDatabase) {
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
  };
}
