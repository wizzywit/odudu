import { describe, expect, it } from 'vitest';
import {
  ASSISTANT_WRITE_CEILING,
  assistantGrantRefusal,
  assistantScopeCeiling,
  reattachDecision,
  type ReattachGrounds,
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

describe('the ceiling of a grant made for one approved write', () => {
  it('is mcp:write alone, and a conversation grant never reaches it', () => {
    expect(ASSISTANT_WRITE_CEILING).toEqual(['mcp:write']);
    expect(assistantGrantRefusal({ ...grounds, scope: ['mcp:write'], mode: 'act' })).toBe(
      'scope_widened',
    );
  });

  it('admits mcp:write under its own ceiling and nothing beside it', () => {
    const write = { ...grounds, mode: 'act' as const, ceiling: ASSISTANT_WRITE_CEILING };
    expect(assistantGrantRefusal({ ...write, scope: ['mcp:write'] })).toBeNull();
    expect(assistantGrantRefusal({ ...write, scope: ['mcp:read', 'mcp:write'] })).toBe(
      'scope_widened',
    );
    expect(assistantGrantRefusal({ ...write, scope: ['mcp:read'] })).toBe('scope_widened');
  });
});

describe('reattachDecision', () => {
  const SIGNED_OUT = new Date('2026-11-27T10:00:00.000Z');
  const held = { subjectId: 's1', isAssistantGrant: true };
  const liveGrant = { ...held, revokedAt: null, exchangedFromGrantId: 'console-now' };
  const endedGrant = { ...held, revokedAt: SIGNED_OUT, exchangedFromGrantId: 'console-before' };
  const live: ReattachGrounds = {
    consoleGrantId: 'console-now',
    expectedSubjectId: 's1',
    archived: false,
    previous: liveGrant,
    parent: { revokedAt: null, revokedCause: null },
  };
  const afterSignOut: ReattachGrounds = {
    ...live,
    previous: endedGrant,
    parent: { revokedAt: SIGNED_OUT, revokedCause: 'sign_out' },
  };

  it('leaves a grant that is live and came from this sign-in as it is', () => {
    expect(reattachDecision(live)).toEqual({ kind: 'live' });
  });

  it('carries on a conversation whose sign-in the person ended', () => {
    expect(reattachDecision(afterSignOut)).toEqual({ kind: 'reattach' });
  });

  it('carries on one whose sign-in lapsed without a revocation, or is held by another sign-in', () => {
    const lapsed: ReattachGrounds = {
      ...live,
      previous: { ...liveGrant, exchangedFromGrantId: 'console-before' },
      parent: { revokedAt: null, revokedCause: null },
    };
    expect(reattachDecision(lapsed)).toEqual({ kind: 'reattach' });
  });

  it.each([
    [
      'no cause recorded, as a reused refresh token or an administrator leaves it',
      { revokedCause: null },
    ],
    ['an unknown cause', { revokedCause: 'admin' }],
  ])('refuses a sign-in revoked with %s', (_name, parent) => {
    expect(
      reattachDecision({
        ...afterSignOut,
        parent: { revokedAt: SIGNED_OUT, ...parent },
      }),
    ).toEqual({ kind: 'refused', reason: 'revoked_for_cause' });
  });

  it('refuses a conversation grant revoked at another time than the sign-out', () => {
    const earlier = new Date(SIGNED_OUT.getTime() - 60_000);
    expect(
      reattachDecision({
        ...afterSignOut,
        previous: { ...endedGrant, revokedAt: earlier },
      }),
    ).toEqual({ kind: 'refused', reason: 'revoked_for_cause' });
  });

  it('refuses a conversation grant revoked while its sign-in is still live', () => {
    expect(
      reattachDecision({
        ...afterSignOut,
        parent: { revokedAt: null, revokedCause: null },
      }),
    ).toEqual({ kind: 'refused', reason: 'revoked_for_cause' });
  });

  it('refuses a live grant whose console grant was revoked for cause or is gone', () => {
    const lapsed = { ...liveGrant, exchangedFromGrantId: 'console-before' };
    expect(
      reattachDecision({
        ...live,
        previous: lapsed,
        parent: { revokedAt: SIGNED_OUT, revokedCause: null },
      }),
    ).toEqual({ kind: 'refused', reason: 'revoked_for_cause' });
    expect(reattachDecision({ ...live, previous: lapsed, parent: null })).toEqual({
      kind: 'refused',
      reason: 'revoked_for_cause',
    });
  });

  it('refuses a grant that is gone, that is not the assistant’s or that is another person’s', () => {
    expect(reattachDecision({ ...afterSignOut, previous: null })).toEqual({
      kind: 'refused',
      reason: 'conversation_grant_missing',
    });
    expect(
      reattachDecision({
        ...afterSignOut,
        previous: { ...endedGrant, isAssistantGrant: false },
      }),
    ).toEqual({ kind: 'refused', reason: 'conversation_grant_not_assistant' });
    expect(reattachDecision({ ...afterSignOut, expectedSubjectId: 's2' })).toEqual({
      kind: 'refused',
      reason: 'subject_mismatch',
    });
  });

  it('refuses a hidden conversation that would otherwise be carried on, and only then', () => {
    expect(reattachDecision({ ...afterSignOut, archived: true })).toEqual({
      kind: 'refused',
      reason: 'conversation_archived',
    });
    expect(reattachDecision({ ...live, archived: true })).toEqual({ kind: 'live' });
  });
});
