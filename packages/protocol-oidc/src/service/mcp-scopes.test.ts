import { describe, expect, it } from 'vitest';
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
  MCP_WRITE_MAX_TTL_SECONDS,
  capLifetimeForScope,
  refreshAllowedForScope,
  scopeAllowedAt,
  scopesCoherentWithAudience,
  withMcpScopes,
} from '#/service/mcp-scopes';

const MCP = 'https://idp.example/tenants/acme/mcp';
const ADMIN = 'https://idp.example/admin';

describe('scopeAllowedAt', () => {
  it('names the two scopes by their wire values', () => {
    expect(MCP_READ_SCOPE).toBe('mcp:read');
    expect(MCP_WRITE_SCOPE).toBe('mcp:write');
  });

  it.each([MCP_READ_SCOPE, MCP_WRITE_SCOPE])('allows %s at the MCP and the admin audience', (s) => {
    expect(scopeAllowedAt(s, MCP, MCP, ADMIN)).toBe(true);
    expect(scopeAllowedAt(s, ADMIN, MCP, ADMIN)).toBe(true);
  });

  it.each([MCP_READ_SCOPE, MCP_WRITE_SCOPE])('refuses %s at any other audience', (s) => {
    expect(scopeAllowedAt(s, 'https://api.example', MCP, ADMIN)).toBe(false);
    expect(scopeAllowedAt(s, 'https://idp.example/tenants/acme', MCP, ADMIN)).toBe(false);
    expect(scopeAllowedAt(s, '', MCP, ADMIN)).toBe(false);
  });

  it('is not widened by a prefix or a case difference of an audience', () => {
    expect(scopeAllowedAt(MCP_READ_SCOPE, `${MCP}/x`, MCP, ADMIN)).toBe(false);
    expect(scopeAllowedAt(MCP_READ_SCOPE, MCP.toUpperCase(), MCP, ADMIN)).toBe(false);
  });

  it('allows every other scope at every audience', () => {
    for (const scope of ['openid', 'profile', 'mcp:reader', 'MCP:READ']) {
      expect(scopeAllowedAt(scope, 'https://api.example', MCP, ADMIN)).toBe(true);
      expect(scopeAllowedAt(scope, MCP, MCP, ADMIN)).toBe(true);
    }
  });
});

describe('withMcpScopes', () => {
  it('adds both scopes once and keeps the list sorted', () => {
    expect(withMcpScopes(['profile', 'openid', 'mcp:read'])).toEqual([
      'mcp:read',
      'mcp:write',
      'openid',
      'profile',
    ]);
  });

  it('does not change its argument', () => {
    const scopes = ['openid'];
    withMcpScopes(scopes);
    expect(scopes).toEqual(['openid']);
  });
});

describe('scopesCoherentWithAudience', () => {
  it('accepts an MCP scope only when every audience is the MCP or the admin one', () => {
    expect(scopesCoherentWithAudience(['openid', 'mcp:read'], [MCP], MCP, ADMIN)).toBe(true);
    expect(scopesCoherentWithAudience(['mcp:write'], [MCP, ADMIN], MCP, ADMIN)).toBe(true);
    expect(scopesCoherentWithAudience(['mcp:read'], [MCP, 'https://api.example'], MCP, ADMIN)).toBe(
      false,
    );
    expect(scopesCoherentWithAudience(['mcp:read'], ['https://api.example'], MCP, ADMIN)).toBe(
      false,
    );
  });

  it('refuses an MCP scope that names no audience at all', () => {
    expect(scopesCoherentWithAudience(['mcp:write'], [], MCP, ADMIN)).toBe(false);
  });

  it('leaves a request with no MCP scope to every audience', () => {
    expect(scopesCoherentWithAudience(['openid'], [], MCP, ADMIN)).toBe(true);
    expect(
      scopesCoherentWithAudience(['openid', 'profile'], ['https://api.example'], MCP, ADMIN),
    ).toBe(true);
  });
});

describe('capLifetimeForScope', () => {
  it('caps a lifetime at ten minutes when mcp:write is present', () => {
    expect(MCP_WRITE_MAX_TTL_SECONDS).toBe(600);
    expect(capLifetimeForScope(3600, ['openid', MCP_WRITE_SCOPE])).toBe(600);
    expect(capLifetimeForScope(600, [MCP_WRITE_SCOPE])).toBe(600);
  });

  it('only ever lowers: a shorter lifetime stands', () => {
    expect(capLifetimeForScope(300, [MCP_READ_SCOPE, MCP_WRITE_SCOPE])).toBe(300);
  });

  it('leaves the tenant lifetime alone without mcp:write', () => {
    expect(capLifetimeForScope(3600, [MCP_READ_SCOPE])).toBe(3600);
    expect(capLifetimeForScope(3600, [])).toBe(3600);
  });
});

describe('refreshAllowedForScope', () => {
  it('refuses a refresh token for a grant holding mcp:write, offline_access or not', () => {
    expect(refreshAllowedForScope([MCP_WRITE_SCOPE])).toBe(false);
    expect(refreshAllowedForScope(['offline_access', MCP_READ_SCOPE, MCP_WRITE_SCOPE])).toBe(false);
  });

  it('allows one otherwise', () => {
    expect(refreshAllowedForScope([MCP_READ_SCOPE, 'offline_access'])).toBe(true);
  });
});
