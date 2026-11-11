import { describe, expect, it } from 'vitest';
import { unverifiedIssuer } from '#/service/unverified-issuer';

const part = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

describe('unverifiedIssuer', () => {
  it('reads the issuer a JWT names', () => {
    expect(unverifiedIssuer(`${part({})}.${part({ iss: 'https://a.test/t' })}.sig`)).toBe(
      'https://a.test/t',
    );
  });

  it.each([
    ['too few segments', 'a.b'],
    ['an empty payload', 'a..c'],
    ['a payload that is not JSON', 'a.!!!.c'],
    ['a payload that is not an object', `a.${part('x')}.c`],
    ['no iss', `a.${part({})}.c`],
    ['an empty iss', `a.${part({ iss: '' })}.c`],
    ['a non-string iss', `a.${part({ iss: 5 })}.c`],
  ])('is undefined for %s', (_l, token) => {
    expect(unverifiedIssuer(token)).toBeUndefined();
  });
});
