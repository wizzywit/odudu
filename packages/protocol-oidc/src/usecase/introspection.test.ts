import { describe, expect, it, vi } from 'vitest';
import { generateSigningKey, signJwt, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { introspect, type IntrospectionDeps } from '#/usecase/introspection';

const KEK = new Uint8Array(32).fill(7);
const ISSUER = 'https://op.example/realms/demo';
const NOW = new Date('2026-09-21T10:00:00Z');

async function makeSigningKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', KEK);
  return {
    id: 'key-1',
    realmId: 'realm-1',
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: NOW,
    notAfter: null,
  };
}

interface AccessTokenClaims {
  sub?: string;
  client_id?: string;
  scope?: string;
  aud?: string[];
  sid?: string;
  iat?: number;
  exp?: number;
  jti?: string;
}

function accessTokenPayload(claims: AccessTokenClaims): Record<string, unknown> {
  const iat = claims.iat ?? Math.floor(NOW.getTime() / 1000);
  const exp = claims.exp ?? iat + 3600;
  return {
    iss: ISSUER,
    sub: claims.sub ?? 'subject-1',
    aud: claims.aud ?? ['https://api.example', ISSUER],
    client_id: claims.client_id ?? 'client-a',
    scope: claims.scope ?? 'openid profile',
    jti: claims.jti ?? 'jti-1',
    iat,
    exp,
    ...(claims.sid !== undefined ? { sid: claims.sid } : {}),
  };
}

// The default caller: entitled through `audiences`, never through
// `clientId` — that dimension is exercised separately by the negative
// test, per R-27a's requirement that it match on neither.
const caller = { clientId: 'resource-server-a', audiences: ['https://api.example'] };

function makeDeps(overrides: Partial<IntrospectionDeps> = {}): IntrospectionDeps {
  return {
    issuer: ISSUER,
    idleSeconds: 300,
    keys: [],
    loadGrant: () => Promise.resolve({ revokedAt: null }),
    isSessionLive: () => Promise.resolve(true),
    ...overrides,
  };
}

describe('introspect', () => {
  it('describes a live token to a caller named in its audience', async () => {
    const key = await makeSigningKey();
    const token = await signJwt(accessTokenPayload({ sid: 'session-1' }), {
      key,
      kek: KEK,
      typ: 'at+jwt',
    });
    const deps = makeDeps({ keys: [key] });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toMatchObject({
      active: true,
      scope: 'openid profile',
      client_id: 'client-a',
      sub: 'subject-1',
      aud: ['https://api.example', ISSUER],
      token_type: 'Bearer',
    });
  });

  it('answers inactive to a caller not in its audience', async () => {
    const key = await makeSigningKey();
    const token = await signJwt(accessTokenPayload({ sid: 'session-1' }), {
      key,
      kek: KEK,
      typ: 'at+jwt',
    });
    const deps = makeDeps({ keys: [key] });
    // Matches neither `caller.clientId` nor any of `caller.audiences`
    // against the token's `aud` (`['https://api.example', ISSUER]`).
    const unentitledCaller = {
      clientId: 'unrelated-client',
      audiences: ['https://elsewhere.example'],
    };

    const response = await introspect(deps, { token, caller: unentitledCaller }, NOW);

    expect(response).toEqual({ active: false });
  });

  it('answers inactive for a token whose grant was revoked', async () => {
    const key = await makeSigningKey();
    const token = await signJwt(accessTokenPayload({ sid: 'session-1' }), {
      key,
      kek: KEK,
      typ: 'at+jwt',
    });
    const deps = makeDeps({
      keys: [key],
      loadGrant: () => Promise.resolve({ revokedAt: new Date('2026-09-20T00:00:00Z') }),
    });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  it('answers inactive for a token whose session has ended, before its exp', async () => {
    const key = await makeSigningKey();
    const token = await signJwt(accessTokenPayload({ sid: 'session-1' }), {
      key,
      kek: KEK,
      typ: 'at+jwt',
    });
    const deps = makeDeps({ keys: [key], isSessionLive: () => Promise.resolve(false) });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  it('keeps an offline token active, since it has no session to end', async () => {
    const key = await makeSigningKey();
    // No `sid` at all — token-issuance never binds an offline_access grant
    // to a session (`mintAccessToken`'s `sid` comment).
    const token = await signJwt(accessTokenPayload({}), { key, kek: KEK, typ: 'at+jwt' });
    const isSessionLive = vi.fn(() => Promise.resolve(false));
    const deps = makeDeps({ keys: [key], isSessionLive });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response.active).toBe(true);
    // The absent session is never asked about — reporting this token dead
    // would have to come from somewhere else, since this mock always says
    // "not live".
    expect(isSessionLive).not.toHaveBeenCalled();
  });

  it('answers inactive for a token that does not parse, without saying why', async () => {
    const key = await makeSigningKey();
    const deps = makeDeps({ keys: [key] });

    const response = await introspect(deps, { token: 'not-a-token', caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  it('answers inactive for a token signed by another realm', async () => {
    const key = await makeSigningKey();
    const foreignKey = await makeSigningKey();
    const foreignToken = await signJwt(accessTokenPayload({ sid: 'session-1' }), {
      key: foreignKey,
      kek: KEK,
      typ: 'at+jwt',
    });
    // Proof this token is genuinely valid under its own realm's keys, not
    // merely malformed — the only thing that distinguishes it from the
    // live-token fixture above is which key signed it.
    await expect(
      verifyJwt(foreignToken, {
        keys: [foreignKey],
        issuer: ISSUER,
        audience: 'https://api.example',
        typ: 'at+jwt',
      }),
    ).resolves.toBeDefined();

    const deps = makeDeps({ keys: [key] });

    const response = await introspect(deps, { token: foreignToken, caller }, NOW);

    expect(response).toEqual({ active: false });
  });
});
