import { eq } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
import { sessions, type SessionRecord } from '#/schema/sessions';

function toRecord(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    subjectId: row.subjectId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// Read-only access to an established SSO session — this is what a later
// request (Task 12/13's cookie check, a logout handler) resolves the
// `__Host-<realm>-session` cookie's value against.
export function sessionRepository(tx: RealmScopedDatabase) {
  return {
    async byId(id: string): Promise<SessionRecord | null> {
      const rows = await tx.select().from(sessions).where(eq(sessions.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },
  };
}
