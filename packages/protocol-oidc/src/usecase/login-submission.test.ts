import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  handleLoginSubmission,
  type CompleteLoginOutcome,
  type LoginSubmissionDeps,
} from '#/usecase/login-submission';

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
  rememberMeAllowed: true,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
  maxSessionsPerBrowser: 25,
};

const TENANT_LIFESPANS = {
  ssoSessionIdleSeconds: TENANT.ssoSessionIdleSeconds,
  ssoSessionMaxSeconds: TENANT.ssoSessionMaxSeconds,
  rememberMeIdleSeconds: TENANT.rememberMeIdleSeconds,
  rememberMeMaxSeconds: TENANT.rememberMeMaxSeconds,
};

const PENDING = {
  clientId: 'oauth-client-1',
  redirectUri: 'https://app.example/callback',
  scope: 'openid',
  state: 'xyz',
  nonce: null,
  codeChallenge: 'a'.repeat(43),
  codeChallengeMethod: 'S256' as const,
};

interface Harness {
  deps: LoginSubmissionDeps;
  advance: Mock;
  completeLogin: Mock;
  checkEmailVerification: Mock;
  pendingActions: Mock;
  resetAuthenticationProgress: Mock;
  recordRememberMe: Mock;
}

function harness(): Harness {
  const advance = vi
    .fn()
    .mockResolvedValue({ kind: 'success', subjectId: 'subject-1', authenticators: ['password'] });
  const completeLogin = vi
    .fn()
    .mockResolvedValue({ kind: 'issued', sessionId: 'session-1', code: 'code-1' });
  const checkEmailVerification = vi.fn().mockResolvedValue({ verified: true, hasEmail: true });
  const pendingActions = vi.fn().mockResolvedValue([]);
  const resetAuthenticationProgress = vi.fn().mockResolvedValue(undefined);
  const recordRememberMe = vi.fn().mockResolvedValue(undefined);
  const deps: LoginSubmissionDeps = {
    findTenant: vi.fn().mockResolvedValue(TENANT),
    advance,
    loadPendingRequest: vi.fn().mockResolvedValue(PENDING),
    resolveClientId: vi.fn().mockResolvedValue('client-uuid-1'),
    checkEmailVerification,
    pendingActions,
    resetAuthenticationProgress,
    recordRememberMe,
    completeLogin,
    // consentRequired: false is 'not_required' unconditionally — none of
    // this file's cases are about consent, so the gate stays a no-op here;
    // consent.int.test.ts is where it is exercised.
    consentContext: vi.fn().mockResolvedValue({
      clientName: 'Test Client',
      consentRequired: false,
      defaultScopes: [],
      optionalScopes: [],
      scopeIdByName: new Map<string, string>(),
    }),
    grantedScopeIds: vi.fn().mockResolvedValue(new Set<string>()),
    // No other live session by default — the harness's cases are about the
    // login gates, not the browser's existing session set.
    resolveSessions: vi.fn().mockResolvedValue([]),
  };
  return {
    deps,
    advance,
    completeLogin,
    checkEmailVerification,
    pendingActions,
    resetAuthenticationProgress,
    recordRememberMe,
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

// Postgres raises on a `uuid` comparison against a value it cannot parse,
// so a malformed id must be refused here rather than reaching one — an
// unauthenticated caller does not get to choose what faults.
describe('handleLoginSubmission — a session id that cannot name a session', () => {
  it('refuses a malformed id without advancing anything', async () => {
    for (const authSessionId of MALFORMED_SESSION_IDS) {
      const { deps, advance, completeLogin } = harness();

      const outcome = await handleLoginSubmission(
        deps,
        'acme',
        'https://idp.example',
        authSessionId,
        { username: 'ada', password: 'x' },
        undefined,
      );

      expect(outcome).toEqual({ kind: 'unauthenticated' });
      expect(advance).not.toHaveBeenCalled();
      expect(completeLogin).not.toHaveBeenCalled();
    }
  });
});

describe('handleLoginSubmission — the success path', () => {
  it('redirects with the code and passes the parked request to completeLogin', async () => {
    const { deps, completeLogin } = harness();
    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({
      kind: 'redirect',
      location:
        'https://app.example/callback?code=code-1&state=xyz&iss=https%3A%2F%2Fidp.example%2Ftenants%2Facme',
      sessionId: 'session-1',
      ephemeralSessionIds: ['session-1'],
      persistentSessionIds: [],
      persistentMaxAgeSeconds: TENANT.rememberMeMaxSeconds,
    });
    expect(completeLogin).toHaveBeenCalledWith({
      tenantId: TENANT.id,
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      clientId: 'client-uuid-1',
      redirectUri: PENDING.redirectUri,
      scope: PENDING.scope,
      nonce: PENDING.nonce,
      codeChallenge: PENDING.codeChallenge,
      codeChallengeMethod: PENDING.codeChallengeMethod,
      remembered: false,
      lifespans: TENANT_LIFESPANS,
      maxSessionsPerBrowser: TENANT.maxSessionsPerBrowser,
      browserSessionIds: [],
      authenticators: ['password'],
      resource: [],
      claims: { idToken: {}, userinfo: {} },
    });
  });

  it('remembers the login when the field is set and the tenant allows it', async () => {
    const { deps, completeLogin } = harness();
    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
      true,
    );

    expect(outcome).toMatchObject({ kind: 'redirect' });
    expect(completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        remembered: true,
      }),
    );
  });

  it('ignores the field when the tenant does not allow remembering', async () => {
    const { deps, completeLogin } = harness();
    deps.findTenant = vi.fn().mockResolvedValue({ ...TENANT, rememberMeAllowed: false });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
      true,
    );

    expect(outcome).toMatchObject({ kind: 'redirect' });
    expect(completeLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        remembered: false,
      }),
    );
  });

  // completeAuthorizedLogin never runs on this path — the consent POST
  // runs it later, from recordRememberMe's parked value, not this
  // request's own field. The same `remembered` variable feeds both
  // branches today; this only stays true if something keeps asserting it.
  it('ignores the field on the consent path too, when the tenant does not allow remembering', async () => {
    const { deps, recordRememberMe } = harness();
    deps.findTenant = vi.fn().mockResolvedValue({ ...TENANT, rememberMeAllowed: false });
    deps.consentContext = vi.fn().mockResolvedValue({
      clientName: 'Test Client',
      consentRequired: true,
      defaultScopes: ['openid'],
      optionalScopes: [],
      scopeIdByName: new Map<string, string>(),
    });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
      true,
    );

    expect(outcome).toMatchObject({ kind: 'consent' });
    expect(recordRememberMe).toHaveBeenCalledWith(TENANT.id, AUTH_SESSION_ID, false);
  });
});

