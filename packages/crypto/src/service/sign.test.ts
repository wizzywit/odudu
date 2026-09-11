import { describe, expect, it } from 'vitest';
import { OduduError } from '@odudu/kernel';
import { generateSigningKey } from '#/service/generate';
import { type SigningKeyRecord } from '#/schema/signing-keys';
import { signJwt, verifyJwt } from '#/service/sign';

const KEK = new Uint8Array(32).fill(5);
const ISS = 'https://issuer.example';

async function makeKey(alg: 'RS256' | 'ES256'): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey(alg, KEK);
  return {
    id: 'id-1',
    realmId: 'realm-1',
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

describe('signJwt / verifyJwt', () => {
  it('round-trips a payload signed with an RS256 key', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-1', iss: ISS }, { key, kek: KEK });
    const payload = await verifyJwt(token, { keys: [key], issuer: ISS });
    expect(payload.sub).toBe('user-1');
  });

  it('round-trips a payload signed with an ES256 key', async () => {
    const key = await makeKey('ES256');
    const token = await signJwt({ sub: 'user-2', iss: ISS }, { key, kek: KEK });
    const payload = await verifyJwt(token, { keys: [key], issuer: ISS });
    expect(payload.sub).toBe('user-2');
  });

  it('carries the requested typ header through to verification', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-3', iss: ISS }, { key, kek: KEK, typ: 'at+jwt' });
    const payload = await verifyJwt(token, { keys: [key], issuer: ISS, typ: 'at+jwt' });
    expect(payload.sub).toBe('user-3');
  });

  it('rejects a token whose issuer does not match', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt({ sub: 'user-4', iss: ISS }, { key, kek: KEK });
    await expect(
      verifyJwt(token, { keys: [key], issuer: 'https://someone-else.example' }),
    ).rejects.toThrow();
  });

  it('rejects an audience that is not present', async () => {
    const key = await makeKey('RS256');
    const token = await signJwt(
      { sub: 'user-5', iss: ISS, aud: 'https://someone.example' },
      { key, kek: KEK },
    );
    await expect(
      verifyJwt(token, { keys: [key], issuer: ISS, audience: 'https://api.example' }),
    ).rejects.toThrow();
  });

  it('picks the matching key by kid out of several candidates', async () => {
    const first = await makeKey('RS256');
    const second = await makeKey('ES256');
    const token = await signJwt({ sub: 'user-6', iss: ISS }, { key: second, kek: KEK });
    const payload = await verifyJwt(token, { keys: [first, second], issuer: ISS });
    expect(payload.sub).toBe('user-6');
  });

  it('throws OduduError, not a raw SyntaxError, on a malformed header', async () => {
    const key = await makeKey('RS256');
    await expect(
      verifyJwt('not-a-jwt-at-all', { keys: [key], issuer: ISS }),
    ).rejects.toBeInstanceOf(OduduError);
  });
});
