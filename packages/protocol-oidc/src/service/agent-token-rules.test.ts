import { ADMIN_API_AUDIENCE } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';
import {
  requestRefusal,
  standingRefusal,
  type AgentTokenGrounds,
} from '#/service/agent-token-rules';

const NOW = new Date('2026-11-05T12:00:00Z');
const LATER = new Date(NOW.getTime() + 60_000);

describe('requestRefusal', () => {
  const ok = { audience: ADMIN_API_AUDIENCE, scope: ['mcp:read'], notAfter: LATER, now: NOW };

  it('admits an MCP scope for the admin API before a token that has not ended', () => {
    expect(requestRefusal(ok)).toBeNull();
  });

  it.each([
    ['another audience', { audience: 'https://other.example' }, 'audience_not_admin'],
    ['no scope', { scope: [] }, 'scope_not_mcp'],
    ['a non-MCP scope', { scope: ['mcp:read', 'openid'] }, 'scope_not_mcp'],
    ['an ended token', { notAfter: NOW }, 'token_expired'],
  ])('refuses %s', (_, over, reason) => {
    expect(requestRefusal({ ...ok, ...over })).toBe(reason);
  });
});

describe('standingRefusal', () => {
  const grant = { tenantId: 't1', revokedAt: null, scope: 'mcp:read mcp:write', clientId: 'c1' };
  const grounds: AgentTokenGrounds = {
    tenantId: 't1',
    scope: ['mcp:read'],
    grant,
    client: { id: 'c1', enabled: true },
    tenantEnabled: true,
    sessionLive: true,
    subjectEnabled: true,
  };

  it('admits a live grant of the agent for a subset of its scope', () => {
    expect(standingRefusal(grounds)).toBeNull();
  });

  it.each([
    ['no grant', { grant: null }, 'grant_not_found'],
    ['a grant of another tenant', { grant: { ...grant, tenantId: 't2' } }, 'grant_not_found'],
    ['a revoked grant', { grant: { ...grant, revokedAt: NOW } }, 'grant_revoked'],
    [
      'a scope the grant lacks',
      { scope: ['mcp:write'], grant: { ...grant, scope: 'mcp:read' } },
      'scope_widened',
    ],
    ['no client', { client: null }, 'client_disabled'],
    ['a disabled client', { client: { id: 'c1', enabled: false } }, 'client_disabled'],
    [
      'a grant of another client',
      { client: { id: 'c2', enabled: true } },
      'grant_not_agent_client',
    ],
    ['a disabled tenant', { tenantEnabled: false }, 'tenant_disabled'],
    ['an ended session', { sessionLive: false }, 'session_ended'],
  ])('refuses %s', (_, over, reason) => {
    expect(standingRefusal({ ...grounds, ...over })).toBe(reason);
  });

  it('admits a grant bound to no session', () => {
    expect(standingRefusal({ ...grounds, sessionLive: null })).toBeNull();
  });

  it.each([['a disabled subject', { subjectEnabled: false }, 'subject_disabled']])(
    'refuses %s',
    (_, over, reason) => {
      expect(standingRefusal({ ...grounds, ...over })).toBe(reason);
    },
  );
});
