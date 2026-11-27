import { describe, expect, it } from 'vitest';
import {
  budgetName,
  readStreamPart,
  budgetNote,
  meterOf,
  nextMeter,
  NO_METER,
  readBudgetWarning,
  readTurnEnd,
} from '#/widgets/assistant-panel/services/budget';

describe('the stream parts the panel reads', () => {
  it('reads a turn end and refuses a reason it does not know', () => {
    expect(readTurnEnd({ stopReason: 'budget_turn' })).toEqual({ stopReason: 'budget_turn' });
    expect(readTurnEnd({ stopReason: 'something_new' })).toBeNull();
    expect(readTurnEnd('done')).toBeNull();
  });

  it('reads a budget warning and refuses one that is out of shape', () => {
    expect(readBudgetWarning({ level: 'conversation', percent: 82.5, slot: 'standard' })).toEqual({
      level: 'conversation',
      percent: 82.5,
      slot: 'standard',
    });
    expect(readBudgetWarning({ level: 'forever', percent: 82, slot: 'standard' })).toBeNull();
    expect(readBudgetWarning({ level: 'turn', percent: 140, slot: 'standard' })).toBeNull();
  });
});

describe('a data part of the stream', () => {
  it('is a turn end, a warning, or nothing the panel reads', () => {
    expect(readStreamPart({ type: 'data-turn_end', data: { stopReason: 'done' } })).toEqual({
      turn: { stopReason: 'done' },
    });
    expect(
      readStreamPart({
        type: 'data-budget_warning',
        data: { level: 'turn', percent: 80, slot: 'fast' },
      }),
    ).toEqual({ warning: { level: 'turn', percent: 80, slot: 'fast' } });
    expect(readStreamPart({ type: 'data-approval_card', data: {} })).toEqual({});
    expect(readStreamPart({ type: 'data-turn_end', data: { stopReason: 'nope' } })).toEqual({});
  });
});

describe('the allowance, named', () => {
  it.each([
    ['tenant_month', 'this tenant’s monthly allowance'],
    ['admin_day', 'your share of today’s allowance'],
    ['conversation', 'this conversation’s allowance'],
    ['turn', 'this answer’s allowance'],
  ] as const)('names the %s level', (level, name) => {
    expect(budgetName(level)).toBe(name);
  });

  it('says what resets each level and who can change it, in the server’s words when it sent them', () => {
    expect(budgetNote('tenant_month', 'The server said so.')).toBe('The server said so.');
    expect(budgetNote('tenant_month', '')).toContain('Settings');
    expect(budgetNote('conversation', null)).toContain('Start a new conversation');
    expect(budgetNote('admin_day', null)).toContain('midnight UTC');
    expect(budgetNote('turn', null)).toContain('narrower question');
  });
});

describe('the meter', () => {
  const WARNED = { level: 'admin_day', percent: 83.4, slot: 'standard' } as const;

  it('says nothing until the server has said something', () => {
    expect(meterOf(NO_METER)).toBeNull();
  });

  it('warns with the server’s own percent and the level it is of, rounded down', () => {
    expect(meterOf({ ...NO_METER, warning: WARNED })).toEqual({
      level: 'warning',
      text: '83% of your share of today’s allowance used',
      percent: 83,
    });
    expect(
      meterOf({ ...NO_METER, warning: { level: 'turn', percent: 99.6, slot: 'deep' } })?.percent,
    ).toBe(99);
  });

  it('names the level that refused, over a warning', () => {
    expect(meterOf({ warning: WARNED, refused: 'tenant_month', fresh: false })).toEqual({
      level: 'refused',
      text: 'Allowance used: this tenant’s monthly allowance',
      percent: null,
    });
  });

  it('keeps a warning and a refusal through the next send', () => {
    const refused = nextMeter(NO_METER, { kind: 'turn', turn: { stopReason: 'budget_turn' } });
    expect(nextMeter(refused, { kind: 'start' }).refused).toBe('turn');
    const warned = nextMeter(NO_METER, { kind: 'warning', warning: WARNED });
    expect(nextMeter(warned, { kind: 'start' }).warning).toEqual(WARNED);
  });

  it('clears a refusal when a turn ends well, and a warning when that turn brought none', () => {
    const refused = nextMeter(nextMeter(NO_METER, { kind: 'warning', warning: WARNED }), {
      kind: 'turn',
      turn: { stopReason: 'budget_admin' },
    });
    const next = nextMeter(nextMeter(refused, { kind: 'start' }), {
      kind: 'turn',
      turn: { stopReason: 'done' },
    });
    expect(next).toEqual(NO_METER);
  });

  it('keeps a warning a turn brought, when that turn ends well', () => {
    const turn = nextMeter(nextMeter(NO_METER, { kind: 'start' }), {
      kind: 'warning',
      warning: WARNED,
    });
    expect(nextMeter(turn, { kind: 'turn', turn: { stopReason: 'done' } }).warning).toEqual(WARNED);
  });

  it('is not moved by a turn that ended for another reason', () => {
    const warned = nextMeter(NO_METER, { kind: 'warning', warning: WARNED });
    for (const stopReason of ['step_cap', 'aborted', 'error', 'awaiting_approval'] as const) {
      expect(nextMeter(warned, { kind: 'turn', turn: { stopReason } })).toEqual(warned);
    }
  });
});
