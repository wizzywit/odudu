import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  handleRequiredActionSubmission,
  type RequiredActionSubmissionDeps,
} from '#/usecase/required-action-submission';

// A real uuid, not a readable placeholder: the handler shape-checks this
// field before it reaches a `uuid` column, so a placeholder would be
// refused as malformed and prove nothing about the path under test.
const AUTH_SESSION_ID = '01a0a998-8326-7900-8fa6-dd06b842b269';

const TENANT = {
  id: 'tenant-1',
  enabled: true,
  verifyEmail: false,
  ssoSessionMaxSeconds: 36_000,
  ssoSessionIdleSeconds: 1_800,
};

const REQUEST = { requestId: 'request-1', ip: '192.0.2.1' };

const SUBMISSION = {
  authSessionId: AUTH_SESSION_ID,
  action: 'configure-totp',
  secret: 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
  code: '123456',
  credential: undefined,
  label: undefined,
  password: undefined,
  currentPassword: undefined,
  cancel: false,
  confirm: false,
  send: false,
  accept: false,
  form: {},
  endOtherSessions: false,
  issuer: 'https://idp.test/tenants/acme',
};

interface Harness {
  deps: RequiredActionSubmissionDeps;
  findTenant: Mock;
  authenticatedSubject: Mock;
  pendingActions: Mock;
  completeTotpEnrolment: Mock;
  completePasskeyEnrolment: Mock;
  completeRecoveryCodes: Mock;
  completeUpdatePassword: Mock;
  loadPendingRequest: Mock;
  recordActionStep: Mock;
  completeVerifyEmail: Mock;
  sendVerificationLink: Mock;
  completeUpdateProfile: Mock;
  completeAcceptTerms: Mock;
}

function harness(): Harness {
  const findTenant = vi.fn().mockResolvedValue(TENANT);
  const authenticatedSubject = vi.fn().mockResolvedValue('subject-1');
  const pendingActions = vi.fn().mockResolvedValue(['configure-totp']);
  const completeTotpEnrolment = vi.fn().mockResolvedValue({ kind: 'enrolled' });
  const completePasskeyEnrolment = vi
    .fn()
    .mockResolvedValue({ kind: 'enrolled', credentialId: 'credential-1' });
  const completeRecoveryCodes = vi.fn().mockResolvedValue({ kind: 'acknowledged' });
  const completeUpdatePassword = vi.fn().mockResolvedValue({ kind: 'updated' });
  const loadPendingRequest = vi.fn().mockResolvedValue({});
  const recordActionStep = vi.fn().mockResolvedValue(undefined);
  const completeVerifyEmail = vi.fn().mockResolvedValue({ kind: 'verified' });
  const sendVerificationLink = vi.fn().mockResolvedValue('queued');
  const completeUpdateProfile = vi.fn().mockResolvedValue({ kind: 'completed' });
  const completeAcceptTerms = vi.fn().mockResolvedValue({ kind: 'accepted' });
  return {
    deps: {
      findTenant,
      authenticatedSubject,
      pendingActions,
      completeTotpEnrolment,
      completePasskeyEnrolment,
      completeRecoveryCodes,
      completeUpdatePassword,
      loadPendingRequest,
      recordActionStep,
      completeVerifyEmail,
      sendVerificationLink,
      completeUpdateProfile,
      completeAcceptTerms,
    },
    completeVerifyEmail,
    sendVerificationLink,
    completeUpdateProfile,
    completeAcceptTerms,
    loadPendingRequest,
    recordActionStep,
    findTenant,
    authenticatedSubject,
    pendingActions,
    completeTotpEnrolment,
    completePasskeyEnrolment,
    completeRecoveryCodes,
    completeUpdatePassword,
  };
}

const MALFORMED_SESSION_IDS = [
  'not-a-uuid',
  '',
  // Two ids joined by a newline: what a page carrying the field in more than
  // one form gives a client that extracts every match.
  '01a0a998-8326-7900-8fa6-dd06b842b269\n01a0a998-8326-7900-8fa6-dd06b842b269',
  "01a0a998-8326-7900-8fa6-dd06b842b269' or '1'='1",
];

