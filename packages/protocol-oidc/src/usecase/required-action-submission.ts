import { type TotpEnrolmentOutcome } from '@odudu/authn-flows';
import { type RealmLookup } from '#/repository/realm-lookup';

export type RequiredActionOutcome =
  // No live authentication session, or one no factor has bound to a subject
  // yet. Treated exactly as the login form treats a missing auth_session_id:
  // there is nobody to act for, so there is nothing to do.
  | { kind: 'unauthenticated' }
  // A pending action with no submission to satisfy it. configure-passkey and
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

  if (action !== 'configure-totp') {
    return { kind: 'unsupported', action: action ?? '' };
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
