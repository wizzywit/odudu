import { describe, expect, it } from 'vitest';
import { verifyPkce } from '#/service/pkce';

// RFC 7636 Appendix B worked example — checked against the specification's
// own vector, not against this implementation.
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

describe('[RFC7636-4.6-01] PKCE verification', () => {
  it("accepts the RFC's own worked example", () => {
    expect(verifyPkce(VERIFIER, CHALLENGE, 'S256')).toBe(true);
  });
});

describe('[RFC7636-4.6-02] PKCE rejects a mismatched verifier', () => {
  it('rejects a wrong verifier', () => {
    expect(verifyPkce('a'.repeat(43), CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects the challenge presented as the verifier', () => {
    expect(verifyPkce(CHALLENGE, CHALLENGE, 'S256')).toBe(false);
  });
});

describe('[RFC7636-4.1-01] code_verifier length and character set', () => {
  it('rejects a verifier shorter than 43 characters', () => {
    expect(verifyPkce('short', CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects a verifier longer than 128 characters', () => {
    expect(verifyPkce('a'.repeat(129), CHALLENGE, 'S256')).toBe(false);
  });

  it('rejects an empty verifier', () => {
    expect(verifyPkce('', CHALLENGE, 'S256')).toBe(false);
  });
});
