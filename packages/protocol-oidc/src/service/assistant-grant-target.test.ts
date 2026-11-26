import { describe, expect, it } from 'vitest';
import { assistantGrantRefusal, type AssistantGrantGrounds } from '#/service/assistant-grant-rules';

const SYSTEM = '0199aa00-0000-7000-8000-000000000001';

const home: AssistantGrantGrounds = {
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

const TARGET = { id: 'tx', enabled: true, assistantEnabled: true };

const system: AssistantGrantGrounds = {
  ...home,
  tenantId: SYSTEM,
  console: { ...home.console, tenantId: SYSTEM } as never,
  target: TARGET,
  ownerCapabilities: ['manage-tenants', 'use-assistant'],
};

describe('a conversation in another tenant', () => {
  it('is admitted for a system administrator and an available target', () => {
    expect(assistantGrantRefusal(system)).toBeNull();
  });

  it('is refused unless the console grant belongs to the system tenant', () => {
    expect(assistantGrantRefusal({ ...home, target: TARGET })).toBe('target_not_allowed');
  });

  it('is the ordinary case when the target is the home tenant', () => {
    expect(assistantGrantRefusal({ ...home, target: { ...TARGET, id: 't1' } })).toBeNull();
    expect(assistantGrantRefusal({ ...system, target: { ...TARGET, id: SYSTEM } })).toBeNull();
  });

  it.each([
    ['a target that was not found', { target: null }, 'target_unavailable'],
    ['a disabled target tenant', { target: { ...TARGET, enabled: false } }, 'target_unavailable'],
    [
      'a target tenant that switched the assistant off',
      { target: { ...TARGET, assistantEnabled: false } },
      'target_assistant_disabled',
    ],
  ] as const)('is refused for %s', (_, over, reason) => {
    expect(assistantGrantRefusal({ ...system, ...over })).toBe(reason);
  });

  it.each([
    ['manage-tenants', ['use-assistant']],
    ['use-assistant', ['manage-tenants']],
    ['both', []],
  ] as const)('is refused when the owner lacks %s, whatever the route did', (_, held) => {
    expect(assistantGrantRefusal({ ...system, ownerCapabilities: held })).toBe(
      'owner_lacks_capability',
    );
  });

  it('is refused when the owner’s capabilities were not read', () => {
    const unread: AssistantGrantGrounds = {
      ...home,
      tenantId: SYSTEM,
      console: { ...home.console, tenantId: SYSTEM } as never,
      target: TARGET,
    };
    expect(assistantGrantRefusal(unread)).toBe('owner_lacks_capability');
  });

  it('does not ask a conversation in its own tenant for manage-tenants', () => {
    expect(assistantGrantRefusal({ ...home, ownerCapabilities: [] })).toBeNull();
  });

  it('names a revoked console grant before it looks at the target', () => {
    const revoked = { ...system.console, revokedAt: new Date() } as never;
    expect(assistantGrantRefusal({ ...system, console: revoked, target: null })).toBe(
      'grant_revoked',
    );
  });
});
