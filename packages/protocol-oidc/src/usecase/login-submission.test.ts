import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  handleLoginSubmission,
  type CompleteLoginOutcome,
  type LoginSubmissionDeps,
} from '#/usecase/login-submission';

const REALM = { id: 'realm-1', enabled: true };

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
}

function harness(): Harness {
  const advance = vi.fn().mockResolvedValue({ kind: 'success', subjectId: 'subject-1' });
  const completeLogin = vi
    .fn()
    .mockResolvedValue({ kind: 'issued', sessionId: 'session-1', code: 'code-1' });
  const deps: LoginSubmissionDeps = {
    findRealm: vi.fn().mockResolvedValue(REALM),
    advance,
    loadPendingRequest: vi.fn().mockResolvedValue(PENDING),
    resolveClientId: vi.fn().mockResolvedValue('client-uuid-1'),
    completeLogin,
  };
  return { deps, advance, completeLogin };
}

describe('handleLoginSubmission — the success path', () => {
  it('redirects with the code and passes the parked request to completeLogin', async () => {
    const { deps, completeLogin } = harness();
    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      'auth-session-1',
      { username: 'ada', password: 'x' },
    );

    expect(outcome).toEqual({
      kind: 'redirect',
      location:
        'https://app.example/callback?code=code-1&state=xyz&iss=https%3A%2F%2Fidp.example%2Frealms%2Facme',
      sessionId: 'session-1',
    });
    expect(completeLogin).toHaveBeenCalledWith({
      realmId: REALM.id,
      authSessionId: 'auth-session-1',
      subjectId: 'subject-1',
      clientId: 'client-uuid-1',
      redirectUri: PENDING.redirectUri,
      scope: PENDING.scope,
      nonce: PENDING.nonce,
      codeChallenge: PENDING.codeChallenge,
      codeChallengeMethod: PENDING.codeChallengeMethod,
    });
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
      'auth-session-1',
      { username: 'ada', password: 'x' },
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
      'auth-session-1',
      { username: 'ada', password: 'wrong' },
    );

    expect(outcome).toEqual({ kind: 'reject', authSessionId: 'auth-session-1' });
    expect(completeLogin).not.toHaveBeenCalled();
  });

  it('returns unauthenticated on an expired session without calling completeLogin', async () => {
    const { deps, advance, completeLogin } = harness();
    advance.mockResolvedValue({ kind: 'failure', reason: 'authentication_session_expired' });

    const outcome = await handleLoginSubmission(
      deps,
      'acme',
      'https://idp.example',
      'auth-session-1',
      { username: 'ada', password: 'x' },
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
      'auth-session-1',
      {},
    );

    expect(outcome).toEqual({ kind: 'reject', authSessionId: 'auth-session-1' });
    expect(completeLogin).not.toHaveBeenCalled();
  });
});
