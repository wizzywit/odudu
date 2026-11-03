import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { schedule } from '@site/src/shared/lib/platform/timers';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('schedule', () => {
  it('runs once after the delay', async () => {
    const run = vi.fn();
    schedule(run, 100);
    await vi.advanceTimersByTimeAsync(99);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not run once cancelled', async () => {
    const run = vi.fn();
    schedule(run, 100)();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
  });
});