describe('handleRequiredActionSubmission — who is allowed to act', () => {
  it('refuses a submission carrying no authentication session', async () => {
    const { deps, completeTotpEnrolment } = harness();

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        authSessionId: undefined,
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  // Postgres raises on a `uuid` comparison against a value it cannot parse,
  // so a malformed id must be refused here rather than reaching one — an
  // unauthenticated caller does not get to choose what faults.
  it('refuses a malformed authentication session id without looking anything up', async () => {
    for (const authSessionId of MALFORMED_SESSION_IDS) {
      const { deps, authenticatedSubject, completeTotpEnrolment } = harness();

      const outcome = await handleRequiredActionSubmission(
        deps,
        'acme',
        {
          ...SUBMISSION,
          authSessionId,
        },
        REQUEST,
      );

      expect(outcome).toEqual({ kind: 'unauthenticated' });
      expect(authenticatedSubject).not.toHaveBeenCalled();
      expect(completeTotpEnrolment).not.toHaveBeenCalled();
    }
  });

  it('refuses a submission against a session with no finished authentication', async () => {
    const { deps, authenticatedSubject, completeTotpEnrolment } = harness();
    authenticatedSubject.mockResolvedValue(null);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('refuses a submission against a disabled tenant', async () => {
    const { deps, findTenant } = harness();
    findTenant.mockResolvedValue({ ...TENANT, enabled: false });

    expect(await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST)).toEqual({
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

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('enrols nothing when the subject owes a different action', async () => {
    const { deps, pendingActions, completeTotpEnrolment } = harness();
    pendingActions.mockResolvedValue(['update-password']);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  // Owing an action is not the same as being asked for it now. The order
  // required-actions.ts imposes puts the password change first so an expired
  // password can never be used to enrol a second factor, and that has to
  // bind where a submission is judged, not only where a page is chosen.
  it('enrols nothing for an owed action that is not the one owed next', async () => {
    const { deps, pendingActions, completePasskeyEnrolment } = harness();
    pendingActions.mockResolvedValue(['update-password', 'configure-passkey']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'configure-passkey',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-passkey' });
    expect(completePasskeyEnrolment).not.toHaveBeenCalled();
  });

  it('issues no recovery codes for an owed action that is not the one owed next', async () => {
    const { deps, pendingActions, completeRecoveryCodes } = harness();
    pendingActions.mockResolvedValue(['update-password', 'generate-recovery-codes']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'generate-recovery-codes',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'not_owed', action: 'generate-recovery-codes' });
    expect(completeRecoveryCodes).not.toHaveBeenCalled();
  });

  it('refuses a submission naming no action at all', async () => {
    const { deps } = harness();

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: undefined,
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'not_owed', action: '' });
  });

  // The gate is the whole of this route's authorization, and it applies to
  // a password exactly as it applies to an enrolment: a bound subject who
  // was never asked to change their password does not get to set one here.
  it('changes nothing for a subject who owes no update-password', async () => {
    const { deps, pendingActions, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue(['configure-totp']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'update-password',
        password: 'correct horse battery staple',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'not_owed', action: 'update-password' });
    expect(completeUpdatePassword).not.toHaveBeenCalled();
  });

  // The acknowledgement carries no credential of its own, so the gate is
  // the whole of its authorization: a subject who was never asked to
  // generate codes cannot complete the action that writes them.
  it('refuses an acknowledgement of recovery codes nobody asked for', async () => {
    const { deps, pendingActions, completeRecoveryCodes } = harness();
    pendingActions.mockResolvedValue(['configure-totp']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'generate-recovery-codes',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'not_owed', action: 'generate-recovery-codes' });
    expect(completeRecoveryCodes).not.toHaveBeenCalled();
  });

  it('completes the owed generate-recovery-codes action on acknowledgement', async () => {
    const { deps, pendingActions, completeRecoveryCodes } = harness();
    pendingActions.mockResolvedValue(['generate-recovery-codes']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'generate-recovery-codes',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeRecoveryCodes).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      subjectId: 'subject-1',
    });
  });

  // Nothing was issued, which means the page that writes the hashes never
  // rendered: the rejection re-renders it with a fresh set rather than
  // completing an action that protects nobody.
  it('re-renders the page when the acknowledgement finds no codes stored', async () => {
    const { deps, pendingActions, completeRecoveryCodes } = harness();
    pendingActions.mockResolvedValue(['generate-recovery-codes']);
    completeRecoveryCodes.mockResolvedValue({ kind: 'rejected', reason: 'none_issued' });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'generate-recovery-codes',
      },
      REQUEST,
    );

    expect(outcome).toMatchObject({
      kind: 'rejected',
      action: 'generate-recovery-codes',
      subjectId: 'subject-1',
      reason: 'codes_not_saved',
    });
  });

  // No ODUDU_PUBLIC_BASE_URL, so no relying party id, so nothing to
  // register a passkey against: the deployment has no enrolment to offer
  // rather than one bound to a guessed domain.
  it('refuses a passkey enrolment on a deployment with no relying party', async () => {
    const { deps, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);
    const withoutPasskeys: RequiredActionSubmissionDeps = {
      findTenant: (name) => deps.findTenant(name),
      authenticatedSubject: (tenantId, authSessionId) =>
        deps.authenticatedSubject(tenantId, authSessionId),
      pendingActions: (tenantId, subjectId) => deps.pendingActions(tenantId, subjectId),
      completeTotpEnrolment: (input, request) => deps.completeTotpEnrolment(input, request),
      completeRecoveryCodes: (input) => deps.completeRecoveryCodes(input),
      completeUpdatePassword: (input, request) => deps.completeUpdatePassword(input, request),
      completeVerifyEmail: (tenantId, subjectId) => deps.completeVerifyEmail(tenantId, subjectId),
      sendVerificationLink: (tenantId, subjectId, request) =>
        deps.sendVerificationLink(tenantId, subjectId, request),
      completeUpdateProfile: (input, request) => deps.completeUpdateProfile(input, request),
      completeAcceptTerms: (input, request) => deps.completeAcceptTerms(input, request),
      loadPendingRequest: (tenantId, authSessionId) =>
        deps.loadPendingRequest(tenantId, authSessionId),
      recordActionStep: (input, request) => deps.recordActionStep(input, request),
    };

    const outcome = await handleRequiredActionSubmission(
      withoutPasskeys,
      'acme',
      {
        ...SUBMISSION,
        action: 'configure-passkey',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'unsupported', action: 'configure-passkey' });
  });
});

describe('handleRequiredActionSubmission — enrolling the owed factor', () => {
  it('completes the action for the bound subject and the submitted code', async () => {
    const { deps, completeTotpEnrolment } = harness();

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeTotpEnrolment).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        secret: SUBMISSION.secret,
        code: SUBMISSION.code,
        authSessionId: AUTH_SESSION_ID,
      },
      REQUEST,
    );
  });

  it('reports a wrong code back to the same attempt', async () => {
    const { deps, completeTotpEnrolment } = harness();
    completeTotpEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'invalid_code' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toMatchObject({
      kind: 'rejected',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      action: 'configure-totp',
      reason: 'code_mismatch',
    });
  });

  // A resubmitted form, or a second tab, finds the credential the first one
  // wrote — the action it was owed for is done either way.
  it('treats an already-enrolled subject as having completed the action', async () => {
    const { deps, completeTotpEnrolment } = harness();
    completeTotpEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'already_enrolled' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
  });
});

