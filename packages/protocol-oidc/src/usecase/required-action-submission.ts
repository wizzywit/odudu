import {
  type PasskeyEnrolmentOutcome,
  type RecoveryCodesOutcome,
  type RequiredAction,
  type TotpEnrolmentOutcome,
} from '@odudu/authn-flows';
import { isUuid } from '@odudu/kernel';
import { type RealmLookup } from '#/repository/realm-lookup';

export type RequiredActionOutcome =
  // No live authentication session, or one no factor has bound to a subject
  // yet. Treated exactly as the login form treats a missing auth_session_id:
  // there is nobody to act for, so there is nothing to do.
  | { kind: 'unauthenticated' }
  // The subject does not owe the action this submission claims to satisfy.
  // This is the whole of the endpoint's authorization: passing a factor is
  // permission to finish the login that asked for it, never permission to
  // attach a credential nobody asked for.
  | { kind: 'not_owed'; action: string }
  // An owed action with no submission to satisfy it: configure-passkey on a
  // deployment with no ODUDU_PUBLIC_BASE_URL to derive a relying party from.
  | { kind: 'unsupported'; action: string }
  // The action is done and the parked login is waiting; the caller resumes it.
  | { kind: 'completed'; authSessionId: string }
  | {
      kind: 'rejected';
      authSessionId: string;
      subjectId: string;
      action: RequiredAction;
      reason: string;
    };

export interface RequiredActionSubmission {
  authSessionId: string | undefined;
  action: string | undefined;
  secret: string | undefined;
  code: string | undefined;
  // The JSON navigator.credentials.create() produced, as the passkey page's
  // hidden field carried it back, and the name the user gave it.
  credential: string | undefined;
  label: string | undefined;
}

export interface RequiredActionSubmissionDeps {
  findRealm(name: string): Promise<RealmLookup | null>;
  // The subject the authentication session is bound to — this submission
  // carries no credentials of its own, so that binding is the whole of what
  // says whose account is being changed.
  boundSubject(realmId: string, authSessionId: string): Promise<string | null>;
  // Read fresh on every submission, never cached from the login that
  // rendered the page: an action completed in another tab has to be gone
  // by the time this one is submitted.
  pendingActions(realmId: string, subjectId: string): Promise<readonly RequiredAction[]>;
  completeTotpEnrolment(input: {
    realmId: string;
    subjectId: string;
    secret: string;
    code: string;
  }): Promise<TotpEnrolmentOutcome>;
  // The acknowledgement that the one render of a subject's recovery codes
  // was seen. It carries no code back — the page that displayed them wrote
  // their hashes, and this submission only says the page was read.
  completeRecoveryCodes(input: {
    realmId: string;
    subjectId: string;
  }): Promise<RecoveryCodesOutcome>;
  // Absent when no relying party can be derived — see relyingPartyId in
  // @odudu/authn-flows. A passkey enrolled against a guessed RP ID is
  // unusable and silently so, so the action is reported unsupported rather
  // than attempted.
  completePasskeyEnrolment?(input: {
    realmId: string;
    subjectId: string;
    authSessionId: string;
    response: unknown;
    label?: string;
  }): Promise<PasskeyEnrolmentOutcome>;
}

// What the browser posts is a string; whether it is JSON at all is the
// enrolment's business, so an unparseable field arrives as the `undefined`
// that every other malformed response also produces.
function parseJson(value: string | undefined): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export async function handleRequiredActionSubmission(
  deps: RequiredActionSubmissionDeps,
  realmName: string,
  submission: RequiredActionSubmission,
): Promise<RequiredActionOutcome> {
  const { authSessionId, action } = submission;
  // Shape first, for the reason handleLoginSubmission gives: a value
  // Postgres cannot parse as a uuid names no session, and must not reach
  // the comparison that raises on it.
  if (authSessionId === undefined || !isUuid(authSessionId)) {
    return { kind: 'unauthenticated' };
  }

  const realm = await deps.findRealm(realmName);
  if (!realm?.enabled) return { kind: 'unauthenticated' };

  const subjectId = await deps.boundSubject(realm.id, authSessionId);
  if (subjectId === null) return { kind: 'unauthenticated' };

  // The gate, before any action-specific handling and for every action this
  // route accepts. A bound subject is somebody who passed a factor, which is
  // not the same thing as somebody a realm asked to enrol one: without this,
  // a stolen password buys an attacker a TOTP credential on the account,
  // which then applies to every future login and outlives the password reset
  // that would otherwise have ended the compromise.
  const owed = await deps.pendingActions(realm.id, subjectId);
  if (action === undefined || !owed.some((pending) => pending === action)) {
    return { kind: 'not_owed', action: action ?? '' };
  }

  if (action === 'configure-passkey') {
    return completePasskey(deps, realm.id, subjectId, authSessionId, submission);
  }

  if (action === 'generate-recovery-codes') {
    return acknowledgeRecoveryCodes(deps, realm.id, subjectId, authSessionId);
  }

  if (action !== 'configure-totp') {
    return { kind: 'unsupported', action };
  }

  const outcome = await deps.completeTotpEnrolment({
    realmId: realm.id,
    subjectId,
    secret: submission.secret ?? '',
    code: submission.code ?? '',
  });

  // already_enrolled is not an error to show the user: a resubmitted form,
  // or a second tab, finds the credential the first one wrote, and the
  // action it was owed for is done either way.
  if (outcome.kind === 'enrolled' || outcome.reason === 'already_enrolled') {
    return { kind: 'completed', authSessionId };
  }
  return {
    kind: 'rejected',
    authSessionId,
    subjectId,
    action: 'configure-totp',
    reason: 'That code did not match. Try the next one your app shows.',
  };
}

// The only refusal is none_issued: the acknowledgement arrived for a
// subject with no codes stored, which is a form submitted without the page
// that issues them ever having rendered. The remedy is that page, so the
// rejection re-renders it with a fresh set.
async function acknowledgeRecoveryCodes(
  deps: RequiredActionSubmissionDeps,
  realmId: string,
  subjectId: string,
  authSessionId: string,
): Promise<RequiredActionOutcome> {
  const outcome = await deps.completeRecoveryCodes({ realmId, subjectId });
  if (outcome.kind === 'acknowledged') return { kind: 'completed', authSessionId };
  return {
    kind: 'rejected',
    authSessionId,
    subjectId,
    action: 'generate-recovery-codes',
    reason: 'Save these codes before continuing.',
  };
}

// Both refusals the enrolment can report read the same to whoever is at the
// browser: the ceremony has to be run again, and the retry gets a fresh
// challenge because the page it is rendered on issues one.
async function completePasskey(
  deps: RequiredActionSubmissionDeps,
  realmId: string,
  subjectId: string,
  authSessionId: string,
  submission: RequiredActionSubmission,
): Promise<RequiredActionOutcome> {
  const enrol = deps.completePasskeyEnrolment?.bind(deps);
  if (enrol === undefined) return { kind: 'unsupported', action: 'configure-passkey' };

  const outcome = await enrol({
    realmId,
    subjectId,
    authSessionId,
    response: parseJson(submission.credential),
    ...(submission.label === undefined ? {} : { label: submission.label }),
  });
  if (outcome.kind === 'enrolled') return { kind: 'completed', authSessionId };
  return {
    kind: 'rejected',
    authSessionId,
    subjectId,
    action: 'configure-passkey',
    reason: 'That passkey could not be added. Try again.',
  };
}
