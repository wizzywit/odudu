import { type RequiredAction, type TotpEnrolmentOutcome } from '@odudu/authn-flows';
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
  // An owed action with no submission to satisfy it. configure-passkey and
  // generate-recovery-codes are here until they have one.
  | { kind: 'unsupported'; action: string }
  // The action is done and the parked login is waiting; the caller resumes it.
  | { kind: 'completed'; authSessionId: string }
  | { kind: 'rejected'; authSessionId: string; subjectId: string; reason: string };

export interface RequiredActionSubmission {
  authSessionId: string | undefined;
  action: string | undefined;
  secret: string | undefined;
  code: string | undefined;
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
}

export async function handleRequiredActionSubmission(
  deps: RequiredActionSubmissionDeps,
  realmName: string,
  submission: RequiredActionSubmission,
): Promise<RequiredActionOutcome> {
  const { authSessionId, action } = submission;
  if (authSessionId === undefined || authSessionId.length === 0) {
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
    reason: 'That code did not match. Try the next one your app shows.',
  };
}
