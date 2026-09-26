import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { type TenantScopedDatabase } from '@odudu/db';
import { sessions, type SessionRecord } from '#/schema/sessions';
import { type SessionEntry } from '#/service/session-entry';
import { isSessionLive } from '#/service/session-liveness';
import { lifespanFor, type SessionLifespans } from '#/service/session-lifespan';

type SessionRow = typeof sessions.$inferSelect;

// The liveness arithmetic every live read shares: each row measured against
// the idle window its own `remembered` column picks, and a row with no
// secret hash never live (packages/db/drizzle/0071_session_secret.sql).
function stillLive(row: SessionRow, tenant: SessionLifespans, now: Date): boolean {
  if (row.secretHash === null) return false;
  const { idleSeconds } = lifespanFor(tenant, row.remembered);
  return isSessionLive(row, idleSeconds, now);
}

// A live session together with the entry the browser proved it with — the
// only source a re-emitted cookie can take that entry from.
export interface PresentedSession extends SessionRecord {
  readonly entry: SessionEntry;
}

function toRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
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
  tenantId: string;
  subjectId: string;
  expiresAt: Date;
  authenticators: string[];
  secretHash: string;
  // Omitted, a fresh session is ordinary — the schema's own default
  // (packages/authn-flows/src/schema/sessions.ts). establishSession is the
  // only caller with a login's own choice to record.
  remembered?: boolean;
}

async function rowById(tx: TenantScopedDatabase, id: string): Promise<SessionRow | undefined> {
  const rows = await tx.select().from(sessions).where(eq(sessions.id, id));
  return rows[0];
}

// All persistence for an established SSO session. A browser's cookie is
// resolved through `liveByEntries` alone; every read keyed on a bare id
// serves a caller that already holds the id from somewhere public — a
// token's `sid`, a grant, an operator's request.
export function sessionRepository(tx: TenantScopedDatabase) {
  return {
    async byId(id: string): Promise<SessionRecord | null> {
      const row = await rowById(tx, id);
      return row === undefined ? null : toRecord(row);
    },

    async create(values: NewSession): Promise<void> {
      await tx.insert(sessions).values(values);
    },

    // Whether the session a token or grant names is still live. `byId`
    // still exists and still ignores liveness, because the reaper and a
    // session list need to see a dead row; nothing that authenticates
    // should call it. Takes the whole `SessionLifespans` pair and picks the
    // idle window by the row's own `remembered` column, as every live read
    // does.
    async liveById(id: string, tenant: SessionLifespans, now: Date): Promise<SessionRecord | null> {
      const row = await rowById(tx, id);
      return row !== undefined && stillLive(row, tenant, now) ? toRecord(row) : null;
    },

    async touch(id: string, now: Date): Promise<void> {
      await tx.update(sessions).set({ lastActiveAt: now }).where(eq(sessions.id, id));
    },

    // Logout moves the session's own ceiling to now rather than deleting
    // the row: `isSessionLive`'s exclusive `now >= expiresAt` treats that
    // as dead from this instant, and the reaping pass removes the row.
    //
    // Only a ceiling still ahead of `now` moves: a second end at a later
    // `now` would otherwise push `expires_at` forward, delaying the reaping
    // the first one started. `true` means this call is the one that ended it.
    async end(id: string, now: Date): Promise<boolean> {
      const ended = await tx
        .update(sessions)
        .set({ expiresAt: now })
        .where(and(eq(sessions.id, id), gt(sessions.expiresAt, now)))
        .returning({ id: sessions.id });
      return ended.length > 0;
    },

    // The read a browser's cookie is resolved through. The secret is
    // checked in the same pass as liveness, after a select keyed on the ids
    // alone, so an entry with a wrong secret costs the same statement as an
    // unknown id and comes back exactly as absent. A row presented twice
    // is returned once, with whichever of its entries proved it.
    async liveByEntries(
      entries: readonly SessionEntry[],
      tenant: SessionLifespans,
      now: Date,
    ): Promise<PresentedSession[]> {
      if (entries.length === 0) return [];
      const rows = await tx
        .select()
        .from(sessions)
        .where(inArray(sessions.id, [...new Set(entries.map((entry) => entry.id))]));
      return rows.flatMap((row) => {
        const entry = entries.find(
          (candidate) => candidate.id.toLowerCase() === row.id && candidate.matches(row.secretHash),
        );
        return entry !== undefined && stillLive(row, tenant, now)
          ? [{ ...toRecord(row), entry }]
          : [];
      });
    },

    // The only read keyed on who a session belongs to rather than what a
    // browser's cookie names — so it is the one place an operator can see
    // a session a lost or overwritten cookie orphaned (ADR 0033), remembered
    // ones included, for as long as its own idle window keeps it alive.
    async liveBySubject(
      subjectId: string,
      tenant: SessionLifespans,
      now: Date,
    ): Promise<SessionRecord[]> {
      const rows = await tx
        .select()
        .from(sessions)
        .where(eq(sessions.subjectId, subjectId))
        .orderBy(asc(sessions.id));
      return rows.filter((row) => stillLive(row, tenant, now)).map(toRecord);
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
