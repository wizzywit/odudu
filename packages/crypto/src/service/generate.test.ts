import { describe, expect, it } from 'vitest';
import { generateSigningKey } from '#/service/generate';
import { unwrapPrivateJwk } from '#/service/kek';

const KEK = new Uint8Array(32).fill(3);

describe('generateSigningKey', () => {
  it('generates an RS256 key with a public JWK carrying no private members', async () => {
    const key = await generateSigningKey('RS256', KEK);
    expect(key.alg).toBe('RS256');
    expect(key.publicJwk.kty).toBe('RSA');
    expect(key.publicJwk).not.toHaveProperty('d');
    expect(typeof key.kid).toBe('string');
    expect(key.kid.length).toBeGreaterThan(0);
  });

  it('generates an ES256 key on the P-256 curve', async () => {
    const key = await generateSigningKey('ES256', KEK);
    expect(key.publicJwk.kty).toBe('EC');
    expect(key.publicJwk.crv).toBe('P-256');
  });

  it('wraps the private half so it can be recovered with the same KEK', async () => {
    const key = await generateSigningKey('RS256', KEK);
    const privateJwk = unwrapPrivateJwk<{ d: string }>(key.privateJwkEncrypted, KEK);
    expect(typeof privateJwk.d).toBe('string');
  });

  it('generates a different kid for each key', async () => {
    const a = await generateSigningKey('RS256', KEK);
    const b = await generateSigningKey('RS256', KEK);
    expect(a.kid).not.toBe(b.kid);
  });
});
