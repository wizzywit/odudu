import { type Logger } from '@odudu/kernel';

export interface SchedulerOptions {
  readonly intervalMs: number;
  /** Width of the band added to the interval; zero pins every tick to it. */
  readonly jitterMs: number;
  readonly run: () => Promise<void>;
  readonly log: Logger;
  /** Only a test overrides this, to make the next tick predictable. */
  readonly random?: () => number;
}

export interface Scheduler {
  /** Resolves once no pass is running and none will start. */
  readonly stop: () => Promise<void>;
}

/**
 * Never earlier than the interval, never later than the interval plus the
 * jitter. Added rather than centred: replicas that booted together stop
 * arriving in the same second without any of them running sooner than the
 * interval an operator configured.
 */
export function nextDelayMs(intervalMs: number, jitterMs: number, random: number): number {
  return intervalMs + Math.floor(random * jitterMs);
}

/**
 * A timer that calls one function on an interval and holds nothing else —
 * no work of its own, and no knowledge of what the pass does. See ADR 0024
 * for why the pass it drives is a command first and a schedule second.
 */
export function startScheduler(options: SchedulerOptions): Scheduler {
  const random = options.random ?? Math.random;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;
  let inFlight: Promise<void> | undefined;

  function schedule(): void {
    if (stopped) return;
    timer = setTimeout(
      () => {
        inFlight = tick();
      },
      nextDelayMs(options.intervalMs, options.jitterMs, random()),
    );
  }

  async function tick(): Promise<void> {
    try {
      await options.run();
    } catch (err) {
      // Logged and swallowed deliberately. A pass that throws is a pass
      // that did not happen; ending the loop over it would stop reaping
      // for the life of the process, and nothing would report that.
      options.log.error({ err }, 'the scheduled pass failed; the next one runs on schedule');
    }
    schedule();
  }

  schedule();

  return {
    stop: async () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      // A pass abandoned mid-transaction rolls back and releases its lock,
      // so this is not a correctness matter; it is what keeps shutdown
      // from logging a fault that never happened.
      await inFlight;
    },
  };
}
