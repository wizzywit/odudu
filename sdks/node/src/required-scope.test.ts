import { describe, expect, it } from 'vitest';
import { checkScope } from '#/services/configuration';
import { createVerifier } from '#/use-cases/create-verifier';
import { requireToken } from '#/adapter/express';
import { withToken } from '#/adapter/http';

describe('a required scope', () => {
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
