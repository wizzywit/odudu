import { eq } from 'drizzle-orm';
import { type RealmScopedDatabase } from '@odudu/db';
import { newId, systemClock, type Clock } from '@odudu/kernel';
import {
  authenticationSessions,
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';
import { sessions } from '#/schema/sessions';
import { type AuthenticatorResult } from '#/schema/authenticator';
import { passwordStep } from '#/service/authenticators/password';

type StepName = 'password';

// P1 registers exactly one authenticator behind one linear step. Keeping
// this a list, dispatched through a lookup rather than inlined, is the whole
// point: P2 replaces it with a tree of REQUIRED/ALTERNATIVE/CONDITIONAL/
// DISABLED requirements without changing what a caller of `advance` sees.
const STEPS: readonly StepName[] = ['password'];

const AUTHENTICATORS: Record<
  StepName,
  (tx: RealmScopedDatabase, input: AdvanceInput) => Promise<AuthenticatorResult>
> = {
  password: passwordStep,
};

const AUTH_SESSION_TTL_MS = 30 * 60_000;
// An SSO session outlives any one authentication: 12 hours covers a working
// day without forcing a re-login mid-session.
const SESSION_TTL_MS = 12 * 60 * 60_000;

function toRecord(row: typeof authenticationSessions.$inferSelect): AuthenticationSessionRecord {
  return {
    id: row.id,
    realmId: row.realmId,
    pendingRequest: row.pendingRequest as PendingRequest,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

export async function startAuthentication(
  tx: RealmScopedDatabase,
  realmId: string,
  request: PendingRequest,
  clock: Clock = systemClock,
): Promise<{ authSessionId: string }> {
  const id = newId();
  await tx.insert(authenticationSessions).values({
    id,
    realmId,
    pendingRequest: request,
    expiresAt: new Date(clock.now().getTime() + AUTH_SESSION_TTL_MS),
  });
  return { authSessionId: id };
}

export async function loadPendingRequest(
  tx: RealmScopedDatabase,
  authSessionId: string,
): Promise<PendingRequest | null> {
  const rows = await tx
    .select()
    .from(authenticationSessions)
    .where(eq(authenticationSessions.id, authSessionId));
  const row = rows[0];
  return row === undefined ? null : toRecord(row).pendingRequest;
}

export interface AdvanceInput {
  username?: string;
  password?: string;
}

export async function advance(
  tx: RealmScopedDatabase,
  authSessionId: string,
  input: AdvanceInput,
  clock: Clock = systemClock,
): Promise<AuthenticatorResult> {
  const rows = await tx
    .select()
    .from(authenticationSessions)
    .where(eq(authenticationSessions.id, authSessionId));
  const row = rows[0];
  if (row === undefined || row.expiresAt.getTime() <= clock.now().getTime()) {
    return { kind: 'failure', reason: 'authentication_session_expired' };
  }

  // Exactly one step exists in P1; the lookup still goes through the list so
  // a second step (P2) is an addition here, not a rewrite of `advance`.
  const step = STEPS[0];
  if (step === undefined) {
    throw new Error('no authentication steps registered');
  }
  return AUTHENTICATORS[step](tx, input);
}

export async function establishSession(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
  clock: Clock = systemClock,
): Promise<{ sessionId: string }> {
  // Always a fresh id, even for the same subject: reusing the pre-auth id
  // here is exactly the session-fixation hole this function exists to close.
  const id = newId();
  await tx.insert(sessions).values({
    id,
    realmId,
    subjectId,
    expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS),
  });
  return { sessionId: id };
}
