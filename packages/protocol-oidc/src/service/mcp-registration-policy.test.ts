import { describe, expect, it } from 'vitest';
import {
  audiencesHeld,
  audiencesUnderPolicy,
  decideMcpRegistration,
  grantForClient,
  refreshUnderPolicy,
  grantableScopes,
  refusesWriteScope,
  requestWithGrantableScope,
  scopeHeldOf,
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
    holdsKeys: false,
    hasLogoutUri: false,
    ...over,
  };
}

function refusal(over: Partial<McpRegistrationInput>) {
  const decision = decideMcpRegistration(input(over));
  if (decision.kind !== 'invalid') throw new Error('expected a refusal');
  return decision;
}

describe('decideMcpRegistration', () => {
  it('[MCP-AUTH-REG-01] admits a public client with https and loopback redirects, bound to the MCP URL', () => {
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

  it('registers the scopes it may hold and says which, dropping the rest', () => {
    expect(decideMcpRegistration(input({ scope: 'openid mcp:read offline_access' }))).toEqual({
      kind: 'ok',
      audiences: [MCP],
      scope: 'openid mcp:read offline_access',
    });
    expect(decideMcpRegistration(input({ scope: 'mcp:read mcp:write offline_access' }))).toEqual({
      kind: 'ok',
      audiences: [MCP],
      scope: 'mcp:read offline_access',
    });
    expect(decideMcpRegistration(input({ scope: 'mcp:read mcp:admin mcp:read' }))).toMatchObject({
      kind: 'ok',
      scope: 'mcp:read',
    });
    expect(decideMcpRegistration(input({ scope: 'openid\u00a0mcp:write' }))).toMatchObject({
      kind: 'ok',
      scope: 'openid',
    });
  });

  it('refuses a scope when nothing the client may hold is left in it', () => {
    expect(refusal({ scope: 'mcp:write' }).description).toContain('mcp:write');
    expect(refusal({ scope: 'mcp:admin' }).description).toContain('mcp:admin');
    expect(refusal({ scope: 7 }).description).toContain('scope');
  });

  it('refuses a public client with keys or logout addresses', () => {
    expect(refusal({ holdsKeys: true }).description).toContain('jwks');
    expect(refusal({ hasLogoutUri: true }).description).toContain('logout');
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
      [MCP, MCP],
      42,
    ]) {
      expect(refusal({ audience }).description).toContain('audience');
    }
  });
});

