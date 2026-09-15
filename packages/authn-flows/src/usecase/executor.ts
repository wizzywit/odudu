import { type RealmScopedDatabase } from '@odudu/db';
import { credentialRepository, userRepository } from '@odudu/domain-identity';
import { newId, systemClock, type Clock } from '@odudu/kernel';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { executionRepository } from '#/repository/executions';
import { sessionRepository } from '#/repository/sessions';
import {
  type AuthenticationSessionRecord,
  type PendingRequest,
} from '#/schema/authentication-sessions';
import { type AuthenticatorResult } from '#/schema/authenticator';
import { nextStep, type Step } from '#/service/requirements';
import { passwordStep, type PasswordVerification } from '#/service/authenticators/password';

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

// passkey and otp are registered so a flow row naming either resolves (see
// isRegisteredAuthenticator) even though neither has a runtime yet — a real
// implementation replaces this once one exists. Reachable only if
// isApplicable is ever wrong about one of them, which would itself be the
// bug to fix, not this function.
function unimplementedAuthenticator(name: string): Promise<AuthenticatorResult> {
  return Promise.reject(
    new Error(`authenticator '${name}' is registered but has no runtime implementation yet`),
  );
}

type RealmAuthenticatorFn = (
  tx: RealmScopedDatabase,
  input: AdvanceInput,
) => Promise<AuthenticatorResult>;

const AUTHENTICATORS: Record<string, RealmAuthenticatorFn> = {
  password: runPasswordStep,
  passkey: () => unimplementedAuthenticator('passkey'),
  otp: () => unimplementedAuthenticator('otp'),
};

// The registry is what can tell an unresolvable authenticator name apart
// from one that simply has not run yet — checked when a flow is
// provisioned (see provision-flow.ts), so a typo in a row surfaces at
// startup rather than the first time somebody tries to log in against it.
export function isRegisteredAuthenticator(name: string): boolean {
  return Object.hasOwn(AUTHENTICATORS, name);
}

// password has no enrollment concept, so it is offered unconditionally —
// the same decision whether the subject is real or not, which is what
// keeps DUMMY_SUBJECT_ID meaningful. passkey and otp would need "does this
// subject have a credential of this type" — domain-identity's
// credentialRepository can answer that (listFor) now that user_credentials
// holds more than password rows, but neither authenticator has a runtime
// here yet (see unimplementedAuthenticator) to call it from.
function isApplicable(authenticator: string): boolean {
  return authenticator === 'password';
}

async function loadSteps(tx: RealmScopedDatabase, realmId: string): Promise<Step[]> {
  const executions = await executionRepository(tx).forRealm(realmId);
  return executions.map((execution) => ({
    authenticator: execution.authenticator,
    requirement: execution.requirement,
    applicable: isApplicable(execution.authenticator),
  }));
}

function bindRegistry(tx: RealmScopedDatabase): Record<string, AuthenticatorFn> {
  const bound: Record<string, AuthenticatorFn> = {};
  for (const [name, fn] of Object.entries(AUTHENTICATORS)) {
    bound[name] = (input) => fn(tx, input);
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
    steps: await loadSteps(tx, record.realmId),
    satisfied: new Set(record.satisfied),
    registry: bindRegistry(tx),
  };
}

// A realm whose flow cannot authenticate anyone right now — no rows at
// all, or every row inapplicable to every subject — reports the same
// reason whether that is discovered before a session exists (initialChallenge)
// or mid-session (advance): there is nothing a caller can submit that would
// change the answer.
const NO_APPLICABLE_EXECUTION = 'no_applicable_execution';

// What /authorize renders before any authentication session exists: the
// first thing this realm's flow would ask for, with nothing submitted yet.
// A 'failure' here means the flow has no reachable execution at all — the
// state OIDC Core §3.1.2.1 calls "reauthentication cannot be performed".
export async function initialChallenge(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<AuthenticatorResult> {
  const steps = await loadSteps(tx, realmId);
  const registry = bindRegistry(tx);
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

  // Whether this login is done, or a further factor remains, decided
  // before anything is written: two outcomes downstream of this function
  // (an id_token_hint naming a different subject, an unverified email)
  // leave the session unconsumed on purpose so the same session can retry
  // — and a retry has to re-run this authenticator exactly as the first
  // attempt did, not find it already satisfied. Persisting is therefore
  // only for a factor that has more work left after it, never for the one
  // that finishes the login.
  const updatedSatisfied = new Set(satisfied);
  updatedSatisfied.add(authenticator);
  const after = await dispatchNext(registry, steps, updatedSatisfied, {});

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
    subjectId: result.subjectId,
    authenticators: [...record.satisfied, authenticator],
  };
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