describe('handleRequiredActionSubmission — changing an owed password', () => {
  it('writes the candidate for the bound subject, never one the form names', async () => {
    const { deps, pendingActions, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue(['update-password']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'update-password',
        password: 'correct horse battery staple',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeUpdatePassword).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        password: 'correct horse battery staple',
      },
      REQUEST,
    );
  });

  it('carries every rule the tenant policy reported back to the same attempt', async () => {
    const { deps, pendingActions, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue(['update-password']);
    completeUpdatePassword.mockResolvedValue({
      kind: 'rejected',
      violations: [
        {
          rule: 'min-length',
          message: 'Password must be at least 8 characters long.',
          minLength: 8,
        },
        { rule: 'require-digit', message: 'Password must contain a digit.' },
      ],
    });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'update-password',
        password: 'weak',
      },
      REQUEST,
    );

    expect(outcome).toEqual({
      kind: 'password_rejected',
      authSessionId: AUTH_SESSION_ID,
      violations: [
        {
          rule: 'min-length',
          message: 'Password must be at least 8 characters long.',
          minLength: 8,
        },
        { rule: 'require-digit', message: 'Password must contain a digit.' },
      ],
    });
  });

  // The compare-and-swap found the password already moved, so the candidate
  // this form carried was never stored. Reporting 'completed' would tell the
  // person at the browser their password is one it is not.
  it('does not claim a password was set when another transaction set one first', async () => {
    const { deps, pendingActions, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue(['update-password']);
    completeUpdatePassword.mockResolvedValue({ kind: 'superseded' });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'update-password',
        password: 'correct horse battery staple',
      },
      REQUEST,
    );

    expect(outcome).toMatchObject({
      kind: 'password_rejected',
      authSessionId: AUTH_SESSION_ID,
      violations: [{ rule: 'superseded' }],
    });
    expect(outcome).not.toMatchObject({ kind: 'completed' });
  });

  // A form submitted with the field empty is judged, not special-cased: the
  // tenant's own minimum length is what refuses it, and the page it comes
  // back to says so.
  it('judges a missing password field against the policy rather than accepting it', async () => {
    const { deps, pendingActions, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue(['update-password']);

    await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'update-password',
      },
      REQUEST,
    );

    expect(completeUpdatePassword).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        password: '',
      },
      REQUEST,
    );
  });
});

