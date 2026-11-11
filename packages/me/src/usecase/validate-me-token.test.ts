import { addressIssuer, mcpAudienceOfIssuer, meAudienceOfIssuer, pathAddress } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import {
  validateMeToken,
  type ValidateMeTokenDeps,
  type ValidateMeTokenInput,
} from '#/usecase/validate-me-token';

const ADDRESS = pathAddress('https://idp.example', 'acme');
const ISSUER = addressIssuer(ADDRESS);
const ME = meAudienceOfIssuer(ISSUER);
const NOW = new Date('2026-11-11T10:00:00Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

const CLAIMS: Record<string, unknown> = {
  iss: ISSUER,
  aud: [ME],
  sub: 'subject-1',
  client_id: 'app',
  sid: 'session-1',
  scope: 'openid me:read me:write',
  exp: NOW_S + 600,
};

interface Fakes {
  claims?: Record<string, unknown>;
  accepted?: readonly string[];
  seen?: { expected?: { issuers: readonly string[]; audience: string }; tenantId?: string };
}

// Stands in for signature verification the way `verifyJwt` decides audience
// and expiry: the token's `aud` must hold the audience asked for.
function deps(f: Fakes = {}): ValidateMeTokenDeps {
  return {
    acceptedIssuers: () => Promise.resolve(f.accepted ?? [ISSUER]),
    verifyAccessToken: (tenantId, _token, expected) => {
      if (f.seen !== undefined) {
        f.seen.expected = expected;
        f.seen.tenantId = tenantId;
      }
      const claims = f.claims ?? CLAIMS;
      const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      const exp = typeof claims.exp === 'number' ? claims.exp : 0;
      const standing = aud.includes(expected.audience) && exp > NOW_S;
      return Promise.resolve(standing ? claims : null);
    },
  };
}

function jwtWith(iss: string): string {
  const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${part({ alg: 'ES256' })}.${part({ iss })}.sig`;
}

function input(over: Partial<ValidateMeTokenInput> = {}): ValidateMeTokenInput {
  return {
    authorizationHeader: `Bearer ${jwtWith(ISSUER)}`,
    tenant: { id: 'tenant-1', name: 'acme' },
    address: ADDRESS,
    now: NOW,
    ...over,
  };
}

describe('a token that stands', () => {
  it('names its subject, tenant, client, session and scopes', async () => {
    expect(await validateMeToken(deps(), input())).toEqual({
      kind: 'ok',
      subjectId: 'subject-1',
      tenantId: 'tenant-1',
      clientId: 'app',
      sessionId: 'session-1',
      scopes: ['openid', 'me:read', 'me:write'],
      isAgent: false,
    });
  });

  it('is verified against the tenant’s "me" URL and issuers, and nothing wider', async () => {
    const seen: NonNullable<Fakes['seen']> = {};
    await validateMeToken(deps({ seen }), input());
    expect(seen).toEqual({ expected: { issuers: [ISSUER], audience: ME }, tenantId: 'tenant-1' });
  });

  it('has no session when the grant has none', async () => {
    const claims = { ...CLAIMS, sid: undefined };
    expect(await validateMeToken(deps({ claims }), input())).toMatchObject({
      kind: 'ok',
      sessionId: null,
    });
  });

  it('is an agent’s when it carries an `act` claim', async () => {
    const claims = { ...CLAIMS, act: { sub: 'agent-client' } };
    expect(await validateMeToken(deps({ claims }), input())).toMatchObject({
      kind: 'ok',
      isAgent: true,
    });
  });
});

describe('a request the door refuses', () => {
  const refusal = (reason: string) => ({ kind: 'unauthenticated', reason });

  it.each([
    ['no header', undefined],
    ['another scheme', 'Basic dXNlcjpwYXNz'],
    ['an empty bearer', 'Bearer '],
  ])('with %s is refused for missing credentials', async (_l, header) => {
    expect(await validateMeToken(deps(), input({ authorizationHeader: header }))).toEqual(
      refusal('missing_credentials'),
    );
  });

  it.each(['a.b', 'a.b.c', 'x.!!!.y'])('with the token %j is malformed', async (token) => {
    expect(
      await validateMeToken(deps(), input({ authorizationHeader: `Bearer ${token}` })),
    ).toEqual(refusal('malformed_token'));
  });

  it('refuses another tenant’s issuer, which it never verifies', async () => {
    const seen: NonNullable<Fakes['seen']> = {};
    const header = `Bearer ${jwtWith('https://idp.example/tenants/other')}`;
    expect(await validateMeToken(deps({ seen }), input({ authorizationHeader: header }))).toEqual(
      refusal('issuer_mismatch'),
    );
    expect(seen.expected).toBeUndefined();
  });

  it('accepts an issuer the tenant has left while its window is open', async () => {
    const old = 'https://old.example';
    const claims = { ...CLAIMS, iss: old };
    const header = `Bearer ${jwtWith(old)}`;
    expect(
      await validateMeToken(
        deps({ claims, accepted: [ISSUER, old] }),
        input({ authorizationHeader: header }),
      ),
    ).toMatchObject({ kind: 'ok' });
  });

  it.each([
    ['an MCP-audience token', [mcpAudienceOfIssuer(ISSUER)]],
    ['an admin-audience token', ['urn:odudu:admin-api']],
    ['the issuer as audience (a userinfo token)', [ISSUER]],
    ['another tenant’s "me" audience', ['https://idp.example/tenants/other/me']],
  ])('refuses %s', async (_l, aud) => {
    expect(await validateMeToken(deps({ claims: { ...CLAIMS, aud } }), input())).toEqual(
      refusal('invalid_token'),
    );
  });

  it('refuses an expired token', async () => {
    const claims = { ...CLAIMS, exp: NOW_S - 1 };
    expect(await validateMeToken(deps({ claims }), input())).toEqual(refusal('invalid_token'));
  });

  it.each([
    ['a missing sub', { sub: undefined }],
    ['an empty sub', { sub: '' }],
    ['a missing client_id', { client_id: undefined }],
    ['a numeric client_id', { client_id: 5 }],
  ])('refuses a token with %s', async (_l, change) => {
    const claims = { ...CLAIMS, ...change };
    expect(await validateMeToken(deps({ claims }), input())).toEqual(refusal('invalid_token'));
  });

  it('refuses a malformed act claim, which would hide an agent', async () => {
    const claims = { ...CLAIMS, act: 'agent' };
    expect(await validateMeToken(deps({ claims }), input())).toEqual(refusal('invalid_token'));
  });
});
