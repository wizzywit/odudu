import { eq } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
import { sessions, type SessionRecord } from '#/schema/sessions';
import { isSessionLive } from '#/service/session-liveness';

function toRecord(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    subjectId: row.subjectId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastActiveAt: row.lastActiveAt,
  };
}

export interface NewSession {
  id: string;
  realmId: string;
  subjectId: string;
  expiresAt: Date;
}

// All persistence for an established SSO session. `byId` is what a later
// request — /authorize's single-sign-on check, or a logout handler — resolves
// the `__Host-<realm>-session` cookie's value against.
export function sessionRepository(tx: RealmScopedDatabase) {
  return {
    async byId(id: string): Promise<SessionRecord | null> {
      const rows = await tx.select().from(sessions).where(eq(sessions.id, id));
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    async create(values: NewSession): Promise<void> {
      await tx.insert(sessions).values(values);
    },

    // The read every session consumer uses. `byId` still exists and still
    // ignores liveness, because the reaper and a future session list need to
    // see a dead row; nothing that authenticates should call it.
    async liveById(id: string, idleSeconds: number, now: Date): Promise<SessionRecord | null> {
      const record = await this.byId(id);
      if (record === null) return null;
      return isSessionLive(record, idleSeconds, now) ? record : null;
    },

    async touch(id: string, now: Date): Promise<void> {
      await tx.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, id));
    },
  };
}
