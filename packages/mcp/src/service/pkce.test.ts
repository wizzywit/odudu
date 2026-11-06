import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { pkceFor } from '#/service/pkce';

describe('PKCE with S256', () => {
  it('makes a verifier of 43 unreserved characters from 32 bytes of entropy', () => {
    const { verifier } = pkceFor(randomBytes(32));
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/u);
  });

  it('challenges with the unpadded base64url SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkceFor(Buffer.alloc(32, 9));
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(challenge).not.toContain('=');
  });

  it('refuses entropy under 32 bytes', () => {
    expect(() => pkceFor(randomBytes(31))).toThrow(/32/u);
  });

  it('gives two draws two verifiers', () => {
    expect(pkceFor(randomBytes(32)).verifier).not.toBe(pkceFor(randomBytes(32)).verifier);
  });
});
