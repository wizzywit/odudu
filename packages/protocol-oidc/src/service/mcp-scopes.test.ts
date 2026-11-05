import { describe, expect, it } from 'vitest';
import {
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
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
