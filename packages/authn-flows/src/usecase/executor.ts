import { type RealmScopedDatabase } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { newId, systemClock, type Clock } from '@odudu/kernel';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { executionRepository } from '#/repository/executions';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { requiredActionRepository } from '#/repository/required-actions';
import { sessionRepository } from '#/repository/sessions';
import {
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';
import { type AuthenticatorResult } from '#/schema/authenticator';
import { nextStep, type Step } from '#/service/requirements';
import { passwordStep, type PasswordVerification } from '#/service/authenticators/password';
import { otpApplicable, totpStep, type TotpSecret } from '#/service/authenticators/totp';

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

interface StoredTotp {
  id: string;
  secret: TotpSecret;
}

async function storedTotpFor(
  tx: RealmScopedDatabase,
  subjectId: string,
): Promise<StoredTotp | null> {
  const [record] = await credentialRepository(tx).listFor(subjectId, 'totp');
  if (record?.secret.kind !== 'totp') return null;
  return { id: record.id, secret: record.secret };
}

// The subject comes from the authentication session, never from the
// submission: a code says which secret it was computed from, not who is
// signing in, so letting the form name the account is how a second factor
// ends up answering for somebody who never passed the first one.
async function runOtpStep(
  tx: RealmScopedDatabase,
  input: AdvanceInput,
  context: StepContext,
): Promise<AuthenticatorResult> {
  const stored = context.subjectId === null ? null : await storedTotpFor(tx, context.subjectId);
  const outcome = totpStep(input, {
    subjectId: context.subjectId,
    secret: stored === null ? null : stored.secret,
    now: context.now,
  });

  if (outcome.kind !== 'success' || stored === null) return outcome;

  // RFC 6238 §5.2's other half (docs/protocols/rfc6238.md): verifyTotp
  // refuses a step at or below the credential's lastStep, and this write is
  // what makes the step that just validated one of those. It can refuse —
  // a concurrent submission of the same code spends the step first — and
  // then the code this call accepted was the second use of it.
  const spent = await credentialRepository(tx).recordTotpUse(stored.id, outcome.step, context.now);
  // Written before `advance`'s subject-binding guard runs, which is safe
  // only because this step resolves its secret from the bound subject and
  // therefore cannot answer for anybody else. A factor that identifies its
  // own subject — a passkey assertion — must not spend anything until that
  // guard has passed.
  return spent ? outcome : { kind: 'failure', reason: 'invalid_credentials' };
}

// passkey is registered so a flow row naming it resolves (see
// isRegisteredAuthenticator) even though it has no runtime yet — a real
// implementation replaces this once one exists. Reachable only if
// isApplicable is ever wrong about it, which would itself be the bug to
// fix, not this function.
function unimplementedAuthenticator(name: string): Promise<AuthenticatorResult> {
  return Promise.reject(
    new Error(`authenticator '${name}' is registered but has no runtime implementation yet`),
  );
}

// What the caller already knows about the attempt before any authenticator
// runs: whose it is (null until a factor has said), and the instant the
// caller's clock reports.
interface StepContext {
  subjectId: string | null;
  now: Date;
}

type RealmAuthenticatorFn = (
  tx: RealmScopedDatabase,
  input: AdvanceInput,
  context: StepContext,
) => Promise<AuthenticatorResult>;

const AUTHENTICATORS: Record<string, RealmAuthenticatorFn> = {
  password: runPasswordStep,
  passkey: () => unimplementedAuthenticator('passkey'),
  otp: runOtpStep,
};

// The registry is what can tell an unresolvable authenticator name apart
// from one that simply has not run yet — checked when a flow is
// provisioned (see provision-flow.ts), so a typo in a row surfaces at
// startup rather than the first time somebody tries to log in against it.
export function isRegisteredAuthenticator(name: string): boolean {
  return Object.hasOwn(AUTHENTICATORS, name);
}

// What the flow's applicability decisions are made against: the subject the
// attempt is bound to (nothing is known about anybody before the first
// factor succeeds) and the realm's own switches.
interface FlowFacts {
  hasTotp: boolean;
  otpRequired: boolean;
}

async function flowFacts(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string | null,
): Promise<FlowFacts> {
  const otpRequired = await realmSettingsRepository(tx).otpRequired(realmId);
  const hasTotp = subjectId !== null && (await storedTotpFor(tx, subjectId)) !== null;
  return { hasTotp, otpRequired };
}

function otpApplies(facts: FlowFacts): boolean {
  return otpApplicable({ hasTotp: facts.hasTotp }, { otpRequired: facts.otpRequired });
}

// password has no enrollment concept, so it is offered unconditionally —
// the same decision whether the subject is real or not, which is what
// keeps DUMMY_SUBJECT_ID meaningful. otp runs only for a subject who has a
// credential to answer it with; otpApplies' other case is enrolmentOwed
// below, not a step. passkey has no runtime yet.
function isApplicable(authenticator: string, facts: FlowFacts): boolean {
  if (authenticator === 'password') return true;
  if (authenticator !== 'otp') return false;
  return otpApplies(facts) && facts.hasTotp;
}

// A realm that requires a second factor from somebody who has not enrolled
// one cannot express that as a step: asking for a code nobody can produce
// parks the login for good, and the required-action gate that would rescue
// it sits downstream of a successful authentication. It is collected as
// the configure-totp required action instead.
function enrolmentOwed(facts: FlowFacts): boolean {
  return otpApplies(facts) && !facts.hasTotp;
}

// Returns the facts alongside the steps rather than making the caller ask
// for them again: deciding what a subject owes reads exactly what deciding
// which step runs read, so it is the same two queries either way.
async function loadSteps(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string | null,
): Promise<{ steps: Step[]; facts: FlowFacts }> {
  const executions = await executionRepository(tx).forRealm(realmId);
  const facts = await flowFacts(tx, realmId, subjectId);
  return {
    facts,
    steps: executions.map((execution) => ({
      authenticator: execution.authenticator,
      requirement: execution.requirement,
      applicable: isApplicable(execution.authenticator, facts),
    })),
  };
}

function bindRegistry(
  tx: RealmScopedDatabase,
  context: StepContext,
): Record<string, AuthenticatorFn> {
  const bound: Record<string, AuthenticatorFn> = {};
  for (const [name, fn] of Object.entries(AUTHENTICATORS)) {
    bound[name] = (input) => fn(tx, input, context);
  }
  return bound;
}

// The seam a unit test dispatches through with a fake registry: no `tx`,
// because by the time a name reaches here the caller has already bound one
// (or, in a test, has nothing to bind — a fake authenticator ignores its
// input the same way a real one reads it).
export type AuthenticatorFn = (input: AdvanceInput) => Promise<AuthenticatorResult>;

export type Dispatch =
  | { kind: 'ran'; authenticator: string; result: AuthenticatorResult }
  | { kind: 'complete' }
  | { kind: 'fail' };

// One decision-and-run, against whatever registry and satisfied set the
// caller hands in. Exported so a satisfied factor is never asked for twice
// — offering the next unsatisfied execution rather than the first — can be
// proven as a property of this dispatch against a fake registry,
// independent of which authenticators are real.
export async function dispatchNext(
  registry: Record<string, AuthenticatorFn>,
  steps: readonly Step[],
  satisfied: ReadonlySet<string>,
  input: AdvanceInput,
): Promise<Dispatch> {
  const decision = nextStep(steps, { satisfied });
  if (decision.kind === 'fail') return { kind: 'fail' };
  if (decision.kind === 'complete') return { kind: 'complete' };

  const run = registry[decision.authenticator];
  if (run === undefined) {
    throw new Error(`authenticator '${decision.authenticator}' is not registered`);
  }
  return { kind: 'ran', authenticator: decision.authenticator, result: await run(input) };
}

const AUTH_SESSION_TTL_MS = 30 * 60_000;

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
  code?: string;
}