describe('handleRequiredActionSubmission — enrolling a passkey', () => {
  it('hands the response on as parsed JSON, with the attempt it belongs to', async () => {
    const { deps, completePasskeyEnrolment, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'configure-passkey',
        credential: '{"id":"abc"}',
        label: 'Yubikey',
      },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completePasskeyEnrolment).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        subjectId: 'subject-1',
        authSessionId: AUTH_SESSION_ID,
        response: { id: 'abc' },
        label: 'Yubikey',
      },
      REQUEST,
    );
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

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'configure-passkey',
        credential: 'not-json',
      },
      REQUEST,
    );

    expect(completePasskeyEnrolment).toHaveBeenCalledWith(
      expect.objectContaining({ response: undefined }),
      REQUEST,
    );
    expect(outcome).toMatchObject({
      kind: 'rejected',
      action: 'configure-passkey',
      reason: 'passkey_not_added',
    });
  });

  it('names a passkey that cannot be discovered as its own refusal', async () => {
    const { deps, completePasskeyEnrolment, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);
    completePasskeyEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'not_discoverable' });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, action: 'configure-passkey', credential: '{}' },
      REQUEST,
    );

    expect(outcome).toMatchObject({
      kind: 'rejected',
      action: 'configure-passkey',
      reason: 'passkey_not_discoverable',
    });
  });

  it('reports a spent challenge back to the same attempt', async () => {
    const { deps, completePasskeyEnrolment, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-passkey']);
    completePasskeyEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'no_challenge' });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      {
        ...SUBMISSION,
        action: 'configure-passkey',
        credential: '{}',
      },
      REQUEST,
    );

    expect(outcome).toMatchObject({
      kind: 'rejected',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      action: 'configure-passkey',
    });
  });
});

