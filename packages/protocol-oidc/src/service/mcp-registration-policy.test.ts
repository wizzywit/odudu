import { describe, expect, it } from 'vitest';
import {
  audiencesUnderPolicy,
  decideMcpRegistration,
  type McpRegistrationInput,
} from '#/service/mcp-registration-policy';

const MCP = 'https://idp.example/tenants/acme/mcp';

function input(over: Partial<McpRegistrationInput> = {}): McpRegistrationInput {
  return {
    redirectUris: ['https://rp.example/cb', 'http://127.0.0.1:8123/cb'],
    grantTypes: ['authorization_code', 'refresh_token'],
    tokenEndpointAuthMethod: 'none',
    scope: undefined,
    audience: undefined,
    mcpAudience: MCP,
    ...over,
  };
}

function refusal(over: Partial<McpRegistrationInput>) {
  const decision = decideMcpRegistration(input(over));
  if (decision.kind !== 'invalid') throw new Error('expected a refusal');
  return decision;
}

describe('decideMcpRegistration', () => {
  it('admits a public client with https and loopback redirects, bound to the MCP URL', () => {
    expect(decideMcpRegistration(input())).toEqual({ kind: 'ok', audiences: [MCP] });
  });

  it.each(['client_secret_basic', 'client_secret_post', 'private_key_jwt', 'tls_client_auth'])(
    'refuses %s: a confidential client',
    (method) => {
      const decision = refusal({ tokenEndpointAuthMethod: method });
      expect(decision.error).toBe('invalid_client_metadata');
      expect(decision.description).toContain('token_endpoint_auth_method');
    },
  );

  it.each([
    'http://rp.example/cb',
    'http://localhost.evil.example/cb',
    'com.example.app:/cb',
    'ftp://rp.example/cb',
  ])('refuses the redirect URI %s', (uri) => {
    const decision = refusal({ redirectUris: ['https://rp.example/cb', uri] });
    expect(decision.error).toBe('invalid_redirect_uri');
  });

  it.each(['http://localhost:9/cb', 'http://[::1]:9/cb', 'http://127.0.0.1/cb'])(
    'admits the loopback redirect %s',
    (uri) => {
      expect(decideMcpRegistration(input({ redirectUris: [uri] })).kind).toBe('ok');
    },
  );

  it('refuses a grant that needs a secret', () => {
    expect(refusal({ grantTypes: ['client_credentials'] }).error).toBe('invalid_client_metadata');
  });

  it('admits mcp:read and the sign-in scopes, nothing past them', () => {
    expect(decideMcpRegistration(input({ scope: 'openid mcp:read offline_access' })).kind).toBe(
      'ok',
    );
    expect(refusal({ scope: 'mcp:read mcp:write' }).description).toContain('mcp:write');
    expect(refusal({ scope: 'mcp:admin' }).description).toContain('mcp:admin');
    expect(refusal({ scope: 7 }).description).toContain('scope');
  });

  it('admits only the tenant MCP URL as an audience', () => {
    expect(decideMcpRegistration(input({ audience: MCP })).kind).toBe('ok');
    expect(decideMcpRegistration(input({ audience: [MCP] })).kind).toBe('ok');
    for (const audience of [
      'https://api.example',
      [MCP, 'https://api.example'],
      `${MCP}/`,
      'urn:odudu:params:admin-api',
      [],
      42,
    ]) {
      expect(refusal({ audience }).description).toContain('audience');
    }
  });
});

describe('audiencesUnderPolicy', () => {
  it('replaces the list with the MCP URL under the mcp policy', () => {
    expect(audiencesUnderPolicy(['https://api.example'], MCP, true)).toEqual([MCP]);
    expect(audiencesUnderPolicy([], MCP, true)).toEqual([MCP]);
  });

  it('takes only the MCP URL out under any other policy', () => {
    expect(audiencesUnderPolicy([MCP, 'https://api.example'], MCP, false)).toEqual([
      'https://api.example',
    ]);
    expect(audiencesUnderPolicy([], MCP, false)).toEqual([]);
  });
});
