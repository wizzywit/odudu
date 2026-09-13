import { type RealmScopedDatabase } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { newId, systemClock, type Clock } from '@odudu/kernel';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { sessionRepository } from '#/repository/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { type AuthenticatorResult } from '#/schema/authenticator';
import { passwordStep, type PasswordVerification } from '#/service/authenticators/password';

type StepName = 'password';

// P1 registers exactly one authenticator behind one linear step. Keeping
// this a list, dispatched through a lookup rather than inlined, is the whole
// point: P2 replaces it with a tree of REQUIRED/ALTERNATIVE/CONDITIONAL/
// DISABLED requirements without changing what a caller of `advance` sees.
const STEPS: readonly StepName[] = ['password'];

// Never assigned to a real subject (subject ids come from `newId()`), so a
// lookup against it always misses — which is the point: it lets the
// unknown-user path issue the exact same credential query as the
// wrong-password path, rather than skipping it.
const DUMMY_SUBJECT_ID = '00000000-0000-0000-0000-000000000000';

async function passwordVerificationFor(
  tx: RealmScopedDatabase,
  username: string,
): Promise<PasswordVerification> {
  const found = await userRepository(tx).byUsername(username);
  const storedHash = await credentialRepository(tx).passwordFor(
    found === null ? DUMMY_SUBJECT_ID : found.subject.id,
  );
  return { subjectId: found === null ? null : found.subject.id, storedHash };
}

async function runPasswordStep(
  tx: RealmScopedDatabase,
  input: AdvanceInput,
): Promise<AuthenticatorResult> {
  if (input.username === undefined || input.password === undefined) {
    return passwordStep(input, { subjectId: null, storedHash: null });
  }
  return passwordStep(input, await passwordVerificationFor(tx, input.username));
}

const AUTHENTICATORS: Record<
  StepName,
  (tx: RealmScopedDatabase, input: AdvanceInput) => Promise<AuthenticatorResult>
> = {
  password: runPasswordStep,
};

const AUTH_SESSION_TTL_MS = 30 * 60_000;
// An SSO session outlives any one authentication: 12 hours covers a working
// day without forcing a re-login mid-session.
const SESSION_TTL_MS = 12 * 60 * 60_000;

export async function startAuthentication(
  tx: RealmScopedDatabase,
  realmId: string,
  request: PendingRequest,
  clock: Clock = systemClock,
): Promise<{ authSessionId: string }> {
  const id = newId();
  await authenticationSessionRepository(tx).create({
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
  const record = await authenticationSessionRepository(tx).byId(authSessionId);
  return record === null ? null : record.pendingRequest;
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
  const record = await authenticationSessionRepository(tx).byId(authSessionId);
  if (record === null || record.expiresAt.getTime() <= clock.now().getTime()) {
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

// The gate that makes an authentication session single-use. The caller
// (protocol-oidc's login-submission wiring) must run this in the same
// transaction as issuing whatever the successful login produces, so a
// failure past this point rolls the consume back with it rather than
// stranding a consumed session with nothing issued for it.
export async function consumeAuthenticationSession(
  tx: RealmScopedDatabase,
  authSessionId: string,
  clock: Clock = systemClock,
): Promise<boolean> {
  return authenticationSessionRepository(tx).consume(authSessionId, clock.now());
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
  await sessionRepository(tx).create({
    id,
    realmId,
    subjectId,
    expiresAt: new Date(clock.now().getTime() + SESSION_TTL_MS),
  });
  return { sessionId: id };
}
