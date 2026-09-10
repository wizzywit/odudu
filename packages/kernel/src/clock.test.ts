import { describe, expect, it } from 'vitest';
import { FakeClock, systemClock } from '#/clock';

describe('FakeClock', () => {
  it('does not move on its own', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    const first = clock.now();
    const second = clock.now();
    expect(second.getTime()).toBe(first.getTime());
  });

  it('advances by the given milliseconds', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    clock.advance(90_000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:01:30.000Z');
  });

  it('returns a copy, so callers cannot mutate the clock', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    clock.now().setFullYear(1999);
    expect(clock.now().getUTCFullYear()).toBe(2026);
  });
});

describe('systemClock', () => {
  it('is close to the real time', () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(1_000);
  });
});
