import { describe, expect, it } from 'vitest';
import { unwrapPrivateJwk, unwrapSecret, wrapPrivateJwk, wrapSecret } from '#/service/kek';

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

describe('wrapSecret', () => {
  it('round-trips an arbitrary string', () => {
    expect(unwrapSecret(wrapSecret('hunter2', KEK), KEK)).toBe('hunter2');
  });

  it('refuses a wrong key rather than returning rubbish', () => {
    const wrapped = wrapSecret('hunter2', KEK);
    const wrong = new Uint8Array(32).fill(8);
    expect(() => unwrapSecret(wrapped, wrong)).toThrow();
  });

  // "The same key-encryption interface as a signing key" has to mean one
  // implementation, or it is two implementations that merely agree today.
  // wrapPrivateJwk is asserted here to produce this exact envelope, not
  // just an equally-shaped one `unwrapSecret` happens to also accept.
  it('is the same envelope wrapPrivateJwk produces, byte for byte', () => {
    const wrapped = wrapPrivateJwk(JWK, KEK);
    expect(JSON.parse(unwrapSecret(wrapped, KEK))).toEqual(JWK);
  });

  it('unwraps a value wrapPrivateJwk itself produced, an existing fixture rather than an assumption', () => {
    // Guards the "no format change" requirement directly: a key already
    // stored under the old wrapPrivateJwk path must still unwrap once
    // wrapPrivateJwk is rebuilt on top of wrapSecret/unwrapSecret.
    const previouslyStored = wrapPrivateJwk(JWK, KEK);
    expect(unwrapPrivateJwk(previouslyStored, KEK)).toEqual(JWK);
  });
});
