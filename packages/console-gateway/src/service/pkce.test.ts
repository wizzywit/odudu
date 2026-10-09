import { describe, expect, it } from 'vitest';
import { codeChallenge, codeVerifier } from '#/service/pkce';

describe('PKCE', () => {
  it('derives the S256 challenge of RFC 7636 Appendix B', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('draws a fresh 43-character unreserved verifier each time', () => {
    const first = codeVerifier();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(codeVerifier()).not.toBe(first);
  });
});
