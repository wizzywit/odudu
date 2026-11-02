import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, FOLLOW_UP } from '@site/src/features/landing/services/content';
import {
  DEFAULT_RHYTHM,
  playTerminal,
  seeded,
} from '@site/src/features/landing/services/typewriter';

// The test's clock is vitest's fake one, read when each timer is set.
const FAKE_TIMERS = {
  set: (run: () => void, ms: number): unknown => setTimeout(run, ms),
  clear: (handle: unknown): void => {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

const length = COMMANDS[0]?.command.length ?? 0;
const lines = FOLLOW_UP.output.length + 1;

function run(random: () => number): { events: [number, string][]; total: number } {
  const events: [number, string][] = [];
  let now = 0;
  playTerminal(
    length,
    lines,
    { ...DEFAULT_RHYTHM, random, timers: FAKE_TIMERS },
    {
      count: (typed) => events.push([now, `key ${String(typed)}`]),
      commandDone: () => events.push([now, 'command']),
      line: (shown) => events.push([now, `line ${String(shown)}`]),
      done: () => events.push([now, 'done']),
    },
  );
  for (let tick = 0; tick < 10_000 && !events.some(([, name]) => name === 'done'); tick += 1) {
    now += 5;
    vi.advanceTimersByTime(5);
  }
  return { events, total: now };
}

describe('the hero terminal rhythm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is repeatable for one seed and different for another', () => {
    const first = run(seeded(7)).events.map(([at]) => at);
    const again = run(seeded(7)).events.map(([at]) => at);
    const other = run(seeded(8)).events.map(([at]) => at);
    expect(again).toEqual(first);
    expect(other).not.toEqual(first);
  });

  it('types at about 22 characters a second, pauses, then shows each line on its own beat, in under 6.5 seconds', () => {
    const { events, total } = run(seeded(7));
    expect(total).toBeLessThan(6500);
    const at = (name: string): number => events.find(([, event]) => event === name)?.[0] ?? -1;
    const typingMs = at('command') - at('key 1');
    const perKey = typingMs / (length - 1);
    expect(perKey).toBeGreaterThan(40);
    expect(perKey).toBeLessThan(50);
    expect(at('line 1') - at('command')).toBeGreaterThanOrEqual(395);
    expect(at('line 1') - at('command')).toBeLessThanOrEqual(410);
    expect(at('line 2') - at('line 1')).toBeGreaterThanOrEqual(245);
    expect(at('line 3') - at('line 2')).toBeGreaterThanOrEqual(245);
    const keys = events.filter(([, event]) => event.startsWith('key'));
    const gaps = keys.slice(1).map(([time], index) => time - (keys[index]?.[0] ?? 0));
    expect(new Set(gaps).size).toBeGreaterThan(3);
  });
});
