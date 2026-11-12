import { and, asc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
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

/**
 * `stillLive` as a predicate on `sessions`, for a read that pages or counts
 * live sessions in SQL rather than filtering every row it fetched: the same
 * three conditions, each boundary as exclusive as `isSessionLive`'s.
 */
export function liveSessionCondition(tenant: SessionLifespans, now: Date): SQL {
  const at = now.toISOString();
  return sql`(${sessions.secretHash} IS NOT NULL
    AND ${sessions.expiresAt} > ${at}::timestamptz
    AND ${sessions.lastActiveAt} > ${at}::timestamptz - make_interval(secs => CASE
      WHEN ${sessions.remembered} THEN ${tenant.rememberMeIdleSeconds}::integer
      ELSE ${tenant.ssoSessionIdleSeconds}::integer END))`;
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
    deviceId: row.deviceId,
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
  deviceId?: string | null;
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

    // `end` for many sessions in one statement. Returns the ids this call
    // ended, so a caller records only what it did.
    async endAll(ids: readonly string[], now: Date): Promise<string[]> {
      if (ids.length === 0) return [];
      const ended = await tx
        .update(sessions)
        .set({ expiresAt: now })
        .where(and(inArray(sessions.id, [...ids]), gt(sessions.expiresAt, now)))
        .returning({ id: sessions.id });
      return ended.map((row) => row.id);
    },

    // A subject's live sessions, a page at a time in id order, leaving out
    // `except` when it is named. Served by sessions_by_subject.
    async liveIdsFor(
      subjectId: string,
      now: Date,
      limit: number,
      except?: string,
    ): Promise<string[]> {
      const rows = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(
          and(
            eq(sessions.subjectId, subjectId),
            gt(sessions.expiresAt, now),
            except === undefined ? undefined : ne(sessions.id, except),
          ),
        )
        .orderBy(sessions.id)
        .limit(limit);
      return rows.map((row) => row.id);
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

    // The subject's live sessions opened on one device, at most `limit`.
    // Read under the tenant-row lock admission takes, so it sees every
    // session a concurrent admission committed, which the cookie's own id
    // list cannot. The subject condition is what keeps a forged device value
    // from reaching anybody else's sessions; sessions_by_subject serves it.
    async liveByDevice(
      subjectId: string,
      deviceId: string,
      tenant: SessionLifespans,
      now: Date,
      limit: number,
    ): Promise<SessionRecord[]> {
      const rows = await tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.subjectId, subjectId),
            eq(sessions.deviceId, deviceId),
            liveSessionCondition(tenant, now),
          ),
        )
        .orderBy(asc(sessions.id))
        .limit(limit);
      return rows.map(toRecord);
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

    // A page of a subject's live sessions in id order after `after`, at most
    // `limit`, the liveness decided in SQL so the page is bounded whatever the
    // subject holds. Served by sessions_by_subject.
    async livePageBySubject(
      subjectId: string,
      tenant: SessionLifespans,
      now: Date,
      page: { readonly after: string | undefined; readonly limit: number },
    ): Promise<SessionRecord[]> {
      const rows = await tx
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.subjectId, subjectId),
            liveSessionCondition(tenant, now),
            page.after === undefined ? undefined : gt(sessions.id, page.after),
          ),
        )
        .orderBy(asc(sessions.id))
        .limit(page.limit);
      return rows.map(toRecord);
    },

    // When the sign-in behind one of the subject's sessions happened (the
    // `auth_time` it issues), or null when none of theirs by that id is still
    // live. One read by primary key.
    async liveCreatedAt(
      subjectId: string,
      sessionId: string,
      tenant: SessionLifespans,
      now: Date,
    ): Promise<Date | null> {
      const rows = await tx
        .select({ createdAt: sessions.createdAt })
        .from(sessions)
        .where(
          and(
            eq(sessions.id, sessionId),
            eq(sessions.subjectId, subjectId),
            liveSessionCondition(tenant, now),
          ),
        );
      return rows[0]?.createdAt ?? null;
    },

    // Whether the subject owns the session, live or not, taking its row lock
    // so the end that follows runs against the row it checked.
    async lockOwnedId(subjectId: string, sessionId: string): Promise<boolean> {
      const rows = await tx
        .select({ id: sessions.id })
        .from(sessions)
        .where(and(eq(sessions.id, sessionId), eq(sessions.subjectId, subjectId)))
        .for('update');
      return rows.length > 0;
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