describe('handleRequiredActionSubmission — an action an application requested', () => {
  const ASKED = { action: 'configure-totp' };

  it('is owed although the tenant owes nothing, and is recorded as a success', async () => {
    const { deps, pendingActions, loadPendingRequest, completeTotpEnrolment, recordActionStep } =
      harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue(ASKED);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeTotpEnrolment).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true }),
      REQUEST,
    );
    expect(recordActionStep).toHaveBeenCalledWith(
      {
        tenantId: 'tenant-1',
        authSessionId: AUTH_SESSION_ID,
        subjectId: 'subject-1',
        action: 'configure-totp',
        step: 'success',
      },
      REQUEST,
    );
  });

  it('is not recorded as a success while the code is refused', async () => {
    const { deps, pendingActions, loadPendingRequest, completeTotpEnrolment, recordActionStep } =
      harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue(ASKED);
    completeTotpEnrolment.mockResolvedValue({ kind: 'rejected', reason: 'invalid_code' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toMatchObject({ kind: 'rejected', action: 'configure-totp' });
    expect(recordActionStep).not.toHaveBeenCalled();
  });

  it('is not owed once it ended, so a second submission changes nothing', async () => {
    const { deps, pendingActions, loadPendingRequest, completeTotpEnrolment } = harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue({ ...ASKED, actionStatus: 'success' });

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('is cancelled by the cancel control, changing nothing', async () => {
    const { deps, pendingActions, loadPendingRequest, completeTotpEnrolment, recordActionStep } =
      harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue(ASKED);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, cancel: true },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
    expect(recordActionStep).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'cancelled', action: 'configure-totp' }),
      REQUEST,
    );
  });

  it('cannot be cancelled into skipping an action the tenant owes', async () => {
    const { deps, pendingActions, recordActionStep } = harness();
    pendingActions.mockResolvedValue(['configure-totp']);

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, cancel: true },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(recordActionStep).not.toHaveBeenCalled();
  });

  it('owes the tenant’s own action first, then this one', async () => {
    const { deps, pendingActions, loadPendingRequest, completeTotpEnrolment } = harness();
    pendingActions.mockResolvedValue(['update-password']);
    loadPendingRequest.mockResolvedValue(ASKED);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(outcome).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(completeTotpEnrolment).not.toHaveBeenCalled();
  });

  it('asks the password change for the current password, an empty one when none came', async () => {
    const { deps, pendingActions, loadPendingRequest, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue({ action: 'update-password' });
    const change = { ...SUBMISSION, action: 'update-password', password: 'new passphrase here' };

    await handleRequiredActionSubmission(deps, 'acme', change, REQUEST);
    await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...change, currentPassword: 'old one' },
      REQUEST,
    );

    const calls = completeUpdatePassword.mock.calls as [{ currentPassword?: string }][];
    const asked = calls.map(([input]) => input.currentPassword);
    expect(asked).toEqual(['', 'old one']);
  });

  it('asks an owed password change for no current password', async () => {
    const { deps, completeUpdatePassword, pendingActions } = harness();
    pendingActions.mockResolvedValue(['update-password']);

    await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, action: 'update-password', password: 'new passphrase here' },
      REQUEST,
    );

    expect(completeUpdatePassword.mock.calls[0]?.[0]).not.toHaveProperty('currentPassword');
  });

  it('records nothing for an action nobody requested', async () => {
    const { deps, recordActionStep } = harness();

    await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);

    expect(recordActionStep).not.toHaveBeenCalled();
  });

  it('offers no way out of an action the tenant also owes, and records a success', async () => {
    const { deps, pendingActions, loadPendingRequest, recordActionStep, completeTotpEnrolment } =
      harness();
    pendingActions.mockResolvedValue(['configure-totp']);
    loadPendingRequest.mockResolvedValue(ASKED);

    const cancelled = await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, cancel: true },
      REQUEST,
    );
    expect(cancelled).toEqual({ kind: 'not_owed', action: 'configure-totp' });
    expect(recordActionStep).not.toHaveBeenCalled();

    await handleRequiredActionSubmission(deps, 'acme', SUBMISSION, REQUEST);
    expect(completeTotpEnrolment.mock.calls[0]?.[0]).not.toHaveProperty('replace');
    expect(recordActionStep).toHaveBeenCalledWith(
      expect.objectContaining({ step: 'success' }),
      REQUEST,
    );
  });

  it('passes the confirmation of a recovery-code replacement on, issuing nothing itself', async () => {
    const { deps, pendingActions, loadPendingRequest, completeRecoveryCodes } = harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue({ action: 'generate-recovery-codes' });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, action: 'generate-recovery-codes', confirm: true },
      REQUEST,
    );

    expect(outcome).toEqual({
      kind: 'confirmed',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      requested: true,
    });
    expect(completeRecoveryCodes).not.toHaveBeenCalled();
  });

  it('ignores a confirmation for a set the tenant owes', async () => {
    const { deps, pendingActions, loadPendingRequest } = harness();
    pendingActions.mockResolvedValue(['generate-recovery-codes']);
    loadPendingRequest.mockResolvedValue({ action: 'generate-recovery-codes' });

    const outcome = await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, action: 'generate-recovery-codes', confirm: true },
      REQUEST,
    );

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
  });
});

