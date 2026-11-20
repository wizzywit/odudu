import { describe, expect, it } from 'vitest';
import { authorizationValues, readCredentials } from '#/services/authorization';
import { checkScope } from '#/services/configuration';

describe('a required scope', () => {
  it('accepts one token and several', () => {
    expect(() => {
      checkScope('reports:read', 'scope');
      checkScope('a b:c', 'scope');
    }).not.toThrow();
  });
});

describe('reading the Authorization header', () => {
  const read = (value: string) => readCredentials(authorizationValues(undefined, value));

  it('takes the scheme in any case', () => {
    expect(read('bearer token')).toEqual({ kind: 'token', token: 'token' });
  });
  it('treats a tab as another scheme, so the challenge is bare', () => {
    expect(read('Bearer\ttoken')).toEqual({ kind: 'none' });
  });
  it('refuses a missing, empty or doubly spaced token', () => {
    for (const value of ['Bearer', 'Bearer ', 'Bearer  token']) {
      expect(read(value)).toEqual({ kind: 'malformed' });
    }
  });
});
