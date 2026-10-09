import { describe, expect, it } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { generateSigningKey } from '#/service/generate';
import { toPublicJwk } from '#/service/jwks';
import { signJwt } from '#/service/sign';
import { verifyJwtAgainstJwkSet, verifyJwtClaims } from '#/service/jwk-set-verify';
import { type SigningKeyRecord } from '#/schema/signing-keys';

const KEK = new Uint8Array(32).fill(3);
const ISSUER = 'client-a';
const AUDIENCE = 'https://issuer.example/protocol/openid-connect/token';
const NOW = new Date('2026-09-20T00:00:00Z');

async function makeKeyRecord(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', KEK);
  return {
    id: 'id-1',
    tenantId: 'tenant-1',
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

function jwkSet(key: SigningKeyRecord): unknown {
  return { keys: [toPublicJwk(key.publicJwk, key.kid, key.alg)] };
}

async function signAssertion(key: SigningKeyRecord, claims: Record<string, unknown>) {
  return signJwt(claims, { key, kek: KEK });
}

describe('verifyJwtAgainstJwkSet', () => {
  it('accepts a token signed by a key present in the set', async () => {
    const key = await makeKeyRecord();
    const token = await signAssertion(key, {
      iss: ISSUER,
      sub: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(NOW.getTime() / 1000) + 60,
    });
    await expect(
      verifyJwtAgainstJwkSet(token, jwkSet(key), { issuer: ISSUER, audience: AUDIENCE, now: NOW }),
    ).resolves.toBe(true);
  });

  it('refuses a token signed by a key absent from the set', async () => {
    const key = await makeKeyRecord();
    const stranger = await makeKeyRecord();
    const token = await signAssertion(stranger, {
      iss: ISSUER,
      sub: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(NOW.getTime() / 1000) + 60,
    });
    await expect(
      verifyJwtAgainstJwkSet(token, jwkSet(key), { issuer: ISSUER, audience: AUDIENCE, now: NOW }),
    ).resolves.toBe(false);
  });

  it('refuses a token whose iss does not match the expected client identity', async () => {
    const key = await makeKeyRecord();
    const token = await signAssertion(key, {
      iss: 'someone-else',
      sub: 'someone-else',
      aud: AUDIENCE,
      exp: Math.floor(NOW.getTime() / 1000) + 60,
    });
    await expect(
      verifyJwtAgainstJwkSet(token, jwkSet(key), { issuer: ISSUER, audience: AUDIENCE, now: NOW }),
    ).resolves.toBe(false);
  });

  it('refuses a token whose aud is not the expected token endpoint', async () => {
    const key = await makeKeyRecord();
    const token = await signAssertion(key, {
      iss: ISSUER,
      sub: ISSUER,
      aud: 'https://someone-else.example/token',
      exp: Math.floor(NOW.getTime() / 1000) + 60,
    });
    await expect(
      verifyJwtAgainstJwkSet(token, jwkSet(key), { issuer: ISSUER, audience: AUDIENCE, now: NOW }),
    ).resolves.toBe(false);
  });

  it('refuses a token already past its exp', async () => {
    const key = await makeKeyRecord();
    const token = await signAssertion(key, {
      iss: ISSUER,
      sub: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(NOW.getTime() / 1000) - 1,
    });
    await expect(
      verifyJwtAgainstJwkSet(token, jwkSet(key), { issuer: ISSUER, audience: AUDIENCE, now: NOW }),
    ).resolves.toBe(false);
  });

  it('refuses a jwks value that is not a JSON Web Key Set', async () => {
    const key = await makeKeyRecord();
    const token = await signAssertion(key, {
      iss: ISSUER,
      sub: ISSUER,
      aud: AUDIENCE,
      exp: Math.floor(NOW.getTime() / 1000) + 60,
    });
    await expect(
      verifyJwtAgainstJwkSet(
        token,
        { not: 'a jwk set' },
        {
          issuer: ISSUER,
          audience: AUDIENCE,
          now: NOW,
        },
      ),
    ).resolves.toBe(false);
  });

  it('refuses a malformed token rather than throwing', async () => {
    const key = await makeKeyRecord();
    await expect(
      verifyJwtAgainstJwkSet('not-a-jwt-at-all', jwkSet(key), {
        issuer: ISSUER,
        audience: AUDIENCE,
        now: NOW,
      }),
    ).resolves.toBe(false);
  });

  // RFC 7523 §2.2 leaves the client's signing algorithm to its own
  // registered jwks; discovery advertises no restricted
  // token_endpoint_auth_signing_alg_values_supported, so a client that
  // signs with PS256 must still verify.
  it('accepts a PS256-signed assertion from a client jwks', async () => {
    const { publicKey, privateKey } = await generateKeyPair('PS256', { extractable: true });
    const publicJwk = await exportJWK(publicKey);
    const jwks = { keys: [{ ...publicJwk, kid: 'ps-1', alg: 'PS256', use: 'sig' }] };
    const token = await new SignJWT({
      iss: ISSUER,
      sub: ISSUER,
      aud: AUDIENCE,
    })
      .setProtectedHeader({ alg: 'PS256', kid: 'ps-1' })
      .setIssuedAt()
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 60)
      .sign(privateKey);
    await expect(
      verifyJwtAgainstJwkSet(token, jwks, { issuer: ISSUER, audience: AUDIENCE, now: NOW }),
    ).resolves.toBe(true);
  });
});

const ID_ISSUER = 'https://issuer.example';
const ID_AUDIENCE = 'console-client';
const ID_ALGORITHMS = ['RS256', 'ES256'] as const;

async function makeIdKeyPair(kid: string) {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  return { privateKey, jwks: { keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] } };
}

