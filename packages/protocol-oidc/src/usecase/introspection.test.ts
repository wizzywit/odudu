import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateSigningKey, signJwt, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import { introspect, type IntrospectionDeps } from '#/usecase/introspection';

const KEK = new Uint8Array(32).fill(7);
const ISSUER = 'https://op.example/tenants/demo';
const NOW = new Date('2026-09-21T10:00:00Z');

// Pins the same clock into both `introspect`'s own `now` argument and
// `verifyJwt`'s `exp` check, which otherwise reads the system clock: a
// suite with an absolute `exp` and no fake timer goes red the moment the
// wall clock catches up to it, and several refusal tests would then pass
// on expiry rather than the rule each names.
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

async function makeSigningKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', KEK);
  return {
    id: 'key-1',
    tenantId: 'tenant-1',
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
  iss?: string;
  sub?: string | null;
  client_id?: string | null;
  scope?: string | null;
  aud?: string[];
  sid?: string;
  iat?: number;
  exp?: number;
  jti?: string;
  // `undefined` (the default) carries a claim; `null` omits it entirely —
  // used by the fail-closed test, where a pre-`grant_id` token carries no
  // claim at all rather than an empty one.
  grantId?: string | null;
}

function accessTokenPayload(claims: AccessTokenClaims): Record<string, unknown> {
  const iat = claims.iat ?? Math.floor(NOW.getTime() / 1000);
  const exp = claims.exp ?? iat + 3600;
  const grantId = claims.grantId === undefined ? 'grant-a' : claims.grantId;
  return {
    iss: claims.iss ?? ISSUER,
    ...(claims.sub !== null ? { sub: claims.sub ?? 'subject-1' } : {}),
    aud: claims.aud ?? ['https://api.example', ISSUER],
    ...(claims.client_id !== null ? { client_id: claims.client_id ?? 'client-a' } : {}),
    ...(claims.scope !== null ? { scope: claims.scope ?? 'openid profile' } : {}),
    jti: claims.jti ?? 'jti-1',
    iat,
    exp,
    ...(claims.sid !== undefined ? { sid: claims.sid } : {}),
    ...(grantId !== null ? { grant_id: grantId } : {}),
  };
}

// The default caller: entitled through `audiences`, never through
// `clientId` — that dimension is exercised separately by its own positive
// test below, and the negative test matches on neither.
const caller = { clientId: 'resource-server-a', audiences: ['https://api.example'] };

function makeDeps(overrides: Partial<IntrospectionDeps> = {}): IntrospectionDeps {
  return {
    issuer: ISSUER,
    lifespans: {
      ssoSessionIdleSeconds: 300,
      ssoSessionMaxSeconds: 36_000,
      rememberMeIdleSeconds: 604_800,
      rememberMeMaxSeconds: 2_592_000,
    },
    keys: [],
    loadGrant: () => Promise.resolve({ revokedAt: null }),
    isSessionLive: () => Promise.resolve(true),
    ...overrides,
  };
}

async function mintToken(claims: AccessTokenClaims, key: SigningKeyRecord): Promise<string> {
  return signJwt(accessTokenPayload(claims), { key, kek: KEK, typ: 'at+jwt' });
}

