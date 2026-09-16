import { type Logger } from '@odudu/kernel';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextDelayMs, startScheduler } from '#/scheduler';

const INTERVAL = 60_000;
const JITTER = 6000;

interface RecordingLog extends Logger {
  readonly errors: readonly { readonly err: unknown; readonly msg: string | undefined }[];
}

function recordingLog(): RecordingLog {
  const errors: { err: unknown; msg: string | undefined }[] = [];
  const log: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (obj: object, msg?: string) => {
      errors.push({ err: (obj as { err?: unknown }).err, msg });
    },
    child: () => log,
  };
  return { ...log, errors };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('where a tick lands', () => {
  it('is never before the interval and never after the interval plus the jitter', () => {
    for (const random of [0, 0.25, 0.5, 0.75, 0.999_999, 1]) {
      const delay = nextDelayMs(INTERVAL, JITTER, random);

      expect(delay).toBeGreaterThanOrEqual(INTERVAL);
      expect(delay).toBeLessThanOrEqual(INTERVAL + JITTER);
    }
  });

  it('spreads across the band rather than sitting at one end of it', () => {
    const delays = new Set([0.1, 0.4, 0.9].map((random) => nextDelayMs(INTERVAL, JITTER, random)));

    expect(delays.size).toBe(3);
  });
});

describe('the scheduled pass', () => {
  it('does not run before the interval has elapsed', async () => {
    const runs: number[] = [];
    const scheduler = startScheduler({
      intervalMs: INTERVAL,
      jitterMs: JITTER,
      random: () => 0,
      log: recordingLog(),
      run: () => {
        runs.push(runs.length);
        return Promise.resolve();
      },
    });

    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(runs).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(1);

    await scheduler.stop();
  });

  it('waits out the whole jitter when the draw lands at the top of the band', async () => {
    const runs: number[] = [];
    const scheduler = startScheduler({
      intervalMs: INTERVAL,
      jitterMs: JITTER,
      random: () => 1,
      log: recordingLog(),
      run: () => {
        runs.push(runs.length);
        return Promise.resolve();
      },
    });

    await vi.advanceTimersByTimeAsync(INTERVAL + JITTER - 1);
    expect(runs).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(runs).toHaveLength(1);

    await scheduler.stop();
  });

  it('runs once per interval, not once in total', async () => {
    const runs: number[] = [];
    const scheduler = startScheduler({
      intervalMs: INTERVAL,
      jitterMs: 0,
      random: () => 0,
      log: recordingLog(),
      run: () => {
        runs.push(runs.length);
        return Promise.resolve();
      },
    });

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(runs).toHaveLength(3);

    await scheduler.stop();
  });

  // The property a background loop lives or dies by. A pass that throws is
  // a pass that did not happen, not the end of reaping for the life of the
  // process — so what is asserted here is the two *later* runs, which only
  // happen if the loop rescheduled itself after the throw. Asserting that
  // the failure was logged would establish nothing about the loop.
  it('is still running after a pass throws', async () => {
    const log = recordingLog();
    const runs: number[] = [];
    const scheduler = startScheduler({
      intervalMs: INTERVAL,
      jitterMs: 0,
      random: () => 0,
      log,
      run: () => {
        runs.push(runs.length);
        return runs.length === 1
          ? Promise.reject(new Error('the first pass fails'))
          : Promise.resolve();
      },
    });

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(runs).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(runs).toHaveLength(3);

    expect(log.errors).toHaveLength(1);
    expect(log.errors[0]?.err).toBeInstanceOf(Error);

    await scheduler.stop();
  });

  it('runs nothing further once stopped', async () => {
    const runs: number[] = [];
    const scheduler = startScheduler({
      intervalMs: INTERVAL,
      jitterMs: 0,
      random: () => 0,
      log: recordingLog(),
      run: () => {
        runs.push(runs.length);
        return Promise.resolve();
      },
    });

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(runs).toHaveLength(1);

    await scheduler.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);

    expect(runs).toHaveLength(1);
  });

  // Shutdown is where an abandoned pass shows up: the transaction rolls
  // back and the advisory lock releases either way, but a process that
  // exits with its own database work outstanding makes every shutdown a
  // source of noise nobody can tell from a real fault.
  it('waits for a pass already in flight rather than abandoning it', async () => {
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let passFinished = false;
    const scheduler = startScheduler({
      intervalMs: INTERVAL,
      jitterMs: 0,
      random: () => 0,
      log: recordingLog(),
      run: async () => {
        await held;
        passFinished = true;
      },
    });

    await vi.advanceTimersByTimeAsync(INTERVAL);

    let stopResolved = false;
    const stopping = scheduler.stop().then(() => {
      stopResolved = true;
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(passFinished).toBe(false);
    expect(stopResolved).toBe(false);

    release();
    await stopping;

    expect(passFinished).toBe(true);
    expect(stopResolved).toBe(true);
  });
});
