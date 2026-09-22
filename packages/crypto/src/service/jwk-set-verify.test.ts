import { describe, expect, it } from 'vitest';
import { generateSigningKey } from '#/service/generate';
import { toPublicJwk } from '#/service/jwks';
import { signJwt } from '#/service/sign';
import { verifyJwtAgainstJwkSet } from '#/service/jwk-set-verify';
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
});
