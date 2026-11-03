import { describe, expect, it } from 'vitest';
import {
  isTooBroad,
  lastDay,
  tooBroadAdvice,
  TOO_BROAD_TITLE,
} from '#/features/audit/services/tooBroad';
import type { GatewayFailure } from '#/shared/services/result';

function problem(status: number, type: string): GatewayFailure {
  return { ok: false, kind: 'problem', problem: { type, title: 'Bad Request', status } };
}

describe('a read the server stopped at its time bound', () => {
  it('is the typed problem, and no other 400', () => {
    expect(isTooBroad(problem(400, 'about:blank#audit-query-too-broad'))).toBe(true);
    expect(isTooBroad(problem(400, 'about:blank'))).toBe(false);
    expect(isTooBroad(problem(503, 'about:blank#audit-query-too-broad'))).toBe(false);
    expect(isTooBroad({ ok: false, kind: 'network' })).toBe(false);
    expect(isTooBroad(null)).toBe(false);
  });

  it('says which filters were on, and to choose a time range when there is none', () => {
    const text = tooBroadAdvice({
      action: 'client.update',
      actor_subject_id: 'x',
      outcome: 'allowed',
    });
    expect(TOO_BROAD_TITLE).toMatch(/too broad/u);
    expect(text).toContain('action, outcome and actor');
    expect(text).toMatch(/Choose a time range/u);
  });

  it('asks for a narrower range, or one filter fewer, when there is one already', () => {
    const text = tooBroadAdvice({
      action: 'a',
      event_type: 'token',
      from: '2026-10-01T00:00:00.000Z',
    });
    expect(text).toContain('event type and action');
    expect(text).not.toContain('from');
    expect(text).toMatch(/Narrow the range/u);
  });

  it('names one filter alone as it is', () => {
    expect(tooBroadAdvice({ action: 'a' })).toContain('with action,');
  });
});

describe('the quick range offered', () => {
  it('is the day up to now, in UTC, to the end of the minute so both ends are inclusive', () => {
    expect(lastDay(new Date('2026-10-12T09:03:30Z'))).toEqual({
      from: '2026-10-11T09:03:00.000Z',
      to: '2026-10-12T09:03:59.999Z',
    });
  });
});
