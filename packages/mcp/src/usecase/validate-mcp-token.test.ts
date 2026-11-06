import { pathAddress, mcpAudienceOfIssuer, addressIssuer } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import {
  validateMcpToken,
  type ValidateMcpTokenDeps,
  type ValidateMcpTokenInput,
} from '#/usecase/validate-mcp-token';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const ISSUER = addressIssuer(ADDRESS);
const RESOURCE = mcpAudienceOfIssuer(ISSUER);
const ADMIN_AUDIENCE = 'urn:odudu:admin-api';
const NOW = new Date('2026-11-06T10:00:00Z');
const EXP = Math.floor(NOW.getTime() / 1000) + 600;

const CLAIMS = {
  iss: ISSUER,
  aud: [RESOURCE],
  sub: 'subject-1',
  client_id: 'odudu-mcp',
  grant_id: 'grant-1',
  sid: 'session-1',
  scope: 'openid mcp:read',
  exp: EXP,
};

interface Fakes {
  claims?: Record<string, unknown> | null;
  grantRevoked?: boolean;
  grantOwner?: string;
  sessionLive?: boolean;
  clientEnabled?: boolean;
  subjectEnabled?: boolean;
  accepted?: readonly string[];
  seen?: { expected?: { issuers: readonly string[]; audience: string }; token?: string };
}

function deps(f: Fakes = {}): ValidateMcpTokenDeps {
  return {
    findTenant: () => Promise.resolve(null),
    listPublishableKeys: () => Promise.resolve([]),
    loadGrant: () =>
      Promise.resolve({
        id: 'grant-1',
        tenantId: 'tenant-1',
        clientId: 'client-db-1',
        subjectId: f.grantOwner ?? 'subject-1',
        scope: 'openid mcp:read',
        audience: [RESOURCE],
        createdAt: new Date(0),
        revokedAt: f.grantRevoked === true ? new Date(1) : null,
        sessionId: 'session-1',
        actorSubjectId: null,
        exchangedFromGrantId: null,
        actChain: null,
        expCeiling: null,
        requestedUserinfoClaims: null,
      }),
    isSessionLive: () => Promise.resolve(f.sessionLive ?? true),
    loadClientState: () =>
      Promise.resolve({
        enabled: f.clientEnabled ?? true,
        builtinMcp: true,
        builtinAdmin: false,
      }),
    isSubjectEnabled: () => Promise.resolve(f.subjectEnabled ?? true),
    acceptedIssuers: () => Promise.resolve(f.accepted ?? [ISSUER]),
    tenantNameAtHost: () => Promise.resolve(null),
    verifyAccessToken: (_tenant, token, expected) => {
      if (f.seen !== undefined) {
        f.seen.expected = expected;
        f.seen.token = token;
      }
      return Promise.resolve(f.claims === undefined ? CLAIMS : f.claims);
    },
  };
}

