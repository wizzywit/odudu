import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  handleRequiredActionSubmission,
  type RequiredActionSubmissionDeps,
} from '#/usecase/required-action-submission';

const REALM = {
  id: 'realm-1',
  enabled: true,
  verifyEmail: false,
  ssoSessionMaxSeconds: 36_000,
  ssoSessionIdleSeconds: 1_800,
};

const SUBMISSION = {
  authSessionId: 'auth-session-1',
  action: 'configure-totp',
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  code: '123456',
  credential: undefined,
  label: undefined,
};

interface Harness {
  deps: RequiredActionSubmissionDeps;
  findRealm: Mock;
  boundSubject: Mock;
  pendingActions: Mock;
  completeTotpEnrolment: Mock;
  completePasskeyEnrolment: Mock;
}

function harness(): Harness {
  const findRealm = vi.fn().mockResolvedValue(REALM);
  const boundSubject = vi.fn().mockResolvedValue('subject-1');
  const pendingActions = vi.fn().mockResolvedValue(['configure-totp']);
  const completeTotpEnrolment = vi.fn().mockResolvedValue({ kind: 'enrolled' });
  const completePasskeyEnrolment = vi
    .fn()
    .mockResolvedValue({ kind: 'enrolled', credentialId: 'credential-1' });
  return {
    deps: {
      findRealm,
      boundSubject,
      pendingActions,
      completeTotpEnrolment,
      completePasskeyEnrolment,
    },
    findRealm,
    boundSubject,
    pendingActions,
    completeTotpEnrolment,
    completePasskeyEnrolment,
  };
}

describe('handleRequiredActionSubmission — who is allowed to act', () => {
  it('refuses a submission carrying no authentication session', async () => {
    const { deps, completeTotpEnrolment } = harness();

    const outcome = await handleRequiredActionSubmission(deps, 'acme', {
      ...SUBMISSION,
      authSessionId: undefined,
    });

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('refuses a submission against a session no factor has bound to a subject', async () => {
    const { deps, boundSubject, completeTotpEnrolment } = harness();
    boundSubject.mockResolvedValue(null);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION);

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('refuses a submission against a disabled realm', async () => {
    const { deps, findRealm } = harness();
    findRealm.mockResolvedValue({ ...REALM, enabled: false });

    expect(await handleRequiredActionSubmission(deps, 'acme', SUBMISSION)).toEqual({
      kind: 'unauthenticated',
    });
  });

  // Passing a factor is permission to finish the login that asked for it,
  // not permission to attach a credential nobody asked for: a stolen
  // password would otherwise buy an attacker a TOTP credential that applies
  // to every later login and survives the password reset.
  it('enrols nothing for a subject who owes no configure-totp', async () => {
    const { deps, pendingActions, completeTotpEnrolment } = harness();
    pendingActions.mockResolvedValue([]);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION);

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('enrols nothing when the subject owes a different action', async () => {
    const { deps, pendingActions, completeTotpEnrolment } = harness();
    pendingActions.mockResolvedValue(['update-password']);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION);

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('refuses a submission naming no action at all', async () => {
    const { deps } = harness();

    const outcome = await handleRequiredActionSubmission(deps, 'acme', {
      ...SUBMISSION,
      action: undefined,
    });

    expect(outcome).toEqual({ kind: 'not_owed', action: '' });
  });

  it('refuses an owed action this route has no submission for', async () => {
    const { deps, pendingActions, completeTotpEnrolment } = harness();
    pendingActions.mockResolvedValue(['generate-recovery-codes']);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', {
      ...SUBMISSION,
      action: 'generate-recovery-codes',
    });

    expect(outcome).toEqual({ kind: 'unsupported', action: 'generate-recovery-codes' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  // No ODUDU_PUBLIC_BASE_URL, so no relying party id, so nothing to
  // register a passkey against: the deployment has no enrolment to offer
  // rather than one bound to a guessed domain.
  it('refuses a passkey enrolment on a deployment with no relying party', async () => {
    const { deps, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);
    const withoutPasskeys: RequiredActionSubmissionDeps = {
      findRealm: (name) => deps.findRealm(name),
      boundSubject: (realmId, authSessionId) => deps.boundSubject(realmId, authSessionId),
      pendingActions: (realmId, subjectId) => deps.pendingActions(realmId, subjectId),
      completeTotpEnrolment: (input) => deps.completeTotpEnrolment(input),
    };

    const outcome = await handleRequiredActionSubmission(withoutPasskeys, 'acme', {
      ...SUBMISSION,
      action: 'configure-passkey',
    });

    expect(outcome).toEqual({ kind: 'unsupported', action: 'configure-passkey' });
  });
});

describe('handleRequiredActionSubmission — enrolling the owed factor', () => {
  it('completes the action for the bound subject and the submitted code', async () => {
    const { deps, completeTotpEnrolment } = harness();

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: 'auth-session-1' });
    expect(completeTotpEnrolment).toHaveBeenCalledWith({
      realmId: 'realm-1',
      subjectId: 'subject-1',
      secret: SUBMISSION.secret,
      code: SUBMISSION.code,
    });
  });

  it('reports a wrong code back to the same attempt', async () => {
    const { deps, completeTotpEnrolment } = harness();
    completeTotpEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'invalid_code' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION);

    expect(outcome).toMatchObject({
      kind: 'rejected',
      authSessionId: 'auth-session-1',
      subjectId: 'subject-1',
      action: 'configure-totp',
    });
  });

  // A resubmitted form, or a second tab, finds the credential the first one
  // wrote — the action it was owed for is done either way.
  it('treats an already-enrolled subject as having completed the action', async () => {
    const { deps, completeTotpEnrolment } = harness();
    completeTotpEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'already_enrolled' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: 'auth-session-1' });
  });
});

describe('handleRequiredActionSubmission — enrolling a passkey', () => {
  it('hands the response on as parsed JSON, with the attempt it belongs to', async () => {
    const { deps, completePasskeyEnrolment, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', {
      ...SUBMISSION,
      action: 'configure-passkey',
      credential: '{"id":"abc"}',
      label: 'Yubikey',
    });

    expect(outcome).toEqual({ kind: 'completed', authSessionId: 'auth-session-1' });
    expect(completePasskeyEnrolment).toHaveBeenCalledWith({
      realmId: 'realm-1',
      subjectId: 'subject-1',
      authSessionId: 'auth-session-1',
      response: { id: 'abc' },
      label: 'Yubikey',
    });
  });

  // A field that is not JSON at all is the same kind of nothing as a
  // missing one: the enrolment decides, and it has no response to verify.
  it('passes undefined on for a credential field that is not JSON', async () => {
    const { deps, completePasskeyEnrolment, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);
    completePasskeyEnrolment.mockResolvedValue({
      kind: 'rejected',
      reason: 'invalid_response',
    });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', {
      ...SUBMISSION,
      action: 'configure-passkey',
      credential: 'not-json',
    });

    expect(completePasskeyEnrolment).toHaveBeenCalledWith(
      expect.objectContaining({ response: undefined }),
    );
    expect(outcome).toMatchObject({ kind: 'rejected', action: 'configure-passkey' });
  });

  it('reports a spent challenge back to the same attempt', async () => {
    const { deps, completePasskeyEnrolment, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);
    completePasskeyEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'no_challenge' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', {
      ...SUBMISSION,
      action: 'configure-passkey',
      credential: '{}',
    });

    expect(outcome).toMatchObject({
      kind: 'rejected',
      authSessionId: 'auth-session-1',
      subjectId: 'subject-1',
      action: 'configure-passkey',
    });
  });
});