async function signIdToken(
  privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'],
  kid: string,
  claims: Record<string, unknown>,
  overrides: { exp?: number } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(ID_ISSUER)
    .setAudience(ID_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(overrides.exp ?? Math.floor(NOW.getTime() / 1000) + 60)
    .sign(privateKey);
}

describe('verifyJwtClaims', () => {
  it('returns the verified claims for a good token', async () => {
    const { privateKey, jwks } = await makeIdKeyPair('kid-1');
    const token = await signIdToken(privateKey, 'kid-1', {
      sub: 'user-1',
      nonce: 'nonce-1',
    });
    await expect(
      verifyJwtClaims(token, jwks, {
        issuer: ID_ISSUER,
        audience: ID_AUDIENCE,
        now: NOW,
        algorithms: ID_ALGORITHMS,
      }),
    ).resolves.toMatchObject({ sub: 'user-1', nonce: 'nonce-1' });
  });

  it('returns null for a wrong issuer', async () => {
    const { privateKey, jwks } = await makeIdKeyPair('kid-1');
    const token = await new SignJWT({ sub: 'user-1', nonce: 'nonce-1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
      .setIssuer('someone-else')
      .setAudience(ID_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 60)
      .sign(privateKey);
    await expect(
      verifyJwtClaims(token, jwks, {
        issuer: ID_ISSUER,
        audience: ID_AUDIENCE,
        now: NOW,
        algorithms: ID_ALGORITHMS,
      }),
    ).resolves.toBeNull();
  });

  it('returns null for a wrong audience', async () => {
    const { privateKey, jwks } = await makeIdKeyPair('kid-1');
    const token = await new SignJWT({ sub: 'user-1', nonce: 'nonce-1' })
      .setProtectedHeader({ alg: 'RS256', kid: 'kid-1' })
      .setIssuer(ID_ISSUER)
      .setAudience('someone-else')
      .setIssuedAt()
      .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 60)
      .sign(privateKey);
    await expect(
      verifyJwtClaims(token, jwks, {
        issuer: ID_ISSUER,
        audience: ID_AUDIENCE,
        now: NOW,
        algorithms: ID_ALGORITHMS,
      }),
    ).resolves.toBeNull();
  });

  it('returns null for an expired token', async () => {
    const { privateKey, jwks } = await makeIdKeyPair('kid-1');
    const token = await signIdToken(
      privateKey,
      'kid-1',
      { sub: 'user-1', nonce: 'nonce-1' },
      { exp: Math.floor(NOW.getTime() / 1000) - 1 },
    );
    await expect(
      verifyJwtClaims(token, jwks, {
        issuer: ID_ISSUER,
        audience: ID_AUDIENCE,
        now: NOW,
        algorithms: ID_ALGORITHMS,
      }),
    ).resolves.toBeNull();
  });

  it('returns null for an alg: none token', async () => {
    const { jwks } = await makeIdKeyPair('kid-1');
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'kid-1' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        nonce: 'nonce-1',
        iss: ID_ISSUER,
        aud: ID_AUDIENCE,
        exp: Math.floor(NOW.getTime() / 1000) + 60,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.`;
    await expect(
      verifyJwtClaims(token, jwks, {
        issuer: ID_ISSUER,
        audience: ID_AUDIENCE,
        now: NOW,
        algorithms: ID_ALGORITHMS,
      }),
    ).resolves.toBeNull();
  });

  it('returns null for a token signed by a key absent from the set', async () => {
    const { jwks } = await makeIdKeyPair('kid-1');
    const stranger = await makeIdKeyPair('kid-2');
    const token = await signIdToken(stranger.privateKey, 'kid-2', {
      sub: 'user-1',
      nonce: 'nonce-1',
    });
    await expect(
      verifyJwtClaims(token, jwks, {
        issuer: ID_ISSUER,
        audience: ID_AUDIENCE,
        now: NOW,
        algorithms: ID_ALGORITHMS,
      }),
    ).resolves.toBeNull();
  });

  it('refuses an alg: none token even with algorithms omitted', async () => {
    const { jwks } = await makeIdKeyPair('kid-1');
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'kid-1' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        sub: 'user-1',
        nonce: 'nonce-1',
        iss: ID_ISSUER,
        aud: ID_AUDIENCE,
        exp: Math.floor(NOW.getTime() / 1000) + 60,
      }),
    ).toString('base64url');
    const token = `${header}.${payload}.`;
    await expect(
      verifyJwtClaims(token, jwks, { issuer: ID_ISSUER, audience: ID_AUDIENCE, now: NOW }),
    ).resolves.toBeNull();
  });
});
