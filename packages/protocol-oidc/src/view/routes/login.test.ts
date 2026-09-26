import formbody from '@fastify/formbody';
import Fastify from 'fastify';
import { SessionEntry } from '@odudu/authn-flows';
import { describe, expect, it, vi } from 'vitest';
import { registerLoginRoute, type LoginRouteDeps } from '#/view/routes/login';

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
  clientRegistrationPolicy: 'disabled' as const,
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

// A live remembered session already in the browser's cookies, so a
// successful login has to write both the ephemeral cookie (this login) and
// the persistent one (the survivor) — the case that catches a dropped
// second `reply.header('set-cookie', …)` call or a switch to
// `reply.headers({...})`, which overwrites rather than appending.
function deps(): LoginRouteDeps {
  return {
    tls: false,
    findTenant: vi.fn().mockResolvedValue(TENANT),
    advance: vi
      .fn()
      .mockResolvedValue({ kind: 'success', subjectId: 'subject-1', authenticators: ['password'] }),
    loadPendingRequest: vi.fn().mockResolvedValue(PENDING),
    resolveClientId: vi.fn().mockResolvedValue('client-uuid-1'),
    checkEmailVerification: vi.fn().mockResolvedValue({ verified: true, hasEmail: true }),
    pendingActions: vi.fn().mockResolvedValue([]),
    resetAuthenticationProgress: vi.fn().mockResolvedValue(undefined),
    recordRememberMe: vi.fn().mockResolvedValue(undefined),
    completeLogin: vi.fn().mockResolvedValue({
      kind: 'issued',
      sessionId: 'new-session',
      code: 'code-1',
      entry: SessionEntry.issue('new-session'),
    }),
    resolveSessions: vi.fn().mockResolvedValue([
      {
        id: 'remembered-session',
        tenantId: TENANT.id,
        subjectId: 'subject-1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2100-01-01T00:00:00Z'),
        lastActiveAt: new Date('2026-01-01T00:00:00Z'),
        authenticators: ['password'],
        remembered: true,
        entry: SessionEntry.issue('remembered-session'),
      },
    ]),
    consentContext: vi.fn().mockResolvedValue({
      clientName: 'Test Client',
      consentRequired: false,
      defaultScopes: [],
      optionalScopes: [],
      scopeIdByName: new Map<string, string>(),
    }),
    grantedScopeIds: vi.fn().mockResolvedValue(new Set<string>()),
    pendingChallenge: vi.fn(),
    beginTotpEnrolment: vi.fn(),
    beginRecoveryCodes: vi.fn(),
  };
}

describe('the login route, on a successful login', () => {
  it('writes both the ephemeral and the persistent cookie, never one merged header', async () => {
    const app = Fastify();
    await app.register(formbody);
    registerLoginRoute(app, deps());
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/tenants/acme/login-actions/authenticate',
      payload: new URLSearchParams({
        auth_session_id: AUTH_SESSION_ID,
        username: 'ada',
        password: 'x',
      }).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });

    expect(res.statusCode).toBe(302);
    const raw = res.headers['set-cookie'];
    const cookies = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    expect(cookies).toHaveLength(2);

    const ephemeral = cookies.find(
      (cookie) => cookie.startsWith('acme-session=') && !cookie.includes('-persistent'),
    );
    const persistent = cookies.find((cookie) => cookie.startsWith('acme-session-persistent='));
    if (ephemeral === undefined || persistent === undefined) {
      throw new Error(
        `expected one ephemeral and one persistent cookie, got: ${cookies.join(' | ')}`,
      );
    }
    expect(ephemeral).not.toContain('Max-Age=');
    expect(persistent).toContain('Max-Age=');
  });
});