interface FlowContext {
  record: AuthenticationSessionRecord;
  steps: Step[];
  satisfied: Set<string>;
  registry: Record<string, AuthenticatorFn>;
}

async function loadFlowContext(
  tx: RealmScopedDatabase,
  authSessionId: string,
  clock: Clock,
): Promise<FlowContext | null> {
  const record = await authenticationSessionRepository(tx).byId(authSessionId);
  if (record === null || record.expiresAt.getTime() <= clock.now().getTime()) {
    return null;
  }
  return {
    record,
    steps: (await loadSteps(tx, record.realmId, record.subjectId)).steps,
    satisfied: new Set(record.satisfied),
    registry: bindRegistry(tx, { subjectId: record.subjectId, now: clock.now() }),
  };
}

// A realm whose flow cannot authenticate anyone right now — no rows at
// all, or every row inapplicable to every subject — reports the same
// reason whether that is discovered before a session exists (initialChallenge)
// or mid-session (advance): there is nothing a caller can submit that would
// change the answer.
const NO_APPLICABLE_EXECUTION = 'no_applicable_execution';

// A factor answered for somebody other than the subject this attempt is
// bound to. Reported as a failure rather than a challenge: there is nothing
// the person at the form can resubmit that would make this attempt theirs.
const SUBJECT_MISMATCH = 'subject_mismatch';