describe('handleRequiredActionSubmission — ending the other sessions on a password change', () => {
  const CHANGE = { ...SUBMISSION, action: 'update-password', password: 'correct horse battery' };

  function owing() {
    const made = harness();
    made.pendingActions.mockResolvedValue(['update-password']);
    return made;
  }

  it('asks for the other sessions to end when the box was checked', async () => {
    const { deps, completeUpdatePassword } = owing();
    await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...CHANGE, endOtherSessions: true },
      REQUEST,
    );
    expect(completeUpdatePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        endOtherSessions: { except: null, issuer: 'https://idp.test/tenants/acme' },
      }),
      REQUEST,
    );
  });

  it('leaves the other sessions when the box was not checked or the field is absent', async () => {
    const { deps, completeUpdatePassword } = owing();
    await handleRequiredActionSubmission(deps, 'acme', CHANGE, REQUEST);
    expect(completeUpdatePassword).toHaveBeenCalledTimes(1);
    expect(completeUpdatePassword.mock.calls[0]?.[0]).not.toHaveProperty('endOtherSessions');
  });

  it('spares the session this change is made from', async () => {
    const { deps, completeUpdatePassword, loadPendingRequest } = owing();
    loadPendingRequest.mockResolvedValue({
      reuseSessionId: 'session-in-use',
      reuseAuthTime: '2026-10-01T12:00:00.000Z',
    });
    await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...CHANGE, endOtherSessions: true },
      REQUEST,
    );
    expect(completeUpdatePassword).toHaveBeenCalledWith(
      expect.objectContaining({
        endOtherSessions: { except: 'session-in-use', issuer: 'https://idp.test/tenants/acme' },
      }),
      REQUEST,
    );
  });

  it('asks nothing of a submission for another action', async () => {
    const { deps, completeTotpEnrolment } = harness();
    await handleRequiredActionSubmission(
      deps,
      'acme',
      { ...SUBMISSION, endOtherSessions: true },
      REQUEST,
    );
    expect(completeTotpEnrolment.mock.calls[0]?.[0]).not.toHaveProperty('endOtherSessions');
  });
});

