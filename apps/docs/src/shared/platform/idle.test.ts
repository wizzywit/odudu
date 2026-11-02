import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { whenIdle } from '@site/src/shared/platform/idle';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('whenIdle', () => {
  it('uses the idle callback where there is one, and cancels it', () => {
    const request = vi.fn((run: () => void) => {
      run();
      return 7;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', request);
    vi.stubGlobal('cancelIdleCallback', cancel);
    const run = vi.fn();
    const stop = whenIdle(run, 200);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('falls back to a timer of the given length', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const run = vi.fn();
    whenIdle(run, 200);
    await vi.advanceTimersByTimeAsync(199);
    expect(run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('cancels the fallback timer', async () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    const run = vi.fn();
    whenIdle(run, 200)();
    await vi.advanceTimersByTimeAsync(500);
    expect(run).not.toHaveBeenCalled();
  });
});
