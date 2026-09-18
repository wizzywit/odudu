import { describe, expect, it } from 'vitest';
import { parseClientMetadata } from '#/service/client-metadata';

const ok = (over: Record<string, unknown> = {}): unknown => ({
  redirect_uris: ['https://rp.example/cb'],
  grant_types: ['authorization_code'],
  token_endpoint_auth_method: 'client_secret_basic',
  client_name: 'Example RP',
  ...over,
});

it('accepts a minimal registration', () => {
  const outcome = parseClientMetadata(ok());
  expect(outcome.kind).toBe('ok');
});

it.each([
  ['http to a public host', 'http://rp.example/cb'],
  ['a fragment', 'https://rp.example/cb#x'],
  ['a relative URI', '/cb'],
])('refuses a redirect_uri with %s', (_name, uri) => {
  const outcome = parseClientMetadata(ok({ redirect_uris: [uri] }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_redirect_uri' });
});

it.each(['http://127.0.0.1:8080/cb', 'http://[::1]:8080/cb', 'com.example.app:/cb'])(
  'accepts %s',
  (uri) => {
    expect(parseClientMetadata(ok({ redirect_uris: [uri] })).kind).toBe('ok');
  },
);

it.each(['http://rp.example/jwks.json', 'https://user:pw@rp.example/j'])(
  'refuses the jwks_uri %s',
  (uri) => {
    const outcome = parseClientMetadata(ok({ jwks_uri: uri }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  },
);

it('accepts a well-formed jwks_uri without dereferencing it', () => {
  // No lookup, no socket: the host does not exist and registration succeeds.
  expect(parseClientMetadata(ok({ jwks_uri: 'https://nonexistent.invalid/jwks.json' })).kind).toBe(
    'ok',
  );
});

it('refuses a client that states its keys twice', () => {
  const outcome = parseClientMetadata(ok({ jwks: { keys: [] }, jwks_uri: 'https://rp.example/j' }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
});

it('refuses a client_id the client proposed for itself', () => {
  const outcome = parseClientMetadata(ok({ client_id: 'i-picked-this' }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
});

it('refuses a grant type this server does not implement', () => {
  const outcome = parseClientMetadata(ok({ grant_types: ['implicit'] }));
  expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
});

// `client_credentials` alone has no interactive flow, which is the one case
// the existing CHECK on client_oidc_config permits with no redirect_uri.
it('accepts client_credentials alone with no redirect_uris', () => {
  expect(
    parseClientMetadata({
      grant_types: ['client_credentials'],
      token_endpoint_auth_method: 'client_secret_basic',
    }).kind,
  ).toBe('ok');
});

describe('[OIDC-BACKCHANNEL-2.2-03] the back-channel logout URI scheme policy', () => {
  it('refuses a back-channel logout URI that is not https', () => {
    const outcome = parseClientMetadata(ok({ backchannel_logout_uri: 'http://rp.example/bc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-BACKCHANNEL-2.2-01] the back-channel logout URI is absolute', () => {
  it('refuses a relative back-channel logout URI', () => {
    const outcome = parseClientMetadata(ok({ backchannel_logout_uri: '/bc' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

describe('[OIDC-BACKCHANNEL-2.2-02] the back-channel logout URI carries no fragment', () => {
  it('refuses a back-channel logout URI with a fragment', () => {
    const outcome = parseClientMetadata(ok({ backchannel_logout_uri: 'https://rp.example/bc#x' }));
    expect(outcome).toMatchObject({ kind: 'invalid', error: 'invalid_client_metadata' });
  });
});

it('accepts a well-formed back-channel logout URI', () => {
  const outcome = parseClientMetadata(ok({ backchannel_logout_uri: 'https://rp.example/bc' }));
  expect(outcome.kind).toBe('ok');
});
