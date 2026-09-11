import { describe, expect, it } from 'vitest';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

describe('[RFC6749-4.1.2-03] the authorization code is opaque and stored hashed', () => {
  it('returns a high-entropy code', () => {
    const code = generateAuthorizationCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{43,}$/);
  });

  it('returns a different code every time', () => {
    expect(generateAuthorizationCode()).not.toEqual(generateAuthorizationCode());
  });

  it('hashes the code so the stored value cannot be replayed', () => {
    const code = generateAuthorizationCode();
    const hash = hashAuthorizationCode(code);
    expect(hash).not.toContain(code);
    expect(hashAuthorizationCode(code)).toEqual(hash);
  });
});
