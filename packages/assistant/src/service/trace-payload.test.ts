import { describe, expect, it } from 'vitest';
import { EVENT_BYTES, boundPayload, payloadBytes, toJson } from '#/service/trace-payload';

describe('toJson', () => {
  it('keeps what JSON keeps and drops what it cannot hold', () => {
    expect(toJson({ a: 1, b: undefined, c: [new Date(0)] })).toEqual({
      a: 1,
      c: ['1970-01-01T00:00:00.000Z'],
    });
    expect(toJson(undefined)).toBeNull();
  });

  it('does not throw on a cycle or a bigint', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(toJson(cycle)).toBe('[unserializable]');
    expect(toJson(10n)).toBe('[unserializable]');
  });
});

describe('boundPayload', () => {
  it('leaves a payload inside the cap as it is', () => {
    expect(boundPayload({ a: 'x' })).toEqual({ a: 'x' });
  });

  it('replaces one over the cap by a cut preview that fits and says so', () => {
    const out = boundPayload({ output: 'é"\n'.repeat(EVENT_BYTES) });
    expect(payloadBytes(out)).toBeLessThanOrEqual(EVENT_BYTES);
    expect(out).toMatchObject({ truncated: true });
  });
});
