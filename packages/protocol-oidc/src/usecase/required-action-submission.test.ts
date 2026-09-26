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
  return {
    deps: {
      findTenant,
      authenticatedSubject,
      pendingActions,
      completeTotpEnrolment,
      completePasskeyEnrolment,
      completeRecoveryCodes,
      completeUpdatePassword,
    },
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
        'Password must be at least 8 characters long.',
        'Password must contain a digit.',
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
        'Password must be at least 8 characters long.',
        'Password must contain a digit.',
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

    expect(outcome).toMatchObject({ kind: 'password_rejected', authSessionId: AUTH_SESSION_ID });
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
    expect(outcome).toMatchObject({ kind: 'rejected', action: 'configure-passkey' });
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