describe('introspect', () => {
  it('describes a live token to a caller named in its audience', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1' }, key);
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

  // The other entitlement dimension: a caller with no matching
  // `audiences` entry, entitled only because a deployment registered its
  // resource URI as a `client_id`. Deleting `caller.clientId` from
  // `callerIsAddressed`'s identities list leaves this test alone red.
  it('describes a live token to a caller entitled through its own client_id', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1' }, key);
    const deps = makeDeps({ keys: [key] });
    const clientIdCaller = { clientId: 'https://api.example', audiences: [] };

    const response = await introspect(deps, { token, caller: clientIdCaller }, NOW);

    expect(response.active).toBe(true);
  });

  it('answers inactive to a caller not in its audience', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1' }, key);
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

  it('[RFC7662-4-02] answers inactive for a token whose grant was revoked', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1' }, key);
    const deps = makeDeps({
      keys: [key],
      loadGrant: () => Promise.resolve({ revokedAt: new Date('2026-09-20T00:00:00Z') }),
    });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  // RFC 7662 §2.2's fused MUST also names "does not exist on this server"
  // as its own condition, distinct from "revoked".
  it('[RFC7662-2.2-04] answers inactive for a token whose grant does not exist', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1' }, key);
    const deps = makeDeps({ keys: [key], loadGrant: () => Promise.resolve(null) });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  // The whole point of a per-grant `grant_id` claim. Two grants — a
  // revoked one (the id this token actually names) and a live sibling —
  // are distinguishable only by id; `loadGrant` is asserted to have been
  // called with the token's own id, not the sibling's, so this cannot
  // pass by `loadGrant` returning the wrong row and disagreeing with the
  // assertion for unrelated reasons.
  it('answers inactive for a revoked grant even when a live sibling grant exists', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ grantId: 'grant-a' }, key);
    const grants = new Map<string, { revokedAt: Date | null }>([
      ['grant-a', { revokedAt: new Date('2026-09-20T00:00:00Z') }],
      ['grant-b', { revokedAt: null }],
    ]);
    const loadGrant = vi.fn((id: string) => Promise.resolve(grants.get(id) ?? null));
    const deps = makeDeps({ keys: [key], loadGrant });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
    expect(loadGrant).toHaveBeenCalledWith('grant-a');
    expect(loadGrant).not.toHaveBeenCalledWith('grant-b');
  });

  // A token minted before `grant_id` existed carries no such claim, and
  // must not fall back to any triple-based guess — it is simply inactive.
  it('answers inactive for a token minted before grant_id existed', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1', grantId: null }, key);
    const loadGrant = vi.fn(() => Promise.resolve({ revokedAt: null }));
    const deps = makeDeps({ keys: [key], loadGrant });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
    expect(loadGrant).not.toHaveBeenCalled();
  });

  it('answers inactive for a token whose session has ended, before its exp', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sid: 'session-1' }, key);
    const deps = makeDeps({ keys: [key], isSessionLive: () => Promise.resolve(false) });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  it('keeps an offline token active, since it has no session to end', async () => {
    const key = await makeSigningKey();
    // No `sid` at all — token-issuance never binds an offline_access grant
    // to a session (`mintAccessToken`'s `sid` comment).
    const token = await mintToken({}, key);
    const isSessionLive = vi.fn(() => Promise.resolve(false));
    const deps = makeDeps({ keys: [key], isSessionLive });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response.active).toBe(true);
    // The absent session is never asked about — reporting this token dead
    // would have to come from somewhere else, since this mock always says
    // "not live".
    expect(isSessionLive).not.toHaveBeenCalled();
  });

  it('[RFC7662-4-01] answers inactive for a token whose exp has passed', async () => {
    const key = await makeSigningKey();
    const iat = Math.floor(NOW.getTime() / 1000) - 7200;
    const token = await mintToken({ sid: 'session-1', iat, exp: iat + 3600 }, key);
    const deps = makeDeps({ keys: [key] });

    const response = await introspect(deps, { token, caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  // The claim-shape guards. Each constructs a token missing exactly one
  // required claim, verified via `signJwt` rather than the JWT library
  // filling in a default.
  it('answers inactive when client_id is missing', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ client_id: null }, key);
    const deps = makeDeps({ keys: [key] });

    expect(await introspect(deps, { token, caller }, NOW)).toEqual({ active: false });
  });

  it('answers inactive when sub is missing', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ sub: null }, key);
    const deps = makeDeps({ keys: [key] });

    expect(await introspect(deps, { token, caller }, NOW)).toEqual({ active: false });
  });

  it('answers inactive when scope is missing', async () => {
    const key = await makeSigningKey();
    const token = await mintToken({ scope: null }, key);
    const deps = makeDeps({ keys: [key] });

    expect(await introspect(deps, { token, caller }, NOW)).toEqual({ active: false });
  });

  it('answers inactive when exp and iat are absent', async () => {
    // A JWT with no `exp` verifies fine (`verifyJwt` never requires one),
    // so this exercises introspection's own claim-shape guard rather than
    // `verifyJwt`'s expiry check.
    const key = await makeSigningKey();
    const payload = accessTokenPayload({ sid: 'session-1' });
    delete payload.exp;
    delete payload.iat;
    const token = await signJwt(payload, { key, kek: KEK, typ: 'at+jwt' });
    const deps = makeDeps({ keys: [key] });

    expect(await introspect(deps, { token, caller }, NOW)).toEqual({ active: false });
  });

  it('[RFC7662-2.1-02] answers inactive for a token that does not parse, without saying why', async () => {
    const key = await makeSigningKey();
    const deps = makeDeps({ keys: [key] });

    const response = await introspect(deps, { token: 'not-a-token', caller }, NOW);

    expect(response).toEqual({ active: false });
  });

  it('[RFC7662-4-03] answers inactive for a token signed by another tenant', async () => {
    const key = await makeSigningKey();
    const foreignKey = await makeSigningKey();
    const foreignToken = await mintToken({ sid: 'session-1' }, foreignKey);
    // Proof this token is genuinely valid under its own tenant's keys, not
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

  // The test above pins unknown-`kid` isolation, not issuer isolation — a
  // token from an actually foreign tenant also carries that tenant's own
  // `iss`. This one is refused there instead, before any key lookup:
  // `verifyJwt`'s `issuer` option is `ISSUER`, so a token minted under a
  // different issuer fails `jwtVerify`'s own `iss` check.
  it('answers inactive for a token issued by another issuer', async () => {
    const key = await makeSigningKey();
    const foreignIssuerToken = await mintToken(
      { iss: 'https://op.example/tenants/other', sid: 'session-1' },
      key,
    );
    const deps = makeDeps({ keys: [key] });

    const response = await introspect(deps, { token: foreignIssuerToken, caller }, NOW);

    expect(response).toEqual({ active: false });
  });
});
