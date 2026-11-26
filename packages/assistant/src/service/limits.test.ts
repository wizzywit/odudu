import { describe, expect, it } from 'vitest';
import {
  ADMIN_DAY_PERCENT,
  CONVERSATION_TOKEN_LIMIT,
  levelLimitsFor,
  refusalFor,
  stopReasonOf,
  TURN_TOKEN_LIMIT,
  warnedLevels,
  actualSpend,
  WARN_PERCENT,
  type AssistantLimits,
} from '#/service/limits';

const LIMITS: AssistantLimits = {
  monthlyTokensBySlot: { fast: 2_000_000, standard: 5_000_000, deep: 1_000_000 },
  allowedModels: [],
  toolClasses: ['read'],
  modes: ['ask', 'act'],
  maxConcurrent: 5,
  maxStepsPerTurn: 20,
};

const WHEN = new Date('2026-11-26T13:45:10.000Z');
const STARTED = new Date('2026-11-26T13:45:00.000Z');

function levels(slot: 'fast' | 'standard' | 'deep' = 'standard') {
  return levelLimitsFor({
    tenantId: 't1',
    ownerSubjectId: 's1',
    conversationId: 'c1',
    turnId: 'u1',
    slot,
    limits: LIMITS,
    now: WHEN,
    turnStartedAt: STARTED,
  });
}

describe('levelLimitsFor', () => {
  it('names the four levels, tenant month first, each with the key it counts under', () => {
    expect(levels().map((entry) => [entry.level, entry.scopeKey])).toEqual([
      ['tenant_month', 't1'],
      ['admin_day', 's1'],
      ['conversation', 'c1'],
      ['turn', 'u1'],
    ]);
  });

  it('takes the tenant limit of the slot used, and a share of it for one administrator a day', () => {
    const [tenant, admin] = levels('deep');
    expect(tenant?.limitTokens).toBe(1_000_000);
    expect(tenant?.slot).toBe('deep');
    expect(admin?.limitTokens).toBe(Math.ceil((1_000_000 * ADMIN_DAY_PERCENT) / 100));
    expect(admin?.slot).toBe('deep');
  });

  it('counts conversation and turn across slots, at their fixed limits', () => {
    const [, , conversation, turn] = levels();
    expect(conversation).toMatchObject({ slot: null, limitTokens: CONVERSATION_TOKEN_LIMIT });
    expect(turn).toMatchObject({ slot: null, limitTokens: TURN_TOKEN_LIMIT });
  });

  it('starts the month, the day, the conversation month and the turn in the right places', () => {
    const [tenant, admin, conversation, turn] = levels();
    expect(tenant?.windowStart.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(admin?.windowStart.toISOString()).toBe('2026-11-26T00:00:00.000Z');
    expect(conversation?.windowStart.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(turn?.windowStart.toISOString()).toBe(STARTED.toISOString());
  });

  it('gives a tenant limit of zero as zero everywhere it applies', () => {
    const zero = levelLimitsFor({
      tenantId: 't1',
      ownerSubjectId: 's1',
      conversationId: 'c1',
      turnId: 'u1',
      slot: 'fast',
      limits: { ...LIMITS, monthlyTokensBySlot: { ...LIMITS.monthlyTokensBySlot, fast: 0 } },
      now: WHEN,
      turnStartedAt: STARTED,
    });
    expect(zero[0]?.limitTokens).toBe(0);
    expect(zero[1]?.limitTokens).toBe(0);
  });
});

describe('refusalFor', () => {
  it('names the level and the slot, and who can change the limit', () => {
    const tenant = refusalFor('tenant_month', 'standard');
    expect(tenant.stopReason).toBe('budget_tenant');
    expect(tenant.message).toMatch(/standard model/u);
    expect(tenant.message).toMatch(/tenant administrator/u);
    expect(tenant.message).toMatch(/manage-assistant/u);
  });

  it('maps every level to its own stop reason', () => {
    expect(refusalFor('admin_day', 'fast').stopReason).toBe('budget_admin');
    expect(refusalFor('conversation', 'fast').stopReason).toBe('budget_conversation');
    expect(refusalFor('turn', 'fast').stopReason).toBe('budget_turn');
  });

  it('says what to do for the levels nobody configures', () => {
    expect(refusalFor('conversation', 'fast').message).toMatch(/new conversation/u);
    expect(refusalFor('turn', 'fast').message).toMatch(/again/u);
    expect(refusalFor('admin_day', 'fast').message).toMatch(/midnight UTC/u);
  });

  it('never mentions a cheaper model being used instead', () => {
    for (const level of ['tenant_month', 'admin_day', 'conversation', 'turn'] as const) {
      expect(refusalFor(level, 'deep').message).not.toMatch(/switch|fell back|instead/iu);
    }
  });
});

describe('warnedLevels', () => {
  it('names the levels at or past the warning percentage, with their percent', () => {
    const out = warnedLevels([
      { level: 'tenant_month', used: 80, limit: 100 },
      { level: 'admin_day', used: 79, limit: 100 },
      { level: 'turn', used: 120, limit: 100 },
    ]);
    expect(WARN_PERCENT).toBe(80);
    expect(out).toEqual([
      { level: 'tenant_month', percent: 80 },
      { level: 'turn', percent: 100 },
    ]);
  });

  it('does not divide by a zero limit', () => {
    expect(warnedLevels([{ level: 'turn', used: 0, limit: 0 }])).toEqual([]);
  });
});

describe('stopReasonOf', () => {
  const base = { refused: undefined, aborted: false, failed: false, steps: 2, maxSteps: 8 };

  it('is done after an answer', () => {
    expect(stopReasonOf({ ...base, lastFinish: 'stop' })).toBe('done');
  });

  it('is step_cap when the last step still wanted a tool and the cap was reached', () => {
    expect(stopReasonOf({ ...base, steps: 8, lastFinish: 'tool-calls' })).toBe('step_cap');
  });

  it('prefers the refusal, then an abort, then a failure', () => {
    const refused = { level: 'turn', stopReason: 'budget_turn' } as const;
    expect(
      stopReasonOf({ ...base, refused, aborted: true, failed: true, lastFinish: 'stop' }),
    ).toBe('budget_turn');
    expect(stopReasonOf({ ...base, aborted: true, failed: true, lastFinish: 'stop' })).toBe(
      'aborted',
    );
    expect(stopReasonOf({ ...base, failed: true, lastFinish: 'stop' })).toBe('error');
  });
});

describe('actualSpend', () => {
  it('takes the provider total, else input plus output', () => {
    expect(actualSpend({ totalTokens: 90 }, 500)).toBe(90);
    expect(actualSpend({ inputTokens: 60, outputTokens: 7 }, 500)).toBe(67);
  });

  it('charges the whole reservation when nothing was reported, a zero total included', () => {
    expect(actualSpend({}, 500)).toBe(500);
    expect(actualSpend({ totalTokens: 0 }, 500)).toBe(500);
    expect(actualSpend({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }, 500)).toBe(500);
    expect(actualSpend({ inputTokens: undefined, outputTokens: 0 }, 500)).toBe(500);
  });
});
