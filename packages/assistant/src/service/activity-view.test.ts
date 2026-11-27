import { describe, expect, it } from 'vitest';
import type { EventRow, StepRow, TurnRow } from '#/service/activity-rows';
import { decodePosition, encodePosition } from '#/service/activity-position';
import { askedTextOf, stopReasonOf, whyStoppedOf } from '#/service/activity-view';
import { retentionCutoff } from '#/service/retention';

const AT = new Date('2026-11-01T10:00:00Z');

function turn(stopReason: string | null, endedAt: Date | null = AT): TurnRow {
  return {
    id: 't',
    profile: 'free-chat',
    promptHash: 'a'.repeat(64),
    startedAt: AT,
    endedAt,
    stopReason,
  };
}

function event(kind: string, payload: Record<string, unknown>, seq = 0): EventRow {
  return { turnId: 't', seq, stepId: null, kind, payload, at: AT };
}

const STEPS = [1, 2, 3].map((n): StepRow => ({
  id: `s${String(n)}`,
  turnId: 't',
  parentStepId: null,
  slot: 'standard',
  model: 'm',
  providerRequestId: null,
  inputTokens: 1,
  outputTokens: 1,
  startedAt: AT,
  endedAt: AT,
}));

describe('why a turn stopped', () => {
  it('says what a budget refusal ran into, from the reservation that was refused', () => {
    const why = whyStoppedOf(
      turn('budget_tenant'),
      [
        event('reservation', { slot: 'fast', outcome: 'reserved' }, 0),
        event('reservation', { slot: 'deep', outcome: 'refused', level: 'tenant_month' }, 1),
      ],
      STEPS,
    );
    expect(why).toBe(
      'The next model call was refused because the tenant’s monthly allowance for the deep model had no room.',
    );
  });

  it('still says something when no refusal was recorded', () => {
    expect(whyStoppedOf(turn('budget_admin'), [], STEPS)).toBe(
      'A budget level had no room for the next model call.',
    );
  });

  it('counts the steps of a turn that hit its cap', () => {
    expect(whyStoppedOf(turn('step_cap'), [], STEPS)).toBe(
      'The turn reached its limit of 3 model calls and stopped.',
    );
  });

  it('names the change a turn waited on', () => {
    const why = whyStoppedOf(
      turn('awaiting_approval'),
      [event('policy', { tool: 'create_role', outcome: 'approval_requested' })],
      STEPS,
    );
    expect(why).toBe('A change (create_role) waited for the person’s decision.');
  });

  it('gives the last failure of an errored turn, cut to a bound', () => {
    const why = whyStoppedOf(
      turn('error'),
      [event('error', { name: 'APICallError', message: 'x'.repeat(1000) })],
      STEPS,
    );
    expect(why.startsWith('The turn failed. APICallError: xxx')).toBe(true);
    expect(why.length).toBeLessThan(340);
  });

  it('tells a turn that never closed from one that closed with no reason', () => {
    expect(whyStoppedOf(turn(null, null), [], [])).toMatch(/has not ended/u);
    expect(whyStoppedOf(turn('something-new'), [], [])).toMatch(/without a reason/u);
    expect(stopReasonOf('something-new')).toBeNull();
    expect(stopReasonOf('done')).toBe('done');
  });
});

describe('the text a person asked', () => {
  it('joins the text parts and leaves a message with none out', () => {
    const parts = [
      { type: 'text', text: 'one' },
      { type: 'file', url: 'x' },
      { type: 'text', text: 'two' },
    ];
    expect(askedTextOf({ seq: 1, createdAt: AT, parts })).toBe('one\ntwo');
    expect(askedTextOf({ seq: 1, createdAt: AT, parts: [{ type: 'file' }] })).toBeNull();
    expect(askedTextOf({ seq: 1, createdAt: AT, parts: 'x' })).toBeNull();
  });
});

describe('a list position', () => {
  const ID = '0198f2f6-1c6e-7000-8000-000000000001';

  it('round-trips the time as the database prints it', () => {
    const position = { lastActiveAt: '2026-11-01 10:00:00.123456+00', id: ID };
    expect(decodePosition(encodePosition(position))).toEqual(position);
  });

  it('refuses what is not a position', () => {
    for (const raw of ['', 'x', ID, `2026-11-01|${ID}`, `2026-11-01 10:00:00+00|nope`]) {
      expect(decodePosition(raw), raw).toBeUndefined();
    }
  });
});

describe('the retention cutoff', () => {
  it('is the window before now', () => {
    expect(retentionCutoff(AT, 30).toISOString()).toBe('2026-10-02T10:00:00.000Z');
  });
});