// A realm that requires a second factor has to say so somewhere the login
// can act on it, and that is the required action — the flow itself cannot
// ask for a code from somebody who has no credential to produce one.
async function recordOtpEnrolmentIfOwed(
  tx: RealmScopedDatabase,
  realmId: string,
  subjectId: string,
  facts: FlowFacts,
): Promise<void> {
  if (!enrolmentOwed(facts)) return;
  await requiredActionRepository(tx).add(realmId, subjectId, 'configure-totp');
}

// What /authorize renders before any authentication session exists: the
// first thing this realm's flow would ask for, with nothing submitted yet.
// A 'failure' here means the flow has no reachable execution at all — the
// state OIDC Core §3.1.2.1 calls "reauthentication cannot be performed".
export async function initialChallenge(
  tx: RealmScopedDatabase,
  realmId: string,
  clock: Clock = systemClock,
): Promise<AuthenticatorResult> {
  // No subject yet, so no second factor can be applicable: which account a
  // code belongs to is not something /authorize could know before anybody
  // has said who they are.
  const { steps } = await loadSteps(tx, realmId, null);
  const registry = bindRegistry(tx, { subjectId: null, now: clock.now() });
  const dispatched = await dispatchNext(registry, steps, new Set(), {});
  if (dispatched.kind !== 'ran') {
    return { kind: 'failure', reason: NO_APPLICABLE_EXECUTION };
  }
  return dispatched.result;
}

// What a live authentication session is currently waiting on, with nothing
// freshly submitted — used to re-render the right form after a rejected
// attempt, without the caller (the login route) knowing anything about
// requirements or the registry.
export async function pendingChallenge(
  tx: RealmScopedDatabase,
  authSessionId: string,
  clock: Clock = systemClock,
): Promise<AuthenticatorResult> {
  const context = await loadFlowContext(tx, authSessionId, clock);
  if (context === null) {
    return { kind: 'failure', reason: 'authentication_session_expired' };
  }
  const dispatched = await dispatchNext(context.registry, context.steps, context.satisfied, {});
  if (dispatched.kind !== 'ran') {
    return { kind: 'failure', reason: NO_APPLICABLE_EXECUTION };
  }
  return dispatched.result;
}

// What `advance` reports on success — unlike the per-authenticator
// `AuthenticatorResult`, this names every authenticator the login actually
// used, in the order it ran, because that is the record `establishSession`
// needs to carry forward onto the session (see its own doc comment).
export type AdvanceOutcome =
  | { kind: 'success'; subjectId: string; authenticators: string[] }
  | { kind: 'challenge'; form: string }
  | { kind: 'failure'; reason: string };

