import { type RealmScopedDatabase } from '@odudu/db';
import { newId, OduduError } from '@odudu/kernel';
import { and, eq } from 'drizzle-orm';
import { userCredentials } from '#/schema/user-credentials';

export interface NewCredential {
  realmId: string;
  subjectId: string;
  type: 'password';
  secretData: string;
}

export function credentialRepository(tx: RealmScopedDatabase) {
  return {
    async passwordFor(subjectId: string): Promise<string | null> {
      const rows = await tx
        .select({ secretData: userCredentials.secretData })
        .from(userCredentials)
        .where(and(eq(userCredentials.subjectId, subjectId), eq(userCredentials.type, 'password')));
      const row = rows[0];
      return row === undefined ? null : row.secretData;
    },

    // The bootstrap seed command is the only caller today: it is the only
    // place a credential is minted outside of a future self-service or
    // admin flow.
    async create(input: NewCredential): Promise<void> {
      await tx.insert(userCredentials).values({
        id: newId(),
        realmId: input.realmId,
        subjectId: input.subjectId,
        type: input.type,
        secretData: input.secretData,
      });
    },

    // Password reset's write: replaces the existing password credential
    // rather than inserting a second one, which is what
    // user_credentials_one_password (0005) would refuse anyway. RLS is what
    // makes a foreign realm's subject match zero rows here, the same as
    // every other write in this package — that surfaces as credential_not_found
    // rather than a silent cross-realm no-op.
    async setPassword(subjectId: string, secretData: string): Promise<void> {
      const rows = await tx
        .update(userCredentials)
        .set({ secretData })
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