describe('handleLoginSubmission — a tenant that requires a verified address', () => {
  it('does not complete the login, and issues no code, when the address is not verified', async () => {
    const { deps, completeLogin, checkEmailVerification } = harness();
    deps.findTenant = vi.fn().mockResolvedValue({ ...TENANT, verifyEmail: true });
    checkEmailVerification.mockResolvedValue({ verified: false, hasEmail: true });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({
      kind: 'unverified',
      authSessionId: AUTH_SESSION_ID,
      hasEmail: true,
    });
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('says so, distinctly, when the account has no address to verify at all', async () => {
    const { deps, checkEmailVerification } = harness();
    deps.findTenant = vi.fn().mockResolvedValue({ ...TENANT, verifyEmail: true });
    checkEmailVerification.mockResolvedValue({ verified: false, hasEmail: false });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({
      kind: 'unverified',
      authSessionId: AUTH_SESSION_ID,
      hasEmail: false,
    });
  });

  it('completes the login once the address is verified', async () => {
    const { deps, checkEmailVerification } = harness();
    deps.findTenant = vi.fn().mockResolvedValue({ ...TENANT, verifyEmail: true });
    checkEmailVerification.mockResolvedValue({ verified: true, hasEmail: true });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome.kind).toBe('redirect');
  });
});

describe('handleLoginSubmission — a subject with a pending required action', () => {
  it('does not complete the login, and issues no code, while an action is owed', async () => {
    const { deps, completeLogin, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-totp']);

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({
      kind: 'required_action',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      action: 'configure-totp',
    });
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('runs update-password before configure-totp when both are owed', async () => {
    const { deps, pendingActions } = harness();
    pendingActions.mockResolvedValue(['configure-totp', 'update-password']);

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({
      kind: 'required_action',
      authSessionId: AUTH_SESSION_ID,
      subjectId: 'subject-1',
      action: 'update-password',
    });
  });

  it('completes the login once no action is owed', async () => {
    const { deps, pendingActions } = harness();
    pendingActions.mockResolvedValue([]);

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome.kind).toBe('redirect');
  });
});

describe('handleLoginSubmission — a session already consumed by an earlier or racing submission', () => {
  it('rejects as unauthenticated and never redirects with a second code', async () => {
    const { deps, completeLogin } = harness();
    const alreadyConsumed: CompleteLoginOutcome = { kind: 'already_consumed' };
    completeLogin.mockResolvedValue(alreadyConsumed);

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'unauthenticated' });
  });
});

describe('handleLoginSubmission — a failed attempt must not consume the session', () => {
  it('returns reject on wrong credentials without calling completeLogin', async () => {
    const { deps, advance, completeLogin } = harness();
    advance.mockResolvedValue({ kind: 'failure', reason: 'invalid_credentials' });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'wrong' },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'reject', authSessionId: AUTH_SESSION_ID });
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('returns unauthenticated on an expired session without calling completeLogin', async () => {
    const { deps, advance, completeLogin } = harness();
    advance.mockResolvedValue({ kind: 'failure', reason: 'authentication_session_expired' });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome).toEqual({ kind: 'unauthenticated' });
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('returns reject on a password challenge without calling completeLogin', async () => {
    const { deps, advance, completeLogin } = harness();
    advance.mockResolvedValue({ kind: 'challenge', form: 'password' });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      {},
      undefined,
    );

    expect(outcome).toEqual({ kind: 'reject', authSessionId: AUTH_SESSION_ID });
    expect(completeLogin).not.toHaveBeenCalled();
  });
});

describe('handleLoginSubmission — a hint naming somebody other than who signed in', () => {
  it('unbinds the attempt so the hinted end-user can sign in against the same request', async () => {
    const { deps, completeLogin, resetAuthenticationProgress } = harness();
    deps.loadPendingRequest = vi
      .fn()
      .mockResolvedValue({ ...PENDING, idTokenHintSubject: 'someone-else' });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome.kind).toBe('error_redirect');
    expect(resetAuthenticationProgress).toHaveBeenCalledWith('tenant-1', AUTH_SESSION_ID);
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('leaves the attempt bound when the hint names the subject who signed in', async () => {
    const { deps, resetAuthenticationProgress } = harness();
    deps.loadPendingRequest = vi
      .fn()
      .mockResolvedValue({ ...PENDING, idTokenHintSubject: 'subject-1' });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      AUTH_SESSION_ID,
      { username: 'ada', password: 'x' },
      undefined,
    );

    expect(outcome.kind).toBe('redirect');
    expect(resetAuthenticationProgress).not.toHaveBeenCalled();
  });
});
