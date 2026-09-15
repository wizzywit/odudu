import { type RealmScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { and, eq } from 'drizzle-orm';
import {
  userCredentials,
  type CredentialRecord,
  type CredentialType,
} from '#/schema/user-credentials';
import {
  parseCredentialSecret,
  serializeCredentialSecret,
  type CredentialSecret,
} from '#/service/credential-secret';

export interface NewCredential {
  realmId: string;
  subjectId: string;
  type: CredentialType;
  secret: CredentialSecret;
  label?: string;
  lookupKey?: string;
}

function toRecord(row: typeof userCredentials.$inferSelect): CredentialRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    subjectId: row.subjectId,
    type: row.type,
    secret: parseCredentialSecret(row.type, row.secretData),
    label: row.label,
    lastUsedAt: row.lastUsedAt,
    lookupKey: row.lookupKey,
    createdAt: row.createdAt,
  };
}

export function credentialRepository(tx: RealmScopedDatabase) {
  return {
    async passwordFor(subjectId: string): Promise<string | null> {
      const rows = await tx
        .select({ secretData: userCredentials.secretData })
        .from(userCredentials)
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'password')));
      const row = rows[0];
      if (row === undefined) return null;
      const secret = parseCredentialSecret('password', row.secretData);
      return secret.hash;
    },

    async listFor(subjectId: string, type: CredentialType): Promise<CredentialRecord[]> {
      const rows = await tx
        .select()
        .from(userCredentials)
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, type)));
      return rows.map(toRecord);
    },

    async byLookupKey(lookupKey: string): Promise<CredentialRecord | null> {
      const rows = await tx
        .select()
        .from(userCredentials)
        .where(eq(userCredentials.lookupKey, lookupKey));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    // Called by the seed CLI and by `createAccount` in the registration route:
    // one credential row per call, typed by `input.type`, never a batch.
    async insert(input: NewCredential): Promise<void> {
      await tx.insert(userCredentials).values({
        id: newId(),
        realmId: input.realmId,
        subjectId: input.subjectId,
        type: input.type,
        secretData: serializeCredentialSecret(input.secret),
        label: input.label ?? null,
        lookupKey: input.lookupKey ?? null,
      });
    },

    async markUsed(id: string, at: Date): Promise<void> {
      const rows = await tx
        .update(userCredentials)
        .set({ lastUsedAt: at })
        .where(eq(userCredentials.id, id))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('credential_not_found', `no credential with id ${id}`);
      }
    },

    async deleteOne(id: string): Promise<void> {
      const rows = await tx.delete(userCredentials).where(eq(userCredentials.id, id)).returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError('credential_not_found', `no credential with id ${id}`);
      }
    },

    // Password reset's write: replaces the existing password credential
    // rather than inserting a second one, which is what
    // user_credentials_one_password (0005; a partial unique index as of
    // 0034) would refuse anyway. RLS is what makes a foreign realm's
    // subject match zero rows here, the same as every other write in this
    // package — that surfaces as credential_not_found rather than a silent
    // cross-realm no-op.
    async setPassword(subjectId: string, hash: string): Promise<void> {
      const rows = await tx
        .update(userCredentials)
        .set({ secretData: serializeCredentialSecret({ kind: 'password', hash }) })
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'password')))
        .returning();
      const row = rows[0];
      if (row === undefined) {
        throw new OduduError(
          'credential_not_found',
          `no password credential for subject ${subjectId}`,
        );
      }
    },
  };
}
