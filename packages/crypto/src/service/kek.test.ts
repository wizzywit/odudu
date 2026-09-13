import { describe, expect, it } from 'vitest';
import { unwrapPrivateJwk, wrapPrivateJwk } from '#/service/kek';

const KEK = new Uint8Array(32).fill(7);
const JWK = { kty: 'RSA', n: 'abc', e: 'AQAB', d: 'secret-private-exponent' };

describe('KEK wrapping', () => {
  it('round-trips a private JWK', () => {
    expect(unwrapPrivateJwk(wrapPrivateJwk(JWK, KEK), KEK)).toEqual(JWK);
  });

  it('produces different ciphertext each time for the same input', () => {
    expect(wrapPrivateJwk(JWK, KEK)).not.toEqual(wrapPrivateJwk(JWK, KEK));
  });

  it('never leaves the private exponent readable in the wrapped form', () => {
    expect(wrapPrivateJwk(JWK, KEK)).not.toContain('secret-private-exponent');
  });

  it('refuses to unwrap with the wrong key rather than returning garbage', () => {
    const wrong = new Uint8Array(32).fill(8);
    expect(() => unwrapPrivateJwk(wrapPrivateJwk(JWK, KEK), wrong)).toThrow();
  });

  it('refuses to unwrap tampered ciphertext', () => {
    const wrapped = wrapPrivateJwk(JWK, KEK);
    expect(() => unwrapPrivateJwk(wrapped.slice(0, -4) + 'AAAA', KEK)).toThrow();
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => wrapPrivateJwk(JWK, new Uint8Array(16))).toThrow(/32 bytes/);
  });
});
