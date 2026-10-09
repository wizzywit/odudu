import { exportJWK, generateKeyPair, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';
import { PRIVATE_JWK_MEMBERS } from '#/service/jwks';
import { verifyJwtClaims } from '#/service/jwk-set-verify';
import {
  generateClientKey,
  loadClientKey,
  loadRetiredClientKey,
  registeredClientJwks,
  signClientAssertion,
} from '#/service/client-key';

const NOW = new Date('2026-10-09T00:00:00Z');

function encoded(jwk: JWK | Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(jwk), 'utf8').toString('base64');
}

function decoded(serialized: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(serialized, 'base64').toString('utf8')) as Record<string, unknown>;
}
const AUDIENCE = 'https://idp.example/tenants/acme/protocol/openid-connect/token';

describe('generateClientKey', () => {
  it('serialises an ES256 private JWK as base64 that loads back', async () => {
    const serialized = await generateClientKey();
    expect(serialized).toMatch(/^[A-Za-z0-9+/]+=*$/u);
    const parsed = decoded(serialized);
    expect(parsed).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
    const key = await loadClientKey(serialized);
    expect(key.kid).toBe(parsed.kid);
  });

  it('gives every key its own kid', async () => {
    const a = await loadClientKey(await generateClientKey());
    const b = await loadClientKey(await generateClientKey());
    expect(a.kid).not.toBe(b.kid);
  });
});

describe('loadClientKey', () => {
  it('refuses a value that is not JSON', async () => {
    await expect(loadClientKey('not json')).rejects.toThrow(/not base64-encoded JSON/u);
  });

  it('refuses a public key: it cannot sign', async () => {
    const { publicKey } = await generateKeyPair('ES256', { extractable: true });
    await expect(loadClientKey(encoded(await exportJWK(publicKey)))).rejects.toThrow(/private/u);
  });

  it('refuses a key that is not P-256', async () => {
    const { privateKey } = await generateKeyPair('ES384', { extractable: true });
    await expect(loadClientKey(encoded(await exportJWK(privateKey)))).rejects.toThrow(/P-256/u);
  });

  it('refuses an RSA key', async () => {
    const { privateKey } = await generateKeyPair('RS256', { extractable: true });
    await expect(loadClientKey(encoded(await exportJWK(privateKey)))).rejects.toThrow(/P-256/u);
  });

  it('derives the kid from the key, ignoring one the value carries', async () => {
    const original = decoded(await generateClientKey());
    const key = await loadClientKey(encoded({ ...original, kid: 'chosen-by-someone' }));
    expect(key.kid).toBe(original.kid);
  });
});

describe('loadRetiredClientKey', () => {
  it('accepts a private key and keeps only its public half', async () => {
    const retired = await loadRetiredClientKey(await generateClientKey());
    for (const member of PRIVATE_JWK_MEMBERS) expect(retired).not.toHaveProperty(member);
    expect(retired).toMatchObject({ kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig' });
  });

  it('accepts a public key', async () => {
    const current = await loadClientKey(await generateClientKey());
    const retired = await loadRetiredClientKey(encoded(current.publicJwk));
    expect(retired).toEqual(current.publicJwk);
  });

  it('refuses a value that is not a P-256 key', async () => {
    await expect(loadRetiredClientKey(encoded({ kty: 'oct', k: 'AAAA' }))).rejects.toThrow(
      /P-256/u,
    );
  });
});

describe('registeredClientJwks', () => {
  it('lists the signing key first, then each retired one, with no private member', async () => {
    const current = await loadClientKey(await generateClientKey());
    const retired = await loadRetiredClientKey(await generateClientKey());
    const jwks = registeredClientJwks(current, [retired]);
    expect(jwks.keys.map((k) => k.kid)).toEqual([current.kid, retired.kid]);
    for (const key of jwks.keys) {
      for (const member of PRIVATE_JWK_MEMBERS) expect(key).not.toHaveProperty(member);
    }
  });

  it('lists a retired key that duplicates the signing key once', async () => {
    const serialized = await generateClientKey();
    const current = await loadClientKey(serialized);
    const same = await loadRetiredClientKey(serialized);
    expect(registeredClientJwks(current, [same]).keys).toHaveLength(1);
  });
});

describe('signClientAssertion', () => {
  it('signs what the server verifies for private_key_jwt: iss and sub the client, aud the endpoint', async () => {
    const key = await loadClientKey(await generateClientKey());
    const assertion = await signClientAssertion(key, {
      clientId: 'odudu-admin',
      audience: AUDIENCE,
      now: NOW,
    });
    const claims = await verifyJwtClaims(assertion, registeredClientJwks(key, []), {
      issuer: 'odudu-admin',
      audience: AUDIENCE,
      now: NOW,
    });
    expect(claims).toMatchObject({ iss: 'odudu-admin', sub: 'odudu-admin', aud: AUDIENCE });
    expect(claims?.exp).toBe(NOW.getTime() / 1000 + 60);
  });

  it('carries a fresh jti every time', async () => {
    const key = await loadClientKey(await generateClientKey());
    const input = { clientId: 'odudu-admin', audience: AUDIENCE, now: NOW };
    const jtis = await Promise.all(
      [1, 2, 3].map(async () => {
        const claims = await verifyJwtClaims(
          await signClientAssertion(key, input),
          registeredClientJwks(key, []),
          { issuer: 'odudu-admin', audience: AUDIENCE, now: NOW },
        );
        return claims?.jti;
      }),
    );
    expect(new Set(jtis).size).toBe(3);
  });

  it('is not accepted against a different key', async () => {
    const key = await loadClientKey(await generateClientKey());
    const other = await loadClientKey(await generateClientKey());
    const assertion = await signClientAssertion(key, {
      clientId: 'odudu-admin',
      audience: AUDIENCE,
      now: NOW,
    });
    expect(
      await verifyJwtClaims(assertion, registeredClientJwks(other, []), {
        issuer: 'odudu-admin',
        audience: AUDIENCE,
        now: NOW,
      }),
    ).toBeNull();
  });
});
