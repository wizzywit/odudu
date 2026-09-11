import { type ClientRecord } from '@odudu/domain-realm';
import { describe, expect, it } from 'vitest';
import { validateAuthorizationRequest } from '#/service/authorize-validation';
import { type ClientOidcConfig } from '#/schema/client-oidc-config';

function omit<T extends Record<string, unknown>, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const entries = Object.entries(obj).filter(([k]) => k !== key);
  return Object.fromEntries(entries) as Omit<T, K>;
}

const client: ClientRecord = {
  id: 'a2f0b7a2-6e8e-4c9a-9b6f-1d1f9a6a9f01',
  realmId: 'e1c1c1c1-6e8e-4c9a-9b6f-1d1f9a6a9f02',
  clientId: 'oauth-client-1',
  name: 'A confidential client',
  enabled: true,
  type: 'confidential',
  secretHash: 'hashed:secret',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const config: ClientOidcConfig = {
  clientId: client.id,
  realmId: client.realmId,
  redirectUris: ['https://app.example/callback'],
  grantTypes: ['authorization_code', 'refresh_token'],
  tokenEndpointAuthMethod: 'client_secret_basic',
  audiences: [],
  accessTokenTtlSeconds: 300,
  refreshTokenTtlSeconds: 1_209_600,
};

const params: Record<string, string | undefined> = {
  response_type: 'code',
  client_id: 'oauth-client-1',
  redirect_uri: 'https://app.example/callback',
  scope: 'openid',
  state: 'xyz-state',
  code_challenge: 'a'.repeat(43),
  code_challenge_method: 'S256',
};

describe('[RFC6749-4.1.2.1-01] failures before redirect_uri is trusted must not redirect', () => {
  it.each([
    ['unknown client', { ...params, client_id: 'nope' }, null],
    ['disabled client', params, { ...client, enabled: false }],
    ['missing redirect_uri', omit(params, 'redirect_uri'), client],
    ['unregistered redirect_uri', { ...params, redirect_uri: 'https://evil.example/cb' }, client],
    ['trailing slash added', { ...params, redirect_uri: 'https://app.example/callback/' }, client],
    ['path case changed', { ...params, redirect_uri: 'https://app.example/Callback' }, client],
    [
      'extra query parameter',
      { ...params, redirect_uri: 'https://app.example/callback?x=1' },
      client,
    ],
  ])('renders rather than redirects: %s', (_label, p, c) => {
    expect(validateAuthorizationRequest(p, c, config).kind).toBe('render');
  });

  it('renders for an enabled, known client whose OIDC config row is missing', () => {
    expect(validateAuthorizationRequest(params, client, null)).toMatchObject({
      kind: 'render',
      error: 'invalid_client',
    });
  });
});

describe('a repeated non-trust query parameter redirects with invalid_request', () => {
  it('redirects rather than proceeding to any other check', () => {
    expect(validateAuthorizationRequest(params, client, config, 'state')).toMatchObject({
      kind: 'redirect',
      redirectUri: params.redirect_uri,
      error: 'invalid_request',
      state: params.state,
    });
  });

  it('takes priority over an otherwise-valid request', () => {
    const outcome = validateAuthorizationRequest(params, client, config, 'scope');
    expect(outcome).not.toMatchObject({ kind: 'ok' });
  });
});

describe('[RFC6749-4.1.2.1-02] failures after redirect_uri is trusted redirect with state', () => {
  it.each([
    ['bad response_type', { ...params, response_type: 'token' }, 'unsupported_response_type'],
    ['missing code_challenge', omit(params, 'code_challenge'), 'invalid_request'],
    ['plain challenge method', { ...params, code_challenge_method: 'plain' }, 'invalid_request'],
    ['missing challenge method', omit(params, 'code_challenge_method'), 'invalid_request'],
    ['unknown scope', { ...params, scope: 'openid wat' }, 'invalid_scope'],
  ])('redirects with %s', (_label, p, expected) => {
    expect(validateAuthorizationRequest(p, client, config)).toMatchObject({
      kind: 'redirect',
      error: expected,
      state: params.state,
    });
  });
});

describe('validateAuthorizationRequest — the success path', () => {
  it('parks the whole request, including a null state and nonce, when everything checks out', () => {
    const outcome = validateAuthorizationRequest(omit(params, 'state'), client, config);
    expect(outcome).toEqual({
      kind: 'ok',
      request: {
        clientId: client.clientId,
        redirectUri: params.redirect_uri,
        scope: 'openid',
        state: null,
        nonce: null,
        codeChallenge: params.code_challenge,
        codeChallengeMethod: 'S256',
      },
    });
  });
});
