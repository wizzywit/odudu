import { type RealmScopedDatabase } from '@odudu/db';
import { and, eq } from 'drizzle-orm';
import { userCredentials } from '#/schema/user-credentials';

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
  };
}
