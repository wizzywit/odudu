import { generateSigningKey, signJwt, type SigningKeyRecord } from '@odudu/crypto';
import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { acceptedIssuers, type TenantLookup } from '@odudu/protocol-oidc';
import { describe, expect, it } from 'vitest';
import { authenticateAdmin, type AuthenticateAdminDeps } from '#/usecase/authenticate-admin';

const BASE = 'http://localhost:3000';
const KEK = Buffer.alloc(32, 3);
const FOREIGN: TenantLookup = {
  id: 'foreign-tenant-id',
  enabled: true,
  verifyEmail: false,
  ssoSessionMaxSeconds: 3600,
  ssoSessionIdleSeconds: 1800,
  rememberMeIdleSeconds: 3600,
  rememberMeMaxSeconds: 7200,
  rememberMeAllowed: false,
  loginWithEmail: false,
  registrationAllowed: false,
  resetPasswordAllowed: false,
  maxSessionsPerBrowser: 5,
  clientRegistrationPolicy: 'disabled',
  cimdEnabled: false,
  supportedLocales: ['en'],
  defaultLocale: null,
  passwordRules: {
    minLength: 15,
    requireDigit: false,
    requireUppercase: false,
    requireLowercase: false,
    requireSpecial: false,
  },
};

async function foreignKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('ES256', KEK);
  return {
    id: 'key-id',
    tenantId: FOREIGN.id,
    status: 'active',
    createdAt: new Date(0),
    notAfter: null,
    ...generated,
  };
}

