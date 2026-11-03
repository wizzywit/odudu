import { describe, expect, it } from 'vitest';
import {
  keysProblem,
  jwksText,
  keySourceOf,
  keysPayload,
  parseJwks,
} from '#/features/clients/services/clientKeys';

describe('key sources', () => {
  it('reads which the client holds, a key set before an address', () => {
    expect(keySourceOf({ jwks: { keys: [] }, jwks_uri: null })).toBe('inline');
    expect(keySourceOf({ jwks: null, jwks_uri: 'https://a.example/jwks' })).toBe('uri');
    expect(keySourceOf({ jwks: null, jwks_uri: null })).toBe('none');
  });

  it('shows a stored key set as text, and none as nothing', () => {
    expect(jwksText(null)).toBe('');
    const shown: unknown = JSON.parse(jwksText({ keys: [{ kty: 'RSA' }] }));
    expect(shown).toEqual({ keys: [{ kty: 'RSA' }] });
  });

  it('judges only the shape of pasted text, and leaves the members to the server', () => {
    expect(parseJwks('')).toMatchObject({ ok: false });
    expect(parseJwks('{')).toEqual({ ok: false, problem: 'This is not valid JSON.' });
    expect(parseJwks('[]')).toMatchObject({
      ok: false,
      problem: 'A key set is a JSON object with a "keys" array.',
    });
    expect(parseJwks('{"keys":[{"kty":"RSA","d":"x"}]}')).toEqual({
      ok: true,
      value: { keys: [{ kty: 'RSA', d: 'x' }] },
    });
  });

  it('holds back a save only while the chosen source has nothing to save', () => {
    const uri = 'https://a.example/jwks';
    expect(keysProblem({ key_source: 'uri', jwks_uri: ' ', jwks: '' }, true)).toMatchObject({
      field: 'jwks_uri',
    });
    expect(keysProblem({ key_source: 'uri', jwks_uri: uri, jwks: '{' }, true)).toBeUndefined();
    expect(keysProblem({ key_source: 'inline', jwks_uri: '', jwks: '{' }, true)).toEqual({
      field: 'jwks',
      message: 'This is not valid JSON.',
    });
    expect(
      keysProblem({ key_source: 'inline', jwks_uri: '', jwks: '{"keys":[]}' }, true),
    ).toBeUndefined();
    expect(keysProblem({ key_source: 'none', jwks_uri: '', jwks: '{' }, true)).toBeUndefined();
    expect(keysProblem({ key_source: 'inline', jwks_uri: '', jwks: '{' }, false)).toBeUndefined();
  });

  it('sends one source and clears the other, which the server holds exclusive', () => {
    const text = '{"keys":[]}';
    expect(
      keysPayload({ key_source: 'inline', jwks_uri: 'https://a.example', jwks: text }),
    ).toEqual({
      jwks: { keys: [] },
      jwks_uri: null,
    });
    expect(keysPayload({ key_source: 'uri', jwks_uri: ' https://a.example ', jwks: text })).toEqual(
      {
        jwks: null,
        jwks_uri: 'https://a.example',
      },
    );
    expect(keysPayload({ key_source: 'none', jwks_uri: 'x', jwks: text })).toEqual({
      jwks: null,
      jwks_uri: null,
    });
  });
});
