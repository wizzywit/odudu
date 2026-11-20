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

  it('[MCP-AUTH-RES-01] is the authorization endpoint with a code request for the built-in client', () => {
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

  it('keeps a query the endpoint carries of its own (RFC 6749 section 3.1)', () => {
    const kept = new URL(
      authorizationUrl('https://id.example.com/auth?tenant=acme&ui_locales=de', {
        clientId: 'odudu-mcp',
        redirectUri: 'http://127.0.0.1:5555/',
        scope: 'mcp:read',
        state: 'st',
        challenge: 'ch',
        resource: 'urn:odudu:params:admin-api',
      }),
    );
    expect(kept.searchParams.get('tenant')).toBe('acme');
    expect(kept.searchParams.get('ui_locales')).toBe('de');
    expect(kept.searchParams.get('client_id')).toBe('odudu-mcp');
  });

  it.each([
    'client_id',
    'redirect_uri',
    'state',
    'code_challenge',
    'resource',
    'scope',
    'response_type',
  ])('refuses an endpoint whose own query carries %s, rather than drop either value', (name) => {
    expect(() =>
      authorizationUrl(`https://id.example.com/auth?${name}=x`, {
        clientId: 'odudu-mcp',
        redirectUri: 'http://127.0.0.1:5555/',
        scope: 'mcp:read',
        state: 'st',
        challenge: 'ch',
        resource: 'urn:odudu:params:admin-api',
      }),
    ).toThrow(
      expect.objectContaining({ name: 'StdioError', code: 'mcp_discovery_invalid' }) as Error,
    );
  });
});