async function foreignToken(
  key: SigningKeyRecord,
  iss = `${BASE}/tenants/foreign`,
): Promise<string> {
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss,
      sub: 'subject-id',
      aud: [ADMIN_API_AUDIENCE],
      iat,
      exp: iat + 300,
      grant_id: 'grant-id',
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

function deps(key: SigningKeyRecord, overrides: Partial<AuthenticateAdminDeps>) {
  const base: AuthenticateAdminDeps = {
    findTenant: (name) => Promise.resolve(name === 'foreign' ? FOREIGN : null),
    listPublishableKeys: () => Promise.resolve([key]),
    loadGrant: () => Promise.resolve(null),
    isSessionLive: () => Promise.resolve(false),
    loadClientState: () =>
      Promise.resolve({ enabled: false, builtinMcp: false, builtinAdmin: false }),
    isSubjectEnabled: () => Promise.resolve(false),
    acceptedIssuers: (_tenant, requestIssuer) => Promise.resolve([requestIssuer]),
    tenantNameAtHost: () => Promise.resolve(null),
  };
  return { ...base, ...overrides };
}

function authenticate(d: AuthenticateAdminDeps, token: string) {
  return authenticateAdmin(d, {
    authorizationHeader: `Bearer ${token}`,
    targetTenantName: 'target',
    targetTenant: { ...FOREIGN, id: 'target-tenant-id' },
    targetTenantIssuer: `${BASE}/tenants/target`,
    systemTenantIssuer: `${BASE}/tenants/system`,
    issuerBase: BASE,
    now: new Date(),
  });
}

describe('a foreign issuer whose resolution fails', () => {
  const failure = new Error('database unavailable');

  it.each([
    ['findTenant', { findTenant: () => Promise.reject(failure) }],
    ['listPublishableKeys', { listPublishableKeys: () => Promise.reject(failure) }],
    ['loadGrant', { loadGrant: () => Promise.reject(failure) }],
  ] as const)('is the plain issuer mismatch when %s rejects, carrying the error', async (_, o) => {
    const key = await foreignKey();
    const outcome = await authenticate(deps(key, o), await foreignToken(key));

    expect(outcome).toEqual({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
      foreignIssuerError: failure,
    });
  });

  it('still resolves the foreign issuer when nothing fails', async () => {
    const key = await foreignKey();
    const outcome = await authenticate(deps(key, {}), await foreignToken(key));

    expect(outcome).toEqual({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
      foreignIssuer: { issuerTenantId: FOREIGN.id, subjectId: 'subject-id', clientDbId: null },
    });
  });
});

describe('the tenant named in the path, already looked up by the caller', () => {
  const TARGET: TenantLookup = { ...FOREIGN, id: 'target-tenant-id' };

  async function targetToken(key: SigningKeyRecord): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return signJwt(
      {
        iss: `${BASE}/tenants/target`,
        sub: 'subject-id',
        aud: [ADMIN_API_AUDIENCE],
        iat,
        exp: iat + 300,
        grant_id: 'grant-id',
        sid: 'session-id',
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
  }

  async function run() {
    const key = { ...(await foreignKey()), tenantId: TARGET.id };
    const lookups: string[] = [];
    const d = deps(key, {
      findTenant: (name) => {
        lookups.push(name);
        return Promise.resolve(name === 'target' ? TARGET : null);
      },
      loadGrant: () =>
        Promise.resolve({
          clientId: 'client-id',
          sessionId: 'session-id',
          revokedAt: null,
        } as never),
      isSessionLive: () => Promise.resolve(true),
      loadClientState: () =>
        Promise.resolve({ enabled: true, builtinMcp: false, builtinAdmin: false }),
      isSubjectEnabled: () => Promise.resolve(true),
    });
    const outcome = await authenticateAdmin(d, {
      authorizationHeader: `Bearer ${await targetToken(key)}`,
      targetTenantName: 'target',
      targetTenant: TARGET,
      targetTenantIssuer: `${BASE}/tenants/target`,
      systemTenantIssuer: `${BASE}/tenants/system`,
      issuerBase: BASE,
      now: new Date(),
    });
    return { outcome, lookups };
  }

  it('is not looked up a second time to authenticate', async () => {
    const { outcome, lookups } = await run();
    expect(outcome.kind).toBe('authenticated');
    expect(lookups).toEqual([]);
  });

  it('does not make a foreign issuer’s token any less foreign', async () => {
    const key = await foreignKey();
    const lookups: string[] = [];
    const outcome = await authenticateAdmin(
      deps(key, {
        findTenant: (name) => {
          lookups.push(name);
          return Promise.resolve(name === 'foreign' ? FOREIGN : null);
        },
      }),
      {
        authorizationHeader: `Bearer ${await foreignToken(key)}`,
        targetTenantName: 'target',
        targetTenant: TARGET,
        targetTenantIssuer: `${BASE}/tenants/target`,
        systemTenantIssuer: `${BASE}/tenants/system`,
        issuerBase: BASE,
        now: new Date(),
      },
    );
    expect(lookups).toEqual(['foreign']);
    expect(outcome).toMatchObject({ kind: 'unauthenticated', reason: 'issuer_mismatch' });
  });

  it('is still refused when the tenant it was looked up as is disabled', async () => {
    const key = { ...(await foreignKey()), tenantId: TARGET.id };
    const outcome = await authenticateAdmin(deps(key, {}), {
      authorizationHeader: `Bearer ${await targetToken(key)}`,
      targetTenantName: 'target',
      targetTenant: { ...TARGET, enabled: false },
      targetTenantIssuer: `${BASE}/tenants/target`,
      systemTenantIssuer: `${BASE}/tenants/system`,
      issuerBase: BASE,
      now: new Date(),
    });
    expect(outcome).toMatchObject({ kind: 'unauthenticated', reason: 'issuer_mismatch' });
  });
});

describe('a tenant that has moved to its own domain', () => {
  const TARGET: TenantLookup = { ...FOREIGN, id: 'target-tenant-id' };
  const NOW = new Date();
  const DOMAIN = 'https://login.target.example';
  const PATH = `${BASE}/tenants/target`;
  const LIVE = 'https://old.target.example';
  const EXPIRED = 'https://older.target.example';
  const OTHER = 'https://login.other.example';

  const lookup: AuthenticateAdminDeps['acceptedIssuers'] = (_tenant, _requestIssuer, now) =>
    Promise.resolve(
      acceptedIssuers(
        DOMAIN,
        [
          { issuer: PATH, expiresAt: new Date(now.getTime() + 60_000) },
          { issuer: LIVE, expiresAt: new Date(now.getTime() + 1) },
          { issuer: EXPIRED, expiresAt: now },
        ],
        now,
      ),
    );

  async function outcomeFor(iss: string, requestIssuer = PATH) {
    const key = { ...(await foreignKey()), tenantId: TARGET.id };
    const iat = Math.floor(NOW.getTime() / 1000);
    const token = await signJwt(
      {
        iss,
        sub: 'subject-id',
        aud: [ADMIN_API_AUDIENCE],
        iat,
        exp: iat + 300,
        grant_id: 'grant-id',
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
    return authenticateAdmin(
      deps(key, {
        findTenant: (name) => Promise.resolve(name === 'target' ? TARGET : null),
        loadGrant: () =>
          Promise.resolve({ clientId: 'client-id', sessionId: null, revokedAt: null } as never),
        loadClientState: () =>
          Promise.resolve({ enabled: true, builtinMcp: false, builtinAdmin: false }),
        isSubjectEnabled: () => Promise.resolve(true),
        acceptedIssuers: lookup,
      }),
      {
        authorizationHeader: `Bearer ${token}`,
        targetTenantName: 'target',
        targetTenant: TARGET,
        targetTenantIssuer: requestIssuer,
        systemTenantIssuer: `${BASE}/tenants/system`,
        issuerBase: BASE,
        now: NOW,
      },
    );
  }

  it('accepts a token minted at its canonical domain', async () => {
    expect((await outcomeFor(DOMAIN)).kind).toBe('authenticated');
  });

  it('accepts a token minted at an address it left, while that window is open', async () => {
    expect((await outcomeFor(PATH)).kind).toBe('authenticated');
    expect((await outcomeFor(LIVE)).kind).toBe('authenticated');
  });

  it('refuses a token minted at an address whose window has ended', async () => {
    expect(await outcomeFor(EXPIRED)).toMatchObject({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
    });
  });

  it('refuses a token minted at another tenant’s domain', async () => {
    expect(await outcomeFor(OTHER)).toMatchObject({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
    });
  });

  it('asks for the accepted set of the tenant in the path and no other', async () => {
    const asked: string[] = [];
    const key = await foreignKey();
    await authenticateAdmin(
      deps(key, {
        acceptedIssuers: (tenant) => {
          asked.push(tenant.name);
          return Promise.resolve([]);
        },
      }),
      {
        authorizationHeader: `Bearer ${await foreignToken(key)}`,
        targetTenantName: 'target',
        targetTenant: TARGET,
        targetTenantIssuer: PATH,
        systemTenantIssuer: `${BASE}/tenants/system`,
        issuerBase: BASE,
        now: NOW,
      },
    );
    expect(asked).toEqual(['target']);
  });
});

describe('a foreign tenant that has moved to its own domain', () => {
  const HOST = 'login.foreign.example';

  it('is recorded as a foreign issuer when its token names the domain', async () => {
    const key = await foreignKey();
    const asked: string[] = [];
    const outcome = await authenticate(
      deps(key, {
        tenantNameAtHost: (host) => {
          asked.push(host);
          return Promise.resolve(host === HOST ? 'foreign' : null);
        },
      }),
      await foreignToken(key, `https://${HOST}`),
    );

    expect(asked).toEqual([HOST]);
    expect(outcome).toEqual({
      kind: 'unauthenticated',
      reason: 'issuer_mismatch',
      foreignIssuer: { issuerTenantId: FOREIGN.id, subjectId: 'subject-id', clientDbId: null },
    });
  });

  it('is the plain issuer mismatch when no tenant serves that host', async () => {
    const key = await foreignKey();
    const outcome = await authenticate(deps(key, {}), await foreignToken(key, `https://${HOST}`));

    expect(outcome).toEqual({ kind: 'unauthenticated', reason: 'issuer_mismatch' });
  });

  it('never looks a host up for an issuer that is not a bare origin', async () => {
    const key = await foreignKey();
    const asked: string[] = [];
    await authenticate(
      deps(key, {
        tenantNameAtHost: (host) => {
          asked.push(host);
          return Promise.resolve('foreign');
        },
      }),
      await foreignToken(key, `https://${HOST}/tenants/x`),
    );

    expect(asked).toEqual([]);
  });
});

describe('the scope and the agent a token carries', () => {
  const TARGET: TenantLookup = { ...FOREIGN, id: 'target-tenant-id' };

  async function outcomeFor(
    claims: Record<string, unknown>,
    overrides: Partial<AuthenticateAdminDeps> = {},
    iss = `${BASE}/tenants/target`,
  ) {
    const key = { ...(await foreignKey()), tenantId: TARGET.id };
    const iat = Math.floor(Date.now() / 1000);
    const token = await signJwt(
      {
        iss,
        sub: 'owner-subject',
        aud: [ADMIN_API_AUDIENCE],
        iat,
        exp: iat + 300,
        grant_id: 'grant-id',
        client_id: 'console',
        ...claims,
      },
      { key, kek: KEK, typ: 'at+jwt' },
    );
    return authenticateAdmin(
      deps(key, {
        findTenant: (name) => Promise.resolve(name === 'target' ? TARGET : null),
        loadGrant: () =>
          Promise.resolve({ clientId: 'client-db-id', sessionId: null, revokedAt: null } as never),
        loadClientState: () =>
          Promise.resolve({ enabled: true, builtinMcp: false, builtinAdmin: false }),
        isSubjectEnabled: () => Promise.resolve(true),
        ...overrides,
      }),
      {
        authorizationHeader: `Bearer ${token}`,
        targetTenantName: 'target',
        targetTenant: TARGET,
        targetTenantIssuer: `${BASE}/tenants/target`,
        systemTenantIssuer: `${BASE}/tenants/system`,
        issuerBase: BASE,
        now: new Date(),
      },
    );
  }

  it('reads the scope claim as a list, empty when absent', async () => {
    const some = await outcomeFor({ scope: 'openid  profile' });
    const none = await outcomeFor({});
    expect(some).toMatchObject({ principal: { scopes: ['openid', 'profile'] } });
    expect(none).toMatchObject({ principal: { scopes: [] } });
  });

  it('refuses a scope claim that is not a string', async () => {
    expect(await outcomeFor({ scope: ['mcp:read'] })).toMatchObject({
      kind: 'unauthenticated',
      reason: 'invalid_token',
    });
  });

  it('names no agent for an ordinary console token', async () => {
    const outcome = await outcomeFor({ scope: 'openid' });
    expect(outcome.kind).toBe('authenticated');
    if (outcome.kind === 'authenticated') expect(outcome.principal.agent).toBeUndefined();
  });

  it('names the actor as the agent and the token subject as its owner', async () => {
    const outcome = await outcomeFor({ scope: 'mcp:read', act: { sub: 'agent-client' } });
    expect(outcome).toMatchObject({
      kind: 'authenticated',
      principal: {
        subjectId: 'owner-subject',
        scopes: ['mcp:read'],
        agent: { clientId: 'agent-client', ownerSubjectId: 'owner-subject' },
      },
    });
  });

  it('names the built-in MCP client as an agent with no act', async () => {
    const outcome = await outcomeFor(
      { scope: 'mcp:write', client_id: 'odudu-mcp' },
      {
        loadClientState: (tenantId, clientDbId) =>
          Promise.resolve(
            tenantId === TARGET.id && clientDbId === 'client-db-id'
              ? { enabled: true, builtinMcp: true, builtinAdmin: false }
              : null,
          ),
      },
    );
    expect(outcome).toMatchObject({
      kind: 'authenticated',
      principal: { agent: { clientId: 'odudu-mcp', ownerSubjectId: 'owner-subject' } },
    });
  });

  it('names any client holding an MCP scope as an agent', async () => {
    const outcome = await outcomeFor({ scope: 'openid mcp:read', client_id: 'cimd-client' });
    expect(outcome).toMatchObject({
      kind: 'authenticated',
      principal: { agent: { clientId: 'cimd-client', ownerSubjectId: 'owner-subject' } },
    });
  });

  it('does not take the id string alone for the built-in client', async () => {
    const outcome = await outcomeFor({ scope: 'openid', client_id: 'odudu-mcp' });
    expect(outcome).toMatchObject({ kind: 'authenticated' });
    if (outcome.kind === 'authenticated') expect(outcome.principal.agent).toBeUndefined();
  });

  it.each([
    ['an act token minted with a non-MCP scope', { scope: 'openid', act: { sub: 'agent-client' } }],
    ['an act token with no scope', { act: { sub: 'agent-client' } }],
  ])('forbids %s, so it keeps none of the owner’s capabilities', async (_, claims) => {
    expect(await outcomeFor(claims)).toMatchObject({
      kind: 'forbidden',
      reason: 'agent_without_mcp_scope',
    });
  });

  it('forbids the built-in MCP client holding no MCP scope', async () => {
    const outcome = await outcomeFor(
      { scope: 'openid', client_id: 'odudu-mcp' },
      {
        loadClientState: () =>
          Promise.resolve({ enabled: true, builtinMcp: true, builtinAdmin: false }),
      },
    );
    expect(outcome).toMatchObject({
      kind: 'forbidden',
      reason: 'agent_without_mcp_scope',
      principal: { clientDbId: 'client-db-id', subjectId: 'owner-subject' },
    });
  });

  it.each([
    ['a string', 'agent'],
    ['null', null],
    ['an array', ['agent']],
    ['an object without a sub', { client: 'x' }],
    ['an empty sub', { sub: '' }],
    ['a non-string sub', { sub: 7 }],
  ])('refuses an act that is %s, never ignoring it', async (_, act) => {
    expect(await outcomeFor({ scope: 'mcp:read', act })).toMatchObject({
      kind: 'unauthenticated',
      reason: 'invalid_token',
    });
  });

  it('refuses an MCP-scoped token of another tenant as it refuses any foreign token', async () => {
    const outcome = await outcomeFor({ scope: 'mcp:read' }, {}, `${BASE}/tenants/foreign`);
    expect(outcome).toMatchObject({ kind: 'unauthenticated', reason: 'issuer_mismatch' });
  });
});
