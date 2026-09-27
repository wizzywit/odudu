import {
  sessionRepository,
  sessions,
  type SessionLifespans,
  type SessionRecord,
} from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { subjects } from '@odudu/domain-identity';
import { endSession as endOidcSession, tokenGrantRepository } from '@odudu/protocol-oidc';
import { asc, eq } from 'drizzle-orm';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

const COLLECTION = 'sessions';

export interface SessionView {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly remembered: boolean;
  readonly clientIds: readonly string[];
}

// `session.end_all` is filed on the subject, since it names no one session;
// each session it ended also carries its own `session.ended` row.
export interface SessionAuditEvent {
  readonly action: 'session.end' | 'session.end_all';
  readonly resourceType: 'session' | 'subject';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed' | 'refused' | 'failed';
  readonly detail?: Record<string, unknown>;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same transactional write. */
export type Audit = (tx: TenantScopedDatabase, event: SessionAuditEvent) => Promise<void>;

// One round trip for a whole page of sessions, keyed back to the session
// each grant came from — `clientsForSession`'s own per-session form would
// be one round trip per row on a full page.
async function clientIdsBySession(
  tx: TenantScopedDatabase,
  sessionIds: readonly string[],
): Promise<Map<string, string[]>> {
  const targets = await tokenGrantRepository(tx).clientsForSessions(sessionIds);
  const bySession = new Map<string, string[]>();
  for (const target of targets) {
    const existing = bySession.get(target.sessionId) ?? [];
    existing.push(target.oauthClientId);
    bySession.set(target.sessionId, existing);
  }
  return bySession;
}

// Keyset pagination over `liveBySubject`'s own `id`-ordered result, the
// same cursor semantics `listSubjects` and `listClients` apply in SQL —
// realized in memory here because liveness itself is not a SQL predicate.
function afterCursor(live: readonly SessionRecord[], after: string | undefined): SessionRecord[] {
  if (after === undefined) return [...live];
  const cursor = after;
  return live.filter((record) => record.id > cursor);
}

function toView(record: SessionRecord, clientIds: readonly string[]): SessionView {
  return {
    id: record.id,
    createdAt: record.createdAt,
    lastActiveAt: record.lastActiveAt,
    remembered: record.remembered,
    clientIds,
  };
}

export interface ListSessionsInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly lifespans: SessionLifespans;
  readonly now: Date;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

export type ListSessionsOutcome =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: SessionView[]; next: string | null };

// Live sessions only, the same as every other session consumer
// (`sessionRepository.liveBySubject`'s own comment) — a dead row is the
// reaper's business, never an operator's. `liveBySubject` already orders
// by `id`, so keyset pagination over it is exact the same way `listSubjects`
// and `listClients` page their own SQL-ordered reads.
export async function listSessions(
  tx: TenantScopedDatabase,
  input: ListSessionsInput,
): Promise<ListSessionsOutcome> {
  const filters = filterDigest({});
  let after: string | undefined;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(
      input.cursorKey,
      COLLECTION,
      input.tenantId,
      filters,
      input.cursor,
    );
    if (decoded.kind === 'invalid') return { kind: 'invalid_cursor' };
    after = decoded.after;
  }

  const live = await sessionRepository(tx).liveBySubject(
    input.subjectId,
    input.lifespans,
    input.now,
  );
  const page = afterCursor(live, after);
  const hasMore = page.length > input.limit;
  const slice = hasMore ? page.slice(0, input.limit) : page;

  const clientIds = await clientIdsBySession(
    tx,
    slice.map((record) => record.id),
  );
  const items = slice.map((record) => toView(record, clientIds.get(record.id) ?? []));

  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(input.cursorKey, {
          after: last.id,
          collection: COLLECTION,
          tenantId: input.tenantId,
          filters,
        })
      : null;

  return { kind: 'ok', items, next };
}

export interface EndSessionInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly issuer: string;
  readonly now: Date;
}

export interface EndSessionDeps {
  readonly audit: Audit;
  readonly kek: Uint8Array;
}

export type EndSessionOutcome = { kind: 'not_found' } | { kind: 'ended' };

// Locked so the ownership check below and P3b's own end-session write run
// against the one row a concurrent amendment cannot move out from under
// them — the same reasoning `lockSubjectForAmend` (#/usecase/subjects.ts)
// locks its subject row for, even though `endOidcSession` is itself
// idempotent and a second call alone could skip the lock safely.
async function lockOwnedSession(
  tx: TenantScopedDatabase,
  subjectId: string,
  sessionId: string,
): Promise<typeof sessions.$inferSelect | null> {
  const rows = await tx.select().from(sessions).where(eq(sessions.id, sessionId)).for('update');
  const row = rows[0];
  return row?.subjectId === subjectId ? row : null;
}

// The same `endSession` the RP-Initiated Logout usecase calls
// (`@odudu/protocol-oidc`), so there is one path that ends a session, not
// two. No front-channel delivery: see docs/admin-paths.md's sessions
// section. A second end changes nothing — `sessionRepository.end` moves
// only a ceiling still ahead of now, `revokeForSession` keeps the first
// stamp with `coalesce`, and a repeat delivery is deduped by
// `backchannel_logout_deliveries_dedupe`.
export async function endSession(
  tx: TenantScopedDatabase,
  deps: EndSessionDeps,
  input: EndSessionInput,
): Promise<EndSessionOutcome> {
  const locked = await lockOwnedSession(tx, input.subjectId, input.sessionId);
  if (locked === null) return { kind: 'not_found' };

  await endOidcSession(
    tx,
    { kek: deps.kek },
    {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      subjectId: input.subjectId,
      now: input.now,
      issuer: input.issuer,
      via: 'admin',
    },
  );

  await deps.audit(tx, {
    action: 'session.end',
    resourceType: 'session',
    resourceId: input.sessionId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
  });

  return { kind: 'ended' };
}

export interface EndAllSessionsInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly lifespans: SessionLifespans;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly issuer: string;
  readonly now: Date;
}

export type EndAllSessionsOutcome = { kind: 'not_found' } | { kind: 'ended'; ended: number };

// Every live session through the same `endSession` one session's `DELETE`
// makes, so each has its grants revoked and its back-channel deliveries
// enqueued exactly as ending it alone would — rather than `endMany`, which
// moves the ceilings and nothing else. The sessions are locked first, in
// `id` order, so a concurrent single end serializes against this one.
export async function endAllSessions(
  tx: TenantScopedDatabase,
  deps: EndSessionDeps,
  input: EndAllSessionsInput,
): Promise<EndAllSessionsOutcome> {
  const found = await tx
    .select({ id: subjects.id })
    .from(subjects)
    .where(eq(subjects.id, input.subjectId));
  if (found.length === 0) return { kind: 'not_found' };

  await tx
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.subjectId, input.subjectId))
    .orderBy(asc(sessions.id))
    .for('update');
  const live = await sessionRepository(tx).liveBySubject(
    input.subjectId,
    input.lifespans,
    input.now,
  );
  for (const record of live) {
    await endOidcSession(
      tx,
      { kek: deps.kek },
      {
        tenantId: input.tenantId,
        sessionId: record.id,
        subjectId: input.subjectId,
        now: input.now,
        issuer: input.issuer,
        via: 'admin',
      },
    );
  }

  await deps.audit(tx, {
    action: 'session.end_all',
    resourceType: 'subject',
    resourceId: input.subjectId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: { ended: live.length },
  });

  return { kind: 'ended', ended: live.length };
}
