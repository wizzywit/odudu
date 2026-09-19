import { eq, inArray } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
import { sessions, type SessionRecord } from '#/schema/sessions';
import { isSessionLive } from '#/service/session-liveness';
import { lifespanFor, type SessionLifespans } from '#/service/session-lifespan';

function toRecord(row: typeof sessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    subjectId: row.subjectId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastActiveAt: row.lastActiveAt,
    authenticators: row.authenticators,
    remembered: row.remembered,
  };
}

export interface NewSession {
  id: string;
  realmId: string;
  subjectId: string;
  expiresAt: Date;
  authenticators: string[];
  // Omitted, a fresh session is ordinary — the schema's own default
  // (packages/authn-flows/src/schema/sessions.ts). establishSession is the
  // only caller with a login's own choice to record.
  remembered?: boolean;
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

    // Logout ends a session by moving its own ceiling to now, rather than
    // deleting the row or adding a second "ended" state: `isSessionLive`'s
    // exclusive `now >= expiresAt` check already treats that as dead from
    // this instant, and the reaping pass a later increment adds removes the
    // row itself. Idempotent — ending an already-dead session only ever
    // moves `expires_at` earlier or leaves it where it was.
    async end(id: string, now: Date): Promise<void> {
      await tx.update(sessions).set({ expiresAt: now }).where(eq(sessions.id, id));
    },

    // The set read every session consumer uses now that a browser may hold
    // more than one. Liveness is applied in the same pass rather than by the
    // caller, so no caller can forget the idle window — and each record is
    // measured against its own pair, picked by its own `remembered` column,
    // so a remembered session beside an ordinary one is never checked
    // against the other's window.
    async liveByIds(
      ids: readonly string[],
      realm: SessionLifespans,
      now: Date,
    ): Promise<SessionRecord[]> {
      if (ids.length === 0) return [];
      const rows = await tx
        .select()
        .from(sessions)
        .where(inArray(sessions.id, [...ids]));
      return rows.map(toRecord).filter((record) => {
        const { idleSeconds } = lifespanFor(realm, record.remembered);
        return isSessionLive(record, idleSeconds, now);
      });
    },

    async endMany(ids: readonly string[], now: Date): Promise<void> {
      if (ids.length === 0) return;
      await tx
        .update(sessions)
        .set({ expiresAt: now })
        .where(inArray(sessions.id, [...ids]));
    },
  };
}
