import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIdle } from '@site/src/shared/lib/use-cases/useIdle';

// Effects are collected and run by the test, so no DOM is needed.
const effects: (() => (() => void) | undefined)[] = [];

vi.mock('react', () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    effects.push(effect);
  },
  useEffectEvent: (run: () => void) => run,
}));

beforeEach(() => {
  effects.length = 0;
  vi.useFakeTimers();
  vi.stubGlobal('requestIdleCallback', undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function useIdleOnce(enabled: boolean, begin: () => () => void): (() => void) | undefined {
  useIdle(enabled, 200, begin);
  return effects[0]?.();
}

describe('useIdle', () => {
  it('starts the work once the idle fallback has passed', async () => {
    const begin = vi.fn(() => () => undefined);
    useIdleOnce(true, begin);
    await vi.advanceTimersByTimeAsync(199);
    expect(begin).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it('stops what it started when the effect is cleaned up', async () => {
    const stop = vi.fn();
    const cleanup = useIdleOnce(
      true,
      vi.fn(() => stop),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(stop).not.toHaveBeenCalled();
    cleanup?.();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('cancels a start that has not happened yet', async () => {
    const begin = vi.fn(() => () => undefined);
    const cleanup = useIdleOnce(true, begin);
    cleanup?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(begin).not.toHaveBeenCalled();
  });

  it('does nothing while it is not enabled', async () => {
    const begin = vi.fn(() => () => undefined);
    expect(useIdleOnce(false, begin)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(500);
    expect(begin).not.toHaveBeenCalled();
  });
});