// A JWT whose payload names `iss`, which is all the issuer is read from before
// the signature is checked.
function jwtWith(iss: string): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'ES256' })}.${part({ iss })}.sig`;
}

function input(over: Partial<ValidateMcpTokenInput> = {}): ValidateMcpTokenInput {
  return {
    authorizationHeader: `Bearer ${jwtWith(ISSUER)}`,
    tenant: {
      id: 'tenant-1',
      name: 'acme',
      lifespans: {
        ssoSessionMaxSeconds: 1,
        ssoSessionIdleSeconds: 1,
        rememberMeIdleSeconds: 1,
        rememberMeMaxSeconds: 1,
      },
    },
    address: ADDRESS,
    issuerBase: 'https://idp.example',
    adminAudience: ADMIN_AUDIENCE,
    now: NOW,
    ...over,
  };
}

describe('a token that stands', () => {
  it('is validated, carrying what the exchange needs and the grant’s client row', async () => {
    const outcome = await validateMcpToken(deps(), input());
    if (outcome.kind !== 'valid') throw new Error(outcome.kind);
    expect(outcome.clientDbId).toBe('client-db-1');
    expect(outcome.token).toMatchObject({
      tenant: { id: 'tenant-1', name: 'acme' },
      issuer: ISSUER,
      subjectId: 'subject-1',
      clientId: 'odudu-mcp',
      grantId: 'grant-1',
      scope: ['openid', 'mcp:read'],
    });
    expect(outcome.token.expiresAt).toEqual(new Date(EXP * 1000));
  });

  it('is verified against the tenant’s resource URL and issuers, and nothing wider', async () => {
    const seen: NonNullable<Fakes['seen']> = {};
    await validateMcpToken(deps({ seen }), input());
    expect(seen.expected).toEqual({ issuers: [ISSUER], audience: RESOURCE });
  });
});

describe('a request with no usable token', () => {
  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer', 'Bearer '],
  ])('with %s is unauthenticated for missing credentials', async (_l, header) => {
    expect(await validateMcpToken(deps(), input({ authorizationHeader: header }))).toEqual({
      kind: 'unauthenticated',
      reason: 'missing_credentials',
    });
  });

  it.each(['a.b', 'a.b.c', 'Bearer', 'x.!!!.y'])('is malformed for %j', async (token) => {
    expect(
      await validateMcpToken(deps(), input({ authorizationHeader: `Bearer ${token}` })),
    ).toMatchObject({ kind: 'unauthenticated', reason: 'malformed_token' });
  });
});

describe('a token that does not verify', () => {
  it('is refused whatever failed, with one reason', async () => {
    expect(await validateMcpToken(deps({ claims: null }), input())).toEqual({
      kind: 'unauthenticated',
      reason: 'invalid_token',
    });
  });

  it('is refused when it names the admin API beside the endpoint, so no token serves both doors', async () => {
    const claims = { ...CLAIMS, aud: [RESOURCE, ADMIN_AUDIENCE] };
    expect(await validateMcpToken(deps({ claims }), input())).toEqual({
      kind: 'unauthenticated',
      reason: 'admin_audience',
    });
    const asString = { ...CLAIMS, aud: ADMIN_AUDIENCE };
    expect(await validateMcpToken(deps({ claims: asString }), input())).toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it.each([
    ['a missing subject', { sub: undefined }],
    ['an empty subject', { sub: '' }],
    ['a missing client_id', { client_id: undefined }],
    ['a numeric client_id', { client_id: 5 }],
    ['a missing grant_id', { grant_id: undefined }],
    ['a scope that is not a string', { scope: ['mcp:read'] }],
    ['no scope at all', { scope: undefined }],
  ])('is refused with %s', async (_l, change) => {
    const claims = { ...CLAIMS, ...change };
    expect(await validateMcpToken(deps({ claims }), input())).toMatchObject({
      kind: 'unauthenticated',
      reason: 'invalid_token',
    });
  });
});

describe('an issuer the tenant does not accept', () => {
  it('is refused before any key is read, as an issuer mismatch', async () => {
    let read = false;
    const d = deps();
    const spied: ValidateMcpTokenDeps = {
      ...d,
      verifyAccessToken: () => {
        read = true;
        return Promise.resolve(CLAIMS);
      },
    };
    const outcome = await validateMcpToken(
      spied,
      input({ authorizationHeader: `Bearer ${jwtWith('https://idp.example/tenants/other')}` }),
    );
    expect(outcome).toMatchObject({ kind: 'unauthenticated', reason: 'issuer_mismatch' });
    expect(read).toBe(false);
  });

  it('accepts an issuer the tenant retired while its window is open', async () => {
    const old = 'https://old.example';
    const outcome = await validateMcpToken(
      deps({ accepted: [ISSUER, old], claims: { ...CLAIMS, iss: old } }),
      input({ authorizationHeader: `Bearer ${jwtWith(old)}` }),
    );
    expect(outcome.kind).toBe('valid');
    if (outcome.kind === 'valid') expect(outcome.token.issuer).toBe(old);
  });
});

describe('a token whose grant has ended', () => {
  it.each([
    ['a revoked grant', { grantRevoked: true }, 'invalid_grant'],
    ['an ended session', { sessionLive: false }, 'dead_session'],
    ['a disabled client', { clientEnabled: false }, 'client_disabled'],
    ['a disabled subject', { subjectEnabled: false }, 'subject_disabled'],
  ] as const)('is refused for %s', async (_l, fakes, reason) => {
    expect(await validateMcpToken(deps(fakes), input())).toEqual({
      kind: 'unauthenticated',
      reason,
    });
  });

  it('is refused when its subject is not the owner of the grant it names', async () => {
    expect(await validateMcpToken(deps({ grantOwner: 'someone-else' }), input())).toEqual({
      kind: 'unauthenticated',
      reason: 'subject_mismatch',
    });
  });
});

describe('a token that holds no MCP scope', () => {
  it('is insufficient_scope, with the principal an audit row needs', async () => {
    const claims = { ...CLAIMS, scope: 'openid profile' };
    const outcome = await validateMcpToken(deps({ claims }), input());
    expect(outcome).toEqual({
      kind: 'insufficient_scope',
      principal: {
        subjectId: 'subject-1',
        issuerTenantId: 'tenant-1',
        issuerTenantName: 'acme',
        clientDbId: 'client-db-1',
        scopes: ['openid', 'profile'],
      },
    });
  });

  it('is judged after the grant, so a dead grant is unauthenticated and not a scope answer', async () => {
    const claims = { ...CLAIMS, scope: 'openid' };
    expect(await validateMcpToken(deps({ claims, grantRevoked: true }), input())).toMatchObject({
      kind: 'unauthenticated',
    });
  });

  it('is valid with mcp:write alone', async () => {
    const claims = { ...CLAIMS, scope: 'mcp:write' };
    expect((await validateMcpToken(deps({ claims }), input())).kind).toBe('valid');
  });
});