describe('handleRequiredActionSubmission — verifying the address', () => {
  const verify = { ...SUBMISSION, action: 'verify-email' };

  it('completes when the address is verified, for the bound subject', async () => {
    const { deps, pendingActions, completeVerifyEmail } = harness();
    pendingActions.mockResolvedValue(['verify-email']);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', verify, REQUEST);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeVerifyEmail).toHaveBeenCalledWith('tenant-1', 'subject-1');
  });

  it('goes back to the page, saying so, while the address is not verified', async () => {
    const { deps, pendingActions, completeVerifyEmail } = harness();
    pendingActions.mockResolvedValue(['verify-email']);
    completeVerifyEmail.mockResolvedValue({ kind: 'not_verified' });

    expect(await handleRequiredActionSubmission(deps, 'acme', verify, REQUEST)).toEqual({
      kind: 'verify_pending',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      notice: 'not_verified',
    });
  });

  it.each(['queued', 'limited', 'unavailable'] as const)(
    'asks for a link when the send control was used, and reports %s',
    async (result) => {
      const { deps, pendingActions, sendVerificationLink, completeVerifyEmail } = harness();
      pendingActions.mockResolvedValue(['verify-email']);
      sendVerificationLink.mockResolvedValue(result);

      const outcome = await handleRequiredActionSubmission(
        deps,
        'acme',
        { ...verify, send: true },
        REQUEST,
      );

      expect(outcome).toEqual({
        kind: 'verify_pending',
        authSessionId: AUTH_SESSION_ID,
        subjectId: 'subject-1',
        notice: result === 'queued' ? 'sent' : result,
      });
      expect(sendVerificationLink).toHaveBeenCalledWith('tenant-1', 'subject-1', REQUEST);
      expect(completeVerifyEmail).not.toHaveBeenCalled();
    },
  );

  it('completes instead of sending when the address turns out to be verified already', async () => {
    const { deps, pendingActions, sendVerificationLink } = harness();
    pendingActions.mockResolvedValue(['verify-email']);
    sendVerificationLink.mockResolvedValue('verified');

    expect(
      await handleRequiredActionSubmission(deps, 'acme', { ...verify, send: true }, REQUEST),
    ).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
  });

  it('carries on when the link proved the address and cleared the action meanwhile', async () => {
    const { deps, pendingActions, completeVerifyEmail } = harness();
    pendingActions.mockResolvedValue([]);

    expect(await handleRequiredActionSubmission(deps, 'acme', verify, REQUEST)).toEqual({
      kind: 'completed',
      authSessionId: AUTH_SESSION_ID,
    });
    expect(completeVerifyEmail).toHaveBeenCalledWith('tenant-1', 'subject-1');
  });

  it('does not carry on for an address that is not verified, owed or not', async () => {
    const { deps, pendingActions, completeVerifyEmail } = harness();
    pendingActions.mockResolvedValue([]);
    completeVerifyEmail.mockResolvedValue({ kind: 'not_verified' });

    expect(await handleRequiredActionSubmission(deps, 'acme', verify, REQUEST)).toEqual({
      kind: 'not_owed',
      action: 'verify-email',
    });
  });

  it('lets the sign-in decide what is owed next after the address was proved elsewhere', async () => {
    const { deps, pendingActions } = harness();
    pendingActions.mockResolvedValue(['update-password']);

    expect(await handleRequiredActionSubmission(deps, 'acme', verify, REQUEST)).toEqual({
      kind: 'completed',
      authSessionId: AUTH_SESSION_ID,
    });
  });

  it('is refused for a subject who does not owe it, and sends nothing', async () => {
    const { deps, pendingActions, sendVerificationLink, completeVerifyEmail } = harness();
    pendingActions.mockResolvedValue(['configure-totp']);
    completeVerifyEmail.mockResolvedValue({ kind: 'not_verified' });

    expect(
      await handleRequiredActionSubmission(deps, 'acme', { ...verify, send: true }, REQUEST),
    ).toEqual({ kind: 'not_owed', action: 'verify-email' });
    expect(sendVerificationLink).not.toHaveBeenCalled();
  });

  it('runs before the password change when both are owed', async () => {
    const { deps, pendingActions, completeUpdatePassword } = harness();
    pendingActions.mockResolvedValue(['update-password', 'verify-email']);

    expect(
      await handleRequiredActionSubmission(
        deps,
        'acme',
        { ...SUBMISSION, action: 'update-password', password: 'x' },
        REQUEST,
      ),
    ).toEqual({ kind: 'not_owed', action: 'update-password' });
    expect(completeUpdatePassword).not.toHaveBeenCalled();
  });

  it('is recorded as a success when an application asked for it and the address is verified', async () => {
    const { deps, pendingActions, loadPendingRequest, recordActionStep } = harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue({ action: 'verify-email' });

    await handleRequiredActionSubmission(deps, 'acme', verify, REQUEST);

    expect(recordActionStep).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'verify-email', step: 'success' }),
      REQUEST,
    );
  });
});

