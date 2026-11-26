import { describe, expect, it } from 'vitest';
import {
  assistantGrantRefusal,
  assistantScopeCeiling,
  type AssistantGrantGrounds,
} from '#/service/assistant-grant-rules';

const grounds: AssistantGrantGrounds = {
  tenantId: 't1',
  expectedSubjectId: 's1',
  scope: ['mcp:read'],
  mode: 'ask',
  console: {
    tenantId: 't1',
    subjectId: 's1',
    revokedAt: null,
    clientId: 'admin-row',
    sessionId: 'sess',
    exchangedFromGrantId: null,
  },
  consoleClient: { id: 'admin-row', builtinAdmin: true },
  assistantClient: { enabled: true, builtinAssistant: true, agentType: true },
  tenantEnabled: true,
  sessionLive: true,
  subjectEnabled: true,
};

describe('assistantScopeCeiling', () => {
  it('is mcp:read in Ask mode, and nothing wider while no write has a grant of its own', () => {
    expect(assistantScopeCeiling('ask')).toEqual(['mcp:read']);
    expect(assistantScopeCeiling('act')).toEqual(['mcp:read']);
  });
});

describe('assistantGrantRefusal', () => {
  it('admits a live console sign-in of this subject for the mode ceiling', () => {
    expect(assistantGrantRefusal(grounds)).toBeNull();
  });

  it.each([
    ['no grant', { console: null }, 'grant_not_found'],
    [
      'a grant of another tenant',
      { console: { ...grounds.console, tenantId: 't2' } as never },
      'grant_not_found',
    ],
    [
      'another administrator',
      { console: { ...grounds.console, subjectId: 's2' } as never },
      'subject_mismatch',
    ],
    [
      'a revoked grant',
      { console: { ...grounds.console, revokedAt: new Date() } as never },
      'grant_revoked',
    ],
    ['a grant of no client', { consoleClient: null }, 'grant_not_console'],
    [
      'a grant of a client that is not the admin client',
      { consoleClient: { id: 'admin-row', builtinAdmin: false } },
      'grant_not_console',
    ],
    [
      'a grant that was itself exchanged',
      { console: { ...grounds.console, exchangedFromGrantId: 'g0' } as never },
      'grant_not_console',
    ],
    [
      'a grant bound to no session',
      { console: { ...grounds.console, sessionId: null } as never },
      'session_required',
    ],
    ['an ended session', { sessionLive: false }, 'session_ended'],
    ['a disabled subject', { subjectEnabled: false }, 'subject_disabled'],
    ['a disabled tenant', { tenantEnabled: false }, 'tenant_disabled'],
    ['no assistant client', { assistantClient: null }, 'assistant_unavailable'],
    [
      'a disabled assistant client',
      { assistantClient: { enabled: false, builtinAssistant: true, agentType: true } },
      'assistant_unavailable',
    ],
    [
      'a client that only carries the id',
      { assistantClient: { enabled: true, builtinAssistant: false, agentType: true } },
      'assistant_unavailable',
    ],
    [
      'an assistant client that is no longer an agent type',
      { assistantClient: { enabled: true, builtinAssistant: true, agentType: false } },
      'assistant_unavailable',
    ],
    ['a write scope in Ask mode', { scope: ['mcp:read', 'mcp:write'] }, 'scope_widened'],
    ['a scope outside MCP', { scope: ['openid'] }, 'scope_widened'],
    ['no scope', { scope: [] }, 'scope_widened'],
  ] as const)('refuses %s', (_, over, reason) => {
    expect(assistantGrantRefusal({ ...grounds, ...over })).toBe(reason);
  });
});
