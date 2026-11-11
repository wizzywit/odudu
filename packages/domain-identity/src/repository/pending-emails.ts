import type { TenantScopedDatabase } from '@odudu/db';
import { and, eq, sql } from 'drizzle-orm';
import { pendingEmailChanges } from '#/schema/pending-email-changes';

// A subject's one pending address. Every method finds only the current
// tenant's rows, and at most one row, by the primary key.
export function pendingEmailRepository(tx: TenantScopedDatabase) {
  return {
    // Keeps `email` as the subject's pending address, replacing any other.
    async set(tenantId: string, subjectId: string, email: string): Promise<void> {
      await tx
        .insert(pendingEmailChanges)
        .values({ tenantId, subjectId, email })
        .onConflictDoUpdate({
          target: [pendingEmailChanges.tenantId, pendingEmailChanges.subjectId],
          set: { email, requestedAt: sql`now()` },
        });
    },

    async forSubject(subjectId: string): Promise<string | null> {
      const rows = await tx
        .select({ email: pendingEmailChanges.email })
        .from(pendingEmailChanges)
        .where(eq(pendingEmailChanges.subjectId, subjectId));
      return rows[0]?.email ?? null;
    },

    // Deletes the row when it still names `email`, and says whether it did:
    // one statement decides between two completions of the same request, and
    // a request replaced or cleared since the link was mailed finds nothing.
    async take(subjectId: string, email: string): Promise<boolean> {
      const rows = await tx
        .delete(pendingEmailChanges)
        .where(
          and(eq(pendingEmailChanges.subjectId, subjectId), eq(pendingEmailChanges.email, email)),
        )
        .returning({ subjectId: pendingEmailChanges.subjectId });
      return rows.length > 0;
    },
  };
}
