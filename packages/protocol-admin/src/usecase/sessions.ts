import {
  sessionRepository,
  sessions,
  type SessionLifespans,
  type SessionRecord,
} from '@odudu/authn-flows';
import { type TenantScopedDatabase } from '@odudu/db';
import { tenantSettingsRepository } from '@odudu/domain-tenant';
import { endSession as endOidcSession, tokenGrantRepository } from '@odudu/protocol-oidc';
import { eq } from 'drizzle-orm';

export interface SessionView {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastActiveAt: Date;
  readonly remembered: boolean;
  readonly clientIds: readonly string[];
}

export interface SessionAuditEvent {
  readonly action: 'session.end';
  readonly resourceType: 'session';
  readonly resourceId: string;
  readonly actorSubjectId: string;
}

/** See `Audit` in `#/usecase/tenants.ts` — the same no-op-until-a-real-sink seam. */
export type Audit = (event: SessionAuditEvent) => Promise<void>;

// The four `tenants` columns liveness needs, read off the settings table
// rather than threaded in from the route: this usecase already has an open
// transaction on the target tenant, so there is no second door for these
// to disagree through.
async function lifespansFor(tx: TenantScopedDatabase, tenantId: string): Promise<SessionLifespans> {
  const settings = await tenantSettingsRepository(tx).byId(tenantId);
  if (settings === null) {
    throw new Error(`protocol-admin: tenant ${tenantId} has no settings row`);
  }
  const {
    sso_session_idle_seconds,
    sso_session_max_seconds,
    remember_me_idle_seconds,
    remember_me_max_seconds,
  } = settings;
  if (
    typeof sso_session_idle_seconds !== 'number' ||
    typeof sso_session_max_seconds !== 'number' ||
    typeof remember_me_idle_seconds !== 'number' ||
    typeof remember_me_max_seconds !== 'number'
  ) {
    throw new Error(`protocol-admin: tenant ${tenantId} has a non-numeric session lifespan`);
  }
  return {
    ssoSessionIdleSeconds: sso_session_idle_seconds,
    ssoSessionMaxSeconds: sso_session_max_seconds,
    rememberMeIdleSeconds: remember_me_idle_seconds,
    rememberMeMaxSeconds: remember_me_max_seconds,
  };
}

async function clientIdsFor(tx: TenantScopedDatabase, sessionId: string): Promise<string[]> {
  const targets = await tokenGrantRepository(tx).clientsForSession(sessionId);
  return targets.map((target) => target.oauthClientId);
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
  readonly now: Date;
}

// Live sessions only, the same as every other session consumer
// (`sessionRepository.liveBySubject`'s own comment) — a dead row is the
// reaper's business, never an operator's. A subject with no live sessions
// and a subject that does not exist look identical here — an empty list —
// the same answer `liveBySubject` itself gives either way.
export async function listSessions(
  tx: TenantScopedDatabase,
  input: ListSessionsInput,
): Promise<SessionView[]> {
  const lifespans = await lifespansFor(tx, input.tenantId);
  const live = await sessionRepository(tx).liveBySubject(input.subjectId, lifespans, input.now);
  return Promise.all(live.map(async (record) => toView(record, await clientIdsFor(tx, record.id))));
}

export interface EndSessionInput {
  readonly tenantId: string;
  readonly subjectId: string;
  readonly sessionId: string;
  readonly actorSubjectId: string;
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

// Reuses P3b's own `endSession` unchanged — the same call the RP-Initiated
// Logout usecase makes (`@odudu/protocol-oidc`) — so there is one path
// that ends a session, not two. No front-channel delivery: see
// docs/admin-paths.md's sessions section for why none is attempted here.
// Ending an already-ended session is a no-op: `endOidcSession` only ever
// moves `expires_at` earlier, and a repeat delivery for the same client
// is deduped by `backchannel_logout_deliveries_dedupe`.
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
    },
  );

  await deps.audit({
    action: 'session.end',
    resourceType: 'session',
    resourceId: input.sessionId,
    actorSubjectId: input.actorSubjectId,
  });

  return { kind: 'ended' };
}
