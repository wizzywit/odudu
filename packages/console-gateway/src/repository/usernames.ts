import { type TenantScopedDatabase } from '@odudu/db';
import { sql } from 'drizzle-orm';

// users belongs to @odudu/domain-identity, which the gateway does not
// import; the one column it shows is read by name instead.
export function usernameRepository(tx: TenantScopedDatabase) {
  return {
    async usernameOf(subjectId: string): Promise<string | null> {
      const rows = await tx.execute<{ username: string }>(
        sql`SELECT username FROM users WHERE subject_id = ${subjectId}`,
      );
      return rows[0]?.username ?? null;
    },
  };
}
