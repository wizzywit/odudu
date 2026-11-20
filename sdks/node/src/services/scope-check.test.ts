import { describe, expect, it } from 'vitest';
import { authorizationValues, readCredentials } from '#/services/authorization';
import { checkScope } from '#/services/configuration';
import { createVerifier } from '#/use-cases/create-verifier';
import { requireToken } from '#/adapter/express';
import { withToken } from '#/adapter/http';

describe('a required scope', () => {
  it('accepts one token and several', () => {
    expect(() => {
      checkScope('reports:read', 'scope');
      checkScope('a b:c', 'scope');
    }).not.toThrow();
  });

  for (const bad of ['', ' ', 'a  b', 'a"b', 'a\\b', 'a\r\nb', 'a\tb', ' a', 'a ', 'é']) {
    it(`refuses ${JSON.stringify(bad)} when the middleware or verifier is made`, () => {
      expect(() => {
        checkScope(bad, 'scope');
      }).toThrow(TypeError);
      const verifier = () => Promise.reject(new Error('unused'));
      expect(() => requireToken(verifier, { scope: bad })).toThrow(TypeError);
      expect(() => withToken(verifier, () => undefined, { scope: bad })).toThrow(TypeError);
      expect(() =>
        createVerifier({ issuers: ['https://id.example.test'], audience: 'a', requiredScope: bad }),
      ).toThrow(TypeError);
    });
  }
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
