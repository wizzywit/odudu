import { describe, expect, it } from 'vitest';
import { authorizationUrl } from '#/service/authorization-url';

describe('the address a person is sent to', () => {
  const url = new URL(
    authorizationUrl('https://id.example.com/tenants/acme/protocol/openid-connect/auth', {
      clientId: 'odudu-mcp',
      redirectUri: 'http://127.0.0.1:5555/',
      scope: 'mcp:read',
      state: 'st',
      challenge: 'ch',
      resource: 'urn:odudu:params:admin-api',
    }),
  );

  it('is the authorization endpoint with a code request for the built-in client', () => {
    expect(url.origin + url.pathname).toBe(
      'https://id.example.com/tenants/acme/protocol/openid-connect/auth',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'odudu-mcp',
      redirect_uri: 'http://127.0.0.1:5555/',
      scope: 'mcp:read',
      state: 'st',
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      resource: 'urn:odudu:params:admin-api',
    });
  });

  it('holds each parameter once', () => {
    for (const name of url.searchParams.keys())
      expect(url.searchParams.getAll(name)).toHaveLength(1);
  });
});
