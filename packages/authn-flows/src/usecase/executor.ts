import { type RealmScopedDatabase } from '@odudu/db';
import {
  credentialRepository,
  isLockedOut,
  loginFailureRepository,
  userRepository,
  type LockoutPolicy,
} from '@odudu/domain-identity';
import { newId, systemClock, type Clock } from '@odudu/kernel';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { executionRepository } from '#/repository/executions';
import { realmSettingsRepository } from '#/repository/realm-settings';
import { requiredActionRepository } from '#/repository/required-actions';
import { sessionRepository } from '#/repository/sessions';
import { recordPasswordExpiryIfOwed } from '#/usecase/update-password';
import {
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';
import { type AuthenticatorResult } from '#/schema/authenticator';
import { nextStep, type Step } from '#/service/requirements';
import { passwordStep, type PasswordVerification } from '#/service/authenticators/password';
import {
  assertionOffered,
  passkeyStep,
  type WebauthnSecret,
} from '#/service/authenticators/passkey';
import { OTP, PASSKEY, PASSWORD, RECOVERY_CODE } from '#/service/authenticators/names';
import {
  recoveryApplicable,
  recoveryCodeOffered,
  recoveryStep,
  type StoredRecoveryCode,
} from '#/service/authenticators/recovery';
import { otpApplicable, totpStep, type TotpSecret } from '#/service/authenticators/totp';
import { assertedCredentialId } from '#/service/webauthn';

// Never assigned to a real subject (subject ids come from `newId()`), so a
// lookup against it always misses — which is the point: it lets the
// unknown-user path issue the exact same credential query, lockout read and
// failure write as the wrong-password path, rather than skipping any of
// them. The write is keyed through an RLS-scoped read of `subjects`, so an
// id no subject holds stores nothing and violates no foreign key (see
// loginFailureRepository).
const DUMMY_SUBJECT_ID = '00000000-0000-0000-0000-000000000000';

interface PasswordAttempt {
  verification: PasswordVerification;
  // Whatever the username resolved to, or the placeholder above — what the
  // credential lookup, the lockout read and the failure write are all keyed
  // on, so the same four statements run whether the account exists or not.
  keyedOn: string;
  onRecord: { lockedUntil: Date | null };
}

async function passwordAttemptFor(
  tx: RealmScopedDatabase,
  username: string,
): Promise<PasswordAttempt> {
  const found = await userRepository(tx).byUsername(username);
  const keyedOn = found === null ? DUMMY_SUBJECT_ID : found.subject.id;
  const storedHash = await credentialRepository(tx).passwordFor(keyedOn);
  const onRecord = await loginFailureRepository(tx).forSubject(keyedOn);
  return {
    verification: { subjectId: found === null ? null : found.subject.id, storedHash },
    keyedOn,
    onRecord,
  };
}

// RFC 6749 §2.3.1's brute-force protection. Three things make the refusal
// worth nothing to whoever provoked it: it is the failure a wrong password
// returns, byte for byte, because a page saying "locked" would confirm both
// that the account exists and that somebody is attacking it; it is decided
// after the verification a wrong password pays for, so it cannot be told
// apart by how fast it answers; and the attempt still counts, so a locked
// account costs the same statements as an unlocked one.
async function runPasswordStep(
  tx: RealmScopedDatabase,
  input: AdvanceInput,
  context: StepContext,
): Promise<AuthenticatorResult> {
  if (input.username === undefined || input.password === undefined) {
    return passwordStep(input, { subjectId: null, storedHash: null });
  }
  const attempt = await passwordAttemptFor(tx, input.username);
  const outcome = await passwordStep(input, attempt.verification);
  const failures = loginFailureRepository(tx);

  if (outcome.kind === 'success' && !isLockedOut(attempt.onRecord, context.now)) {
    // A correct password ends the run of failures before it. Never for a
    // locked account: the lockout is what refuses this attempt, and
    // clearing the counter would let whoever holds the password shorten
    // their own lockout by spending it.
    await failures.clear(attempt.keyedOn);
    return outcome;
  }

  await failures.recordFailure(attempt.keyedOn, context.lockout, context.now);
  return { kind: 'failure', reason: 'invalid_credentials' };
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

async function storedRecoveryCodesFor(
  tx: RealmScopedDatabase,
  subjectId: string,
): Promise<StoredRecoveryCode[]> {
  const records = await credentialRepository(tx).listFor(subjectId, 'recovery-code');
  return records.flatMap((record) =>
    record.secret.kind === 'recovery-code' ? [{ id: record.id, secret: record.secret }] : [],
  );
}

// The subject comes from the authentication session, for the same reason the
// OTP step's does: a code says which list it was printed from, not who is
// signing in.
async function runRecoveryStep(
  tx: RealmScopedDatabase,
  input: AdvanceInput,
  context: StepContext,
): Promise<AuthenticatorResult> {
  const { subjectId } = context;
  const codes = subjectId === null ? [] : await storedRecoveryCodesFor(tx, subjectId);
  const outcome = await recoveryStep(input, { subjectId, codes });
  if (outcome.kind !== 'success') return outcome;

  // Deferred rather than written here, even though this step resolves its
  // codes from the bound subject: spending a code is irreversible and the
  // whole list is finite, so it happens once `advance` has confirmed the
  // attempt is this subject's and is going to succeed. A refusal is a code
  // a concurrent submission spent first, which makes this presentation of
  // it the second one.
  const { credentialId } = outcome;
  return {
    kind: 'success',
    subjectId: outcome.subjectId,
    commit: () => credentialRepository(tx).spendRecoveryCode(credentialId, context.now),
  };
}

// The assertion names its own credential, so resolution runs before any
// signature is checked — verifyAuthenticationResponse takes the stored
// credential as an input, and there is nothing else this early to look it
// up by. byLookupKey is realm-scoped by RLS, so a credential id from
// another realm resolves to nothing rather than to somebody else's subject.
async function passkeyCredentialFor(
  tx: RealmScopedDatabase,
  assertion: unknown,
): Promise<{ id: string; subjectId: string; secret: WebauthnSecret } | null> {
  const credentialId = assertedCredentialId(assertion);
  if (credentialId === null) return null;
  const record = await credentialRepository(tx).byLookupKey(credentialId);
  if (record?.type !== 'webauthn' || record.secret.kind !== 'webauthn') return null;
  return { id: record.id, subjectId: record.subjectId, secret: record.secret };
}

async function runPasskeyStep(
  tx: RealmScopedDatabase,
  input: AdvanceInput,
  context: StepContext,
): Promise<AuthenticatorResult> {
  if (!assertionOffered(input)) {
    return passkeyStep(input, {
      credential: null,
      expectedChallenge: null,
      publicBaseUrl: context.publicBaseUrl,
    });
  }

  const credential = await passkeyCredentialFor(tx, input.assertion);
  // Reading and clearing the challenge is a single statement whose whole
  // point is that a replay finds nothing (see claimWebauthnChallenge): it
  // must not be undone by anything this transaction does afterwards, so
  // nothing here catches a database error around it.
  const expectedChallenge =
    context.authSessionId === null
      ? null
      : await authenticationSessionRepository(tx).claimWebauthnChallenge(context.authSessionId);
  const outcome = await passkeyStep(input, {
    credential,
    expectedChallenge,
    publicBaseUrl: context.publicBaseUrl,
  });
  if (outcome.kind !== 'success') return outcome;

  // Deferred rather than written here: unlike the OTP step, a passkey names
  // the subject instead of being handed one, so the counter must not move
  // until `advance` has confirmed this assertion answers for the subject the
  // attempt is already bound to.
  const { credentialId, counter } = outcome;
  return {
    kind: 'success',
    subjectId: outcome.subjectId,
    commit: () =>
      credentialRepository(tx).advanceWebauthnCounter(credentialId, counter, context.now),
  };
}

// What the caller already knows about the attempt before any authenticator
// runs: whose it is (null until a factor has said), which attempt it is,
// the instant the caller's clock reports, and where this deployment is
// published (null where no relying party can be derived, which is the one
// state a passkey cannot be asserted from).
interface StepContext {
  subjectId: string | null;
  authSessionId: string | null;
  now: Date;
  publicBaseUrl: string | null;
  // The realm's own brute-force numbers, read alongside every other switch
  // one `advance` needs (see realmSettingsRepository.flowSettings).
  lockout: LockoutPolicy;
}

type RealmAuthenticatorFn = (
  tx: RealmScopedDatabase,
  input: AdvanceInput,
  context: StepContext,
) => Promise<AuthenticatorResult>;

const AUTHENTICATORS: Record<string, RealmAuthenticatorFn> = {
  [PASSWORD]: runPasswordStep,
  [PASSKEY]: runPasskeyStep,
  [OTP]: runOtpStep,
  [RECOVERY_CODE]: runRecoveryStep,
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
// factor succeeds), the realm's own switches, what the attempt has already
// satisfied, and whether this submission carries a passkey assertion.
interface FlowFacts {
  hasTotp: boolean;
  hasRecoveryCodes: boolean;
  otpRequired: boolean;
  // Zero where the realm does not age passwords out, which is the default.
  passwordMaxAgeDays: number;
  lockout: LockoutPolicy;
  satisfied: ReadonlySet<string>;
  assertionOffered: boolean;
  recoveryCodeOffered: boolean;
}

interface FactsRequest {
  subjectId: string | null;
  satisfied: ReadonlySet<string>;
  assertionOffered: boolean;
  recoveryCodeOffered: boolean;
}

async function flowFacts(
  tx: RealmScopedDatabase,
  realmId: string,
  request: FactsRequest,
): Promise<FlowFacts> {
  const settings = await realmSettingsRepository(tx).flowSettings(realmId);
  const { subjectId } = request;
  const hasTotp = subjectId !== null && (await storedTotpFor(tx, subjectId)) !== null;
  // Only when this submission carries a code: the recovery step is
  // inapplicable without one, so nothing the count could change is read.
  const hasRecoveryCodes =
    request.recoveryCodeOffered &&
    subjectId !== null &&
    (await storedRecoveryCodesFor(tx, subjectId)).length > 0;
  return {
    hasTotp,
    hasRecoveryCodes,
    otpRequired: settings.otpRequired,
    passwordMaxAgeDays: settings.passwordMaxAgeDays,
    lockout: settings.lockout,
    satisfied: request.satisfied,
    assertionOffered: request.assertionOffered,
    recoveryCodeOffered: request.recoveryCodeOffered,
  };
}

function otpApplies(facts: FlowFacts): boolean {
  return otpApplicable(
    { hasTotp: facts.hasTotp },
    { otpRequired: facts.otpRequired },
    facts.satisfied,
  );
}

// password has no enrollment concept, so it is offered unconditionally —
// the same decision whether the subject is real or not, which is what
// keeps DUMMY_SUBJECT_ID meaningful. otp runs only for a subject who has a
// credential to answer it with; otpApplies' other case is enrolmentOwed
// below, not a step.
function isApplicable(
  authenticator: string,
  facts: FlowFacts,
  // Whether the recovery-code step will actually run for this submission:
  // the realm's flow carries the step, and it applies to this subject. The
  // only thing the OTP step is allowed to stand down for — a factor may
  // stand down only for one that stands up in its place, because a
  // conditional group with no applicable member counts as satisfied
  // (isGroupSatisfied in #/service/requirements).
  recoveryCarriesTheSecondFactor: boolean,
): boolean {
  if (authenticator === PASSWORD) return true;
  // passkey shares an ALTERNATIVE group with password, and a group offers
  // one form at a time, so an always-applicable usernameless passkey would
  // take the group and password would never be reachable. With nothing
  // submitted the group falls through to password, whose page is what
  // offers the passkey button. The cost: a realm that disables password and
  // keeps only passkey answers no_applicable_execution and cannot be signed
  // into, since nothing here can be satisfied without an assertion the
  // unrendered page would have produced (docs/NEXT.md has the fix).
  if (authenticator === PASSKEY) return facts.assertionOffered;
  if (authenticator === RECOVERY_CODE) {
    return recoveryApplicable(
      { hasRecoveryCodes: facts.hasRecoveryCodes },
      facts.recoveryCodeOffered,
      otpApplies(facts),
      facts.satisfied,
    );
  }
  if (authenticator !== OTP) return false;
  // A recovery code is presented instead of a code from the app, so the OTP
  // step stands down for a submission whose recovery step is going to run —
  // never merely for one carrying a recovery_code field, which is the
  // submission's to choose and would stand the second factor down with
  // nothing standing up in its place.
  if (recoveryCarriesTheSecondFactor) return false;
  // And stays down once a code has been accepted: a subject who used one
  // because they lost their authenticator must not then be asked for a code
  // from it.
  if (facts.satisfied.has(RECOVERY_CODE)) return false;
  // Decided here rather than in otpApplicable, so enrolmentOwed still sees a
  // realm that requires a second factor.
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
  request: FactsRequest,
): Promise<{ steps: Step[]; facts: FlowFacts }> {
  const executions = await executionRepository(tx).forRealm(realmId);
  const facts = await flowFacts(tx, realmId, request);
  // A realm whose flow never had the recovery-code row — one provisioned
  // before it existed, or one that disabled it — has no recovery step for
  // the OTP step to stand down for, however the submission is shaped. The
  // row is read here because this is the only place the flow's own
  // executions are in hand.
  const recoveryCarriesTheSecondFactor =
    executions.some(
      (execution) =>
        execution.authenticator === RECOVERY_CODE && execution.requirement !== 'disabled',
    ) && isApplicable(RECOVERY_CODE, facts, false);
  return {
    facts,
    steps: executions.map((execution) => ({
      authenticator: execution.authenticator,
      requirement: execution.requirement,
      applicable: isApplicable(execution.authenticator, facts, recoveryCarriesTheSecondFactor),
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
  // One of the ten single-use codes issued by generate-recovery-codes, as
  // it was typed — normalised where it is verified, not here.
  recoveryCode?: string;
  // The JSON navigator.credentials.get() produced, as it arrived.
  assertion?: unknown;
}

// What the attempt needs from the deployment rather than from the
// submission. `publicBaseUrl` is the only source of a WebAuthn relying
// party id (see service/webauthn.ts); absent, a passkey cannot be asserted
// and nothing else changes.
export interface AdvanceOptions {
  publicBaseUrl?: string;
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
  input: AdvanceInput,
  options: AdvanceOptions,
): Promise<FlowContext | null> {
  const record = await authenticationSessionRepository(tx).byId(authSessionId);
  if (record === null || record.expiresAt.getTime() <= clock.now().getTime()) {
    return null;
  }
  const satisfied = new Set(record.satisfied);
  const loaded = await loadSteps(tx, record.realmId, {
    subjectId: record.subjectId,
    satisfied,
    assertionOffered: assertionOffered(input),
    recoveryCodeOffered: recoveryCodeOffered(input),
  });
  return {
    record,
    steps: loaded.steps,
    satisfied,
    registry: bindRegistry(tx, {
      subjectId: record.subjectId,
      authSessionId,
      now: clock.now(),
      publicBaseUrl: options.publicBaseUrl ?? null,
      lockout: loaded.facts.lockout,
    }),
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
  // has said who they are. No assertion either — there is no attempt yet
  // for a challenge to have been offered against.
  const { steps, facts } = await loadSteps(tx, realmId, {
    subjectId: null,
    satisfied: new Set(),
    assertionOffered: false,
    recoveryCodeOffered: false,
  });
  const registry = bindRegistry(tx, {
    subjectId: null,
    authSessionId: null,
    now: clock.now(),
    publicBaseUrl: null,
    lockout: facts.lockout,
  });
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
  const context = await loadFlowContext(tx, authSessionId, clock, {}, {});
  if (context === null) {
    return { kind: 'failure', reason: 'authentication_session_expired' };
  }
  const dispatched = await dispatchNext(context.registry, context.steps, context.satisfied, {});
  if (dispatched.kind !== 'ran') {
    return { kind: 'failure', reason: NO_APPLICABLE_EXECUTION };
  }
  return dispatched.result;
}

// A result with no `commit` left to run, which is what makes it safe to
// read a subject off. `AuthenticatorResult` allows a deferred write and a
// dropped one is silent, so the second dispatch's result is put through
// `settle` and typed as this rather than used directly.
type SettledResult =
  | { kind: 'success'; subjectId: string }
  | { kind: 'challenge'; form: string }
  | { kind: 'failure'; reason: string };

// Runs whatever a factor deferred, under the same two rules the first
// factor's `commit` passes: it must answer for the subject this attempt is
// bound to, and its write must land. Nothing submitted can reach here today
// — the second dispatch runs with an empty input, and every factor
// challenges on that — but the type permits a write and there is no warning
// for dropping one, so it is run rather than trusted not to exist.
async function settle(result: AuthenticatorResult, boundTo: string): Promise<SettledResult> {
  if (result.kind !== 'success') return result;
  if (result.subjectId !== boundTo) return { kind: 'failure', reason: SUBJECT_MISMATCH };
  if (result.commit !== undefined && !(await result.commit())) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }
  return { kind: 'success', subjectId: result.subjectId };
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
  options: AdvanceOptions = {},
): Promise<AdvanceOutcome> {
  const context = await loadFlowContext(tx, authSessionId, clock, input, options);
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

  // Whatever the factor deferred until it was clear the attempt is this
  // subject's — a passkey's signature counter, which moves only once the
  // guard above has passed. A refusal here is a factor that verified but
  // whose state had already moved on (a replayed assertion racing the one
  // that spent the same counter), so the login is refused with it.
  if (result.commit !== undefined && !(await result.commit())) {
    return { kind: 'failure', reason: 'invalid_credentials' };
  }

  const subjectId = result.subjectId;
  await authenticationSessionRepository(tx).bindSubject(authSessionId, subjectId);

  // Everything after this point is decided for this subject, so the flow is
  // re-read for them: until the first factor succeeded, nothing here knew
  // whether a second one applies at all. The authenticator that just
  // succeeded counts as satisfied for that re-read — a passkey is two
  // factors, and whether a conditional OTP step still applies depends on
  // having seen it.
  const updatedSatisfied = new Set(satisfied);
  updatedSatisfied.add(authenticator);
  const { steps: stepsForSubject, facts } = await loadSteps(tx, record.realmId, {
    subjectId,
    satisfied: updatedSatisfied,
    assertionOffered: assertionOffered(input),
    recoveryCodeOffered: recoveryCodeOffered(input),
  });
  await recordOtpEnrolmentIfOwed(tx, record.realmId, subjectId, facts);
  // Collected after the factor succeeded and before the required-action
  // gate reads what is owed, which is the whole of what keeps an aged-out
  // password from being a lockout: the login still authenticates, and only
  // its completion waits for the change.
  await recordPasswordExpiryIfOwed(tx, record.realmId, subjectId, facts.passwordMaxAgeDays, clock);

  // Whether this login is done, or a further factor remains, decided
  // before `satisfied` is written: two outcomes downstream of this function
  // (an id_token_hint naming a different subject, an unverified email)
  // leave the session unconsumed on purpose so the same session can retry
  // — and a retry has to re-run this authenticator exactly as the first
  // attempt did, not find it already satisfied. Persisting is therefore
  // only for a factor that has more work left after it, never for the one
  // that finishes the login.
  const forSubject = bindRegistry(tx, {
    subjectId,
    authSessionId,
    now: clock.now(),
    publicBaseUrl: options.publicBaseUrl ?? null,
    lockout: facts.lockout,
  });
  const after = await dispatchNext(forSubject, stepsForSubject, updatedSatisfied, {});

  let outcome: AdvanceOutcome;
  if (after.kind === 'ran') {
    await authenticationSessionRepository(tx).recordSatisfied(authSessionId, authenticator);
    const settled = await settle(after.result, subjectId);
    outcome =
      settled.kind === 'success'
        ? {
            kind: 'success',
            subjectId: settled.subjectId,
            authenticators: [...record.satisfied, authenticator, after.authenticator],
          }
        : settled;
  } else if (after.kind === 'fail') {
    outcome = { kind: 'failure', reason: NO_APPLICABLE_EXECUTION };
  } else {
    outcome = { kind: 'success', subjectId, authenticators: [...record.satisfied, authenticator] };
  }

  // What a required-action submission is judged against, since it carries no
  // credentials of its own and the subject binding above is written by the
  // *first* factor. Written on every attempt, not latched: enrolling a
  // factor makes a step apply that did not a moment ago, so a session that
  // had run out of steps has to stop having run out of them.
  await authenticationSessionRepository(tx).recordAuthenticated(
    authSessionId,
    outcome.kind === 'success' ? clock.now() : null,
  );
  return outcome;
}

// Whom a required-action submission may act for: the subject a *finished*
// authentication bound to this session. The binding alone is not enough —
// the first factor writes it while later ones are still outstanding, and
// one required action prints ten recovery codes that stand in for the
// second factor.
export async function authenticatedSubject(
  tx: RealmScopedDatabase,
  authSessionId: string,
  clock: Clock = systemClock,
): Promise<string | null> {
  const record = await authenticationSessionRepository(tx).byId(authSessionId);
  if (record === null || record.expiresAt.getTime() <= clock.now().getTime()) return null;
  // A session that has already driven a login to an authorization code is
  // spent: anything it owed was owed before that, so an action arriving
  // against it now is a form the browser still had open.
  if (record.consumedAt !== null || record.authenticatedAt === null) return null;
  return record.subjectId;
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
