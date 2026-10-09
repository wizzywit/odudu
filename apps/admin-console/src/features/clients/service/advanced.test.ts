import { describe, expect, it } from 'vitest';
import { AUTO } from '#/features/clients/service/choices.ts';
import {
  authOptions,
  authPayload,
  keysProblem,
  jwksText,
  keySourceOf,
  keysPayload,
  needsSubjectDn,
  parseJwks,
  secretFixedNote,
  userinfoContentOptions,
  userinfoEncryptionOptions,
  userinfoPayload,
  userinfoSigningOptions,
} from '#/features/clients/service/advanced.ts';

describe('authOptions', () => {
  it('offers a confidential client every method but none', () => {
    expect(authOptions({ type: 'confidential' }).map((each) => each.id)).toEqual([
      'client_secret_basic',
      'client_secret_post',
      'private_key_jwt',
      'tls_client_auth',
    ]);
  });

  it('offers a public client none alone, since the type cannot change', () => {
    expect(authOptions({ type: 'public' }).map((each) => each.id)).toEqual(['none']);
  });
});

describe('authPayload', () => {
  it('keeps the subject only for the method that reads it', () => {
    expect(
      authPayload({
        token_endpoint_auth_method: 'tls_client_auth',
        tls_client_auth_subject_dn: ' CN=a ',
      }),
    ).toEqual({
      token_endpoint_auth_method: 'tls_client_auth',
      tls_client_auth_subject_dn: 'CN=a',
    });
    expect(
      authPayload({
        token_endpoint_auth_method: 'client_secret_post',
        tls_client_auth_subject_dn: 'CN=a',
      }),
    ).toEqual({ token_endpoint_auth_method: 'client_secret_post', tls_client_auth_subject_dn: '' });
    expect(needsSubjectDn('tls_client_auth')).toBe(true);
    expect(needsSubjectDn('private_key_jwt')).toBe(false);
  });
});

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

describe('userinfo', () => {
  it('offers the algorithms the server signs and encrypts with', () => {
    expect(userinfoSigningOptions().map((each) => each.id)).toEqual([
      AUTO,
      'RS256',
      'ES256',
      'none',
    ]);
    expect(userinfoEncryptionOptions().map((each) => each.id)).toEqual([
      AUTO,
      'RSA-OAEP-256',
      'ECDH-ES',
      'ECDH-ES+A128KW',
      'ECDH-ES+A192KW',
      'ECDH-ES+A256KW',
    ]);
    expect(userinfoContentOptions()[0]?.label).toBe('Default (A128CBC-HS256)');
  });

  it('drops the content encryption with the algorithm it goes with', () => {
    expect(
      userinfoPayload({
        userinfo_signed_response_alg: 'RS256',
        userinfo_encrypted_response_alg: AUTO,
        userinfo_encrypted_response_enc: 'A256GCM',
      }),
    ).toEqual({
      userinfo_signed_response_alg: 'RS256',
      userinfo_encrypted_response_alg: null,
      userinfo_encrypted_response_enc: null,
    });
    expect(
      userinfoPayload({
        userinfo_signed_response_alg: AUTO,
        userinfo_encrypted_response_alg: 'ECDH-ES',
        userinfo_encrypted_response_enc: 'A256GCM',
      }),
    ).toEqual({
      userinfo_signed_response_alg: null,
      userinfo_encrypted_response_alg: 'ECDH-ES',
      userinfo_encrypted_response_enc: 'A256GCM',
    });
  });
});

describe('secretFixedNote', () => {
  it('names a public client as having no secret', () => {
    expect(secretFixedNote({ type: 'public', token_endpoint_auth_method: 'none' })).toBe(
      'A public client has no secret to rotate.',
    );
  });

  it.each(['private_key_jwt', 'tls_client_auth'])('names a %s client as having none', (method) => {
    expect(secretFixedNote({ type: 'confidential', token_endpoint_auth_method: method })).toBe(
      `A client that authenticates with ${method} has no secret to rotate.`,
    );
  });

  it.each(['client_secret_basic', 'client_secret_post'])(
    'says nothing of a %s client',
    (method) => {
      expect(
        secretFixedNote({ type: 'confidential', token_endpoint_auth_method: method }),
      ).toBeNull();
    },
  );
});
