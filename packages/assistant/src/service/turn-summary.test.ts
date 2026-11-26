import { describe, expect, it } from 'vitest';
import { summaryOf, turnOutcomeOf } from '#/service/turn-summary';

describe('turnOutcomeOf', () => {
  it('calls a budget stop refused, an error failed and everything else allowed', () => {
    expect(turnOutcomeOf('budget_turn')).toBe('refused');
    expect(turnOutcomeOf('budget_tenant')).toBe('refused');
    expect(turnOutcomeOf('error')).toBe('failed');
    for (const reason of ['done', 'step_cap', 'awaiting_approval', 'aborted'] as const) {
      expect(turnOutcomeOf(reason)).toBe('allowed');
    }
  });
});

describe('summaryOf', () => {
  it('names the slot once and the tokens under it, and holds nothing else of the turn', () => {
    const summary = summaryOf({
      tenantId: 't',
      subjectId: 's',
      conversationId: 'c',
      turnId: 'u',
      profile: 'free-chat',
      mode: 'ask',
      slot: 'standard',
      steps: 2,
      tokens: 40,
      stopReason: 'done',
      traceLost: false,
    });
    expect(summary).toEqual({
      tenantId: 't',
      subjectId: 's',
      conversationId: 'c',
      turnId: 'u',
      profile: 'free-chat',
      mode: 'ask',
      slots: ['standard'],
      tokensBySlot: { standard: 40 },
      steps: 2,
      stopReason: 'done',
      outcome: 'allowed',
      traceLost: false,
    });
  });

  it('says when the trace of the turn is incomplete', () => {
    const summary = summaryOf({
      tenantId: 't',
      subjectId: 's',
      conversationId: 'c',
      turnId: 'u',
      profile: 'free-chat',
      mode: 'ask',
      slot: 'standard',
      steps: 1,
      tokens: 1,
      stopReason: 'done',
      traceLost: true,
    });
    expect(summary.traceLost).toBe(true);
  });
});