describe('the "me" scopes under the registration policy', () => {
  it('are not registrable: the policy admits no scope outside its own list', () => {
    expect(refusal({ scope: 'me:read' }).description).toContain('me:read');
    expect(refusal({ scope: 'me:read me:write' }).error).toBe('invalid_client_metadata');
    expect(decideMcpRegistration(input({ scope: 'openid me:write mcp:read' }))).toMatchObject({
      kind: 'ok',
      scope: 'openid mcp:read',
    });
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

describe('policy applied to a dynamic client', () => {
  const ADMIN = 'urn:odudu:params:admin-api';

  it('holds the MCP audience only while the policy is mcp', () => {
    expect(audiencesHeld('anonymous', 'mcp', [MCP], MCP)).toEqual([MCP]);
    expect(audiencesHeld('anonymous', 'open', [MCP, ADMIN], MCP)).toEqual([ADMIN]);
    expect(audiencesHeld('cimd', 'disabled', [MCP], MCP)).toEqual([]);
  });

  it('leaves a client an administrator made as it is', () => {
    expect(audiencesHeld('seeded', 'disabled', [MCP], MCP)).toEqual([MCP]);
    expect(audiencesHeld('operator', 'open', [MCP], MCP)).toEqual([MCP]);
  });

  it('takes the MCP audience and mcp:read off a refresh once the policy is gone', () => {
    const base = {
      registrationOrigin: 'anonymous',
      mcpAudience: MCP,
      scope: ['openid', 'mcp:read'],
      audience: [MCP],
    };
    expect(refreshUnderPolicy({ ...base, policy: 'mcp' })).toEqual({
      scope: ['openid', 'mcp:read'],
      audience: [MCP],
    });
    expect(refreshUnderPolicy({ ...base, policy: 'open' })).toEqual({
      scope: ['openid'],
      audience: [],
    });
    expect(refreshUnderPolicy({ ...base, registrationOrigin: 'seeded', policy: 'open' })).toEqual({
      scope: ['openid', 'mcp:read'],
      audience: [MCP],
    });
  });

  it('refuses mcp:write for a dynamic client only', () => {
    expect(refusesWriteScope('anonymous', ['openid', 'mcp:write'])).toBe(true);
    expect(refusesWriteScope('cimd', ['mcp:write'])).toBe(true);
    expect(refusesWriteScope('seeded', ['mcp:write'])).toBe(false);
    expect(refusesWriteScope('anonymous', ['mcp:read'])).toBe(false);
  });

  it('asks a dynamic client about the request without mcp:write, unless nothing else is left', () => {
    expect(grantableScopes('anonymous', ['openid', 'mcp:read', 'mcp:write'])).toEqual([
      'openid',
      'mcp:read',
    ]);
    expect(grantableScopes('cimd', ['mcp:write', 'mcp:read'])).toEqual(['mcp:read']);
    expect(grantableScopes('anonymous', ['mcp:write'])).toEqual(['mcp:write']);
    expect(grantableScopes('seeded', ['mcp:read', 'mcp:write'])).toEqual(['mcp:read', 'mcp:write']);
  });

  it('rewrites the scope of a request only when something was dropped', () => {
    const asked = { scope: 'openid mcp:read mcp:write', state: 's' };
    expect(requestWithGrantableScope('cimd', asked)).toEqual({
      scope: 'openid mcp:read',
      state: 's',
    });
    expect(requestWithGrantableScope('seeded', asked)).toBe(asked);
    expect(requestWithGrantableScope('cimd', { scope: undefined })).toEqual({ scope: undefined });
    const writeOnly = { scope: 'mcp:write' };
    expect(requestWithGrantableScope('anonymous', writeOnly)).toBe(writeOnly);
  });

  it('keeps a confidential client out of the policy', () => {
    const grant = { audience: MCP, granted: true };
    expect(grantForClient(grant, true)).toEqual(grant);
    expect(grantForClient(grant, false)).toEqual({ audience: MCP, granted: false });
  });
});

describe('policy applied after the tenant has moved address', () => {
  const OLD = 'https://idp.example/tenants/acme/mcp';
  const NOW = 'https://login.acme.com/mcp';
  const ADMIN = 'urn:odudu:params:admin-api';

  it('replaces a stored MCP URL with the current one while the policy is mcp', () => {
    expect(audiencesHeld('anonymous', 'mcp', [OLD], NOW)).toEqual([NOW]);
    expect(audiencesHeld('cimd', 'mcp', [OLD, ADMIN], NOW)).toEqual([ADMIN, NOW]);
  });

  it('gives nothing to a client that held no MCP URL', () => {
    expect(audiencesHeld('anonymous', 'mcp', [], NOW)).toEqual([]);
  });

  it('takes every MCP URL the tenant ever had out once the policy is gone', () => {
    expect(audiencesHeld('anonymous', 'open', [OLD, NOW, ADMIN], NOW)).toEqual([ADMIN]);
    expect(audiencesUnderPolicy([OLD, ADMIN], NOW, false)).toEqual([ADMIN]);
  });

  it('re-derives a refresh from a grant issued at the old address', () => {
    const base = {
      registrationOrigin: 'anonymous',
      mcpAudience: NOW,
      scope: ['openid', 'mcp:read'],
      audience: [OLD],
    };
    expect(refreshUnderPolicy({ ...base, policy: 'mcp' }).audience).toEqual([NOW]);
    expect(refreshUnderPolicy({ ...base, policy: 'open' }).audience).toEqual([]);
  });

  it('leaves another client’s audiences alone', () => {
    expect(audiencesHeld('seeded', 'open', [OLD], NOW)).toEqual([OLD]);
  });
});

describe('scopeHeldOf', () => {
  it('keeps, in the order asked, the scopes the client is assigned', () => {
    expect(scopeHeldOf('openid profile mcp:read', ['mcp:read', 'openid'])).toBe('openid mcp:read');
  });

  it('says nothing when nothing was asked, and nothing held when none is assigned', () => {
    expect(scopeHeldOf(undefined, ['openid'])).toBeUndefined();
    expect(scopeHeldOf('profile', ['openid'])).toBe('');
  });
});
