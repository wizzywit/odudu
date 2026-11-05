import { describe, expect, it } from 'vitest';
import {
  cimdConsentHost,
  isCimdClientId,
  isCimdRedirectUri,
  parseCimdDocument,
} from '#/service/client-id-metadata';

const ID = 'https://app.example/oauth/client.json';
const minimal = {
  client_id: ID,
  client_name: 'Example',
  redirect_uris: ['https://app.example/cb'],
};

function refusal(body: unknown): string | null {
  const out = parseCimdDocument(ID, body);
  return out.kind === 'invalid' ? out.reason : null;
}

describe('isCimdClientId', () => {
  it.each([ID, 'https://app.example:8443/a', 'https://app.example/a?x=1'])('accepts %s', (v) => {
    expect(isCimdClientId(v)).toBe(true);
  });

  it.each([
    'https://app.example',
    'https://app.example/',
    'http://app.example/a',
    'https://app.example/a#f',
    'https://app.example/a#',
    'https://user@app.example/a',
    'https://u:p@app.example/a',
    'https://app.example/a/../b',
    'https://app.example/./b',
    'not a url',
    'client-123',
    '',
  ])('refuses %s', (v) => {
    expect(isCimdClientId(v)).toBe(false);
  });
});

describe('parseCimdDocument', () => {
  it('accepts a minimal document', () => {
    const out = parseCimdDocument(ID, minimal);
    expect(out.kind).toBe('ok');
    expect(out.kind === 'ok' && out.client).toMatchObject({
      clientId: ID,
      clientName: 'Example',
      redirectUris: ['https://app.example/cb'],
      tokenEndpointAuthMethod: 'none',
      loopback: false,
    });
  });

  it('refuses a body that is not an object', () => {
    expect(refusal([])).toBe('not_an_object');
    expect(refusal(null)).toBe('not_an_object');
    expect(refusal('x')).toBe('not_an_object');
  });

  it('refuses a client_id that differs from the URL, even by a slash', () => {
    expect(refusal({ ...minimal, client_id: `${ID}/` })).toBe('client_id_mismatch');
    expect(refusal({ ...minimal, client_id: undefined })).toBe('client_id_mismatch');
  });

  it('refuses a missing or blank client_name', () => {
    expect(refusal({ ...minimal, client_name: undefined })).toBe('client_name_missing');
    expect(refusal({ ...minimal, client_name: '  ' })).toBe('client_name_missing');
  });

  it('refuses missing, empty and malformed redirect_uris', () => {
    expect(refusal({ ...minimal, redirect_uris: undefined })).toBe('redirect_uris_invalid');
    expect(refusal({ ...minimal, redirect_uris: [] })).toBe('redirect_uris_invalid');
    expect(refusal({ ...minimal, redirect_uris: [1] })).toBe('redirect_uris_invalid');
  });

  it.each([
    'http://app.example/cb',
    'com.example.app:/cb',
    'javascript:alert(1)',
    'https://app.example/cb#x',
    'http://evil.localhost.example/cb',
    'nope',
  ])('refuses the redirect URI %s', (uri) => {
    expect(refusal({ ...minimal, redirect_uris: [uri] })).toBe('redirect_uri_refused');
  });

  it.each(['http://localhost/cb', 'http://127.0.0.1/cb', 'http://127.0.0.1:7777/cb'])(
    'accepts the loopback redirect %s and flags it',
    (uri) => {
      const out = parseCimdDocument(ID, { ...minimal, redirect_uris: [uri] });
      expect(out.kind === 'ok' && out.client.loopback).toBe(true);
    },
  );

  it('refuses any client_secret member', () => {
    expect(refusal({ ...minimal, client_secret: 's' })).toBe('client_secret_present');
    expect(refusal({ ...minimal, client_secret_expires_at: 0 })).toBe('client_secret_present');
  });

  it.each(['client_secret_basic', 'client_secret_post', 'client_secret_jwt'])(
    'refuses the symmetric method %s',
    (m) => {
      expect(refusal({ ...minimal, token_endpoint_auth_method: m })).toBe('auth_method_refused');
    },
  );

  it('refuses a method it does not know, accepts none and private_key_jwt', () => {
    expect(refusal({ ...minimal, token_endpoint_auth_method: 'tls_client_auth' })).toBe(
      'auth_method_refused',
    );
    expect(refusal({ ...minimal, token_endpoint_auth_method: 'none' })).toBeNull();
    expect(
      refusal({
        ...minimal,
        token_endpoint_auth_method: 'private_key_jwt',
        jwks: { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b' }] },
      }),
    ).toBeNull();
  });

  it('refuses a jwks carrying a private member, and a malformed jwks', () => {
    expect(
      refusal({
        ...minimal,
        jwks: { keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'b', d: 'z' }] },
      }),
    ).toBe('jwks_private');
    expect(refusal({ ...minimal, jwks: { keys: [{ kty: 'oct', k: 'z' }] } })).toBe('jwks_private');
    expect(refusal({ ...minimal, jwks: 'x' })).toBe('jwks_invalid');
  });

  it('refuses jwks together with jwks_uri', () => {
    expect(refusal({ ...minimal, jwks: { keys: [] }, jwks_uri: 'https://app.example/jwks' })).toBe(
      'jwks_invalid',
    );
  });
});

describe('isCimdRedirectUri', () => {
  const registered = ['http://localhost/cb', 'https://app.example/cb'];

  it('matches a loopback entry at any port with the same path', () => {
    expect(isCimdRedirectUri('http://localhost:54321/cb', registered)).toBe(true);
    expect(isCimdRedirectUri('http://localhost/cb', registered)).toBe(true);
  });

  it('refuses another path, query, host or scheme on a loopback entry', () => {
    expect(isCimdRedirectUri('http://localhost:54321/other', registered)).toBe(false);
    expect(isCimdRedirectUri('http://localhost:54321/cb?x=1', registered)).toBe(false);
    expect(isCimdRedirectUri('http://127.0.0.1:54321/cb', registered)).toBe(false);
    expect(isCimdRedirectUri('https://localhost:54321/cb', registered)).toBe(false);
  });

  it('matches 127.0.0.1 entries the same way', () => {
    expect(isCimdRedirectUri('http://127.0.0.1:9/cb', ['http://127.0.0.1/cb'])).toBe(true);
  });

  it('keeps an https entry exact', () => {
    expect(isCimdRedirectUri('https://app.example/cb', registered)).toBe(true);
    expect(isCimdRedirectUri('https://app.example:444/cb', registered)).toBe(false);
    expect(isCimdRedirectUri('https://app.example/cb/', registered)).toBe(false);
  });

  it('matches a loopback entry that names a port only exactly', () => {
    const pinned = ['http://localhost:7777/cb'];
    expect(isCimdRedirectUri('http://localhost:7777/cb', pinned)).toBe(true);
    expect(isCimdRedirectUri('http://localhost:7778/cb', pinned)).toBe(false);
  });
});

describe('cimdConsentHost', () => {
  it('names the host of the client_id URL, with its port', () => {
    expect(cimdConsentHost(ID)).toBe('app.example');
    expect(cimdConsentHost('https://app.example:8443/a')).toBe('app.example:8443');
  });
});