export async function advance(
  tx: RealmScopedDatabase,
  authSessionId: string,
  input: AdvanceInput,
  clock: Clock = systemClock,
): Promise<AdvanceOutcome> {
  const context = await loadFlowContext(tx, authSessionId, clock);
  if (context === null) {
    return { kind: 'failure', reason: 'authentication_session_expired' };
  }
  const { record, steps, satisfied, registry } = context;

  const dispatched = await dispatchNext(registry, steps, satisfied, input);
  if (dispatched.kind !== 'ran') {
    return { kind: 'failure', reason: NO_APPLICABLE_EXECUTION };
  }

  const { authenticator, result } = dispatched;
  if (result.kind !== 'success') {
    return result;
  }

  // One attempt answers for one person. A factor that names a different
  // subject than the one this attempt is already bound to is refused
  // rather than allowed to redirect the login — whoever passed the earlier
  // factor would otherwise be signed in as whoever passed the later one.
  if (record.subjectId !== null && record.subjectId !== result.subjectId) {
    return { kind: 'failure', reason: SUBJECT_MISMATCH };
  }
  const subjectId = result.subjectId;
  await authenticationSessionRepository(tx).bindSubject(authSessionId, subjectId);

  // Everything after this point is decided for this subject, so the flow is
  // re-read for them: until the first factor succeeded, nothing here knew
  // whether a second one applies at all.
  const { steps: stepsForSubject, facts } = await loadSteps(tx, record.realmId, subjectId);
  await recordOtpEnrolmentIfOwed(tx, record.realmId, subjectId, facts);

  // Whether this login is done, or a further factor remains, decided
  // before `satisfied` is written: two outcomes downstream of this function
  // (an id_token_hint naming a different subject, an unverified email)
  // leave the session unconsumed on purpose so the same session can retry
  // — and a retry has to re-run this authenticator exactly as the first
  // attempt did, not find it already satisfied. Persisting is therefore
  // only for a factor that has more work left after it, never for the one
  // that finishes the login.
  const updatedSatisfied = new Set(satisfied);
  updatedSatisfied.add(authenticator);
  const forSubject = bindRegistry(tx, { subjectId, now: clock.now() });
  const after = await dispatchNext(forSubject, stepsForSubject, updatedSatisfied, {});

  if (after.kind === 'ran') {
    await authenticationSessionRepository(tx).recordSatisfied(authSessionId, authenticator);
    if (after.result.kind !== 'success') return after.result;
    return {
      kind: 'success',
      subjectId: after.result.subjectId,
      authenticators: [...record.satisfied, authenticator, after.authenticator],
    };
  }
  if (after.kind === 'fail') {
    return { kind: 'failure', reason: NO_APPLICABLE_EXECUTION };
  }
  return {
    kind: 'success',
    subjectId,
    authenticators: [...record.satisfied, authenticator],
  };
}

// Puts an attempt back to how it started. The caller is the one refusal
// whose remedy is somebody else signing in against the same parked request
// — an `id_token_hint` naming a subject other than the one who just signed
// in (OIDC Core §3.1.2.1). Every other refusal that leaves the session
// alive is about the bound subject themselves, whose retry is the same
// person continuing, and keeps its progress.
export async function resetAuthenticationProgress(
  tx: RealmScopedDatabase,
  authSessionId: string,
): Promise<void> {
  await authenticationSessionRepository(tx).resetProgress(authSessionId);
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
  maxSeconds: number,
  // What `advance` reported ran, in order — copied onto the session once,
  // here, because a reused session's `amr`/`acr` must go on describing this
  // login rather than being re-derived at every future token issuance.
  authenticators: readonly string[],
  clock: Clock = systemClock,
): Promise<{ sessionId: string }> {
  // Always a fresh id, even for the same subject: reusing the pre-auth id
  // here is exactly the session-fixation hole this function exists to close.
  const id = newId();
  await sessionRepository(tx).create({
    id,
    realmId,
    subjectId,
    authenticators: [...authenticators],
    expiresAt: new Date(clock.now().getTime() + maxSeconds * 1000),
  });
  return { sessionId: id };
}