describe('handleRequiredActionSubmission — completing the profile', () => {
  const profile = {
    ...SUBMISSION,
    action: 'update-profile',
    form: { name: 'Ada', birthdate: '1815-12-10', email: 'x@example.com' },
  };

  it('hands the form on for the bound subject and completes', async () => {
    const { deps, pendingActions, completeUpdateProfile } = harness();
    pendingActions.mockResolvedValue(['update-profile']);

    const outcome = await handleRequiredActionSubmission(deps, 'acme', profile, REQUEST);

    expect(outcome).toEqual({ kind: 'completed', authSessionId: AUTH_SESSION_ID });
    expect(completeUpdateProfile).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', subjectId: 'subject-1', posted: profile.form },
      REQUEST,
    );
  });

  it('goes back to the form with every problem and what was typed', async () => {
    const { deps, pendingActions, completeUpdateProfile } = harness();
    pendingActions.mockResolvedValue(['update-profile']);
    const problems = [{ kind: 'unfilled', fields: ['birthdate'] }];
    completeUpdateProfile.mockResolvedValue({
      kind: 'rejected',
      problems,
      values: { name: 'Ada', birthdate: '' },
    });

    expect(await handleRequiredActionSubmission(deps, 'acme', profile, REQUEST)).toEqual({
      kind: 'profile_rejected',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      problems,
      values: { name: 'Ada', birthdate: '' },
    });
  });

  it('writes nothing for a subject who does not owe it', async () => {
    const { deps, pendingActions, completeUpdateProfile } = harness();
    pendingActions.mockResolvedValue([]);

    expect(await handleRequiredActionSubmission(deps, 'acme', profile, REQUEST)).toEqual({
      kind: 'not_owed',
      action: 'update-profile',
    });
    expect(completeUpdateProfile).not.toHaveBeenCalled();
  });

  it('carries the requested mark back to the form an application sent the person to', async () => {
    const { deps, pendingActions, loadPendingRequest, completeUpdateProfile } = harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue({ action: 'update-profile' });
    completeUpdateProfile.mockResolvedValue({ kind: 'rejected', problems: [], values: {} });

    expect(await handleRequiredActionSubmission(deps, 'acme', profile, REQUEST)).toMatchObject({
      kind: 'profile_rejected',
      requested: true,
    });
  });
});

describe('handleRequiredActionSubmission — accepting the terms', () => {
  const terms = { ...SUBMISSION, action: 'accept-terms', accept: true };

  it('records an acceptance for the bound subject and completes', async () => {
    const { deps, pendingActions, completeAcceptTerms } = harness();
    pendingActions.mockResolvedValue(['accept-terms']);

    expect(await handleRequiredActionSubmission(deps, 'acme', terms, REQUEST)).toEqual({
      kind: 'completed',
      authSessionId: AUTH_SESSION_ID,
    });
    expect(completeAcceptTerms).toHaveBeenCalledWith(
      { tenantId: 'tenant-1', subjectId: 'subject-1', accepted: true },
      REQUEST,
    );
  });

  it('goes back to the page when the box was not ticked', async () => {
    const { deps, pendingActions, completeAcceptTerms } = harness();
    pendingActions.mockResolvedValue(['accept-terms']);
    completeAcceptTerms.mockResolvedValue({ kind: 'not_accepted' });

    expect(
      await handleRequiredActionSubmission(deps, 'acme', { ...terms, accept: false }, REQUEST),
    ).toEqual({ kind: 'terms_refused', authSessionId: AUTH_SESSION_ID, subjectId: 'subject-1' });
  });

  it('reports a tenant that dropped its terms as an action it cannot offer', async () => {
    const { deps, pendingActions, completeAcceptTerms } = harness();
    pendingActions.mockResolvedValue(['accept-terms']);
    completeAcceptTerms.mockResolvedValue({ kind: 'not_configured' });

    expect(await handleRequiredActionSubmission(deps, 'acme', terms, REQUEST)).toEqual({
      kind: 'unsupported',
      action: 'accept-terms',
    });
  });

  it('records nothing for a subject who does not owe it, whatever an application asked', async () => {
    const { deps, pendingActions, loadPendingRequest, completeAcceptTerms } = harness();
    pendingActions.mockResolvedValue([]);
    loadPendingRequest.mockResolvedValue({ action: 'accept-terms' });

    expect(await handleRequiredActionSubmission(deps, 'acme', terms, REQUEST)).toEqual({
      kind: 'not_owed',
      action: 'accept-terms',
    });
    expect(completeAcceptTerms).not.toHaveBeenCalled();
  });

  it('is owed after the profile when both are owed', async () => {
    const { deps, pendingActions, completeAcceptTerms } = harness();
    pendingActions.mockResolvedValue(['accept-terms', 'update-profile']);

    expect(await handleRequiredActionSubmission(deps, 'acme', terms, REQUEST)).toEqual({
      kind: 'not_owed',
      action: 'accept-terms',
    });
    expect(completeAcceptTerms).not.toHaveBeenCalled();
  });
});
