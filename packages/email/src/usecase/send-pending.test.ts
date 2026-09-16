import { describe, expect, it } from 'vitest';
import { retryDelaySeconds, type SendPendingOptions } from '#/usecase/send-pending';

const OPTIONS: SendPendingOptions = {
  batchSize: 20,
  maxAttempts: 5,
  retryBackoffSeconds: 60,
};

describe('how long a refused message waits', () => {
  // The first retry is the configured delay, not double it: `attempts` is
  // already incremented by the claim, so the first failure arrives here as
  // 1 rather than 0.
  it('waits the configured delay after the first failure', () => {
    expect(retryDelaySeconds(OPTIONS, 1)).toBe(60);
  });

  it('doubles for each further attempt', () => {
    expect([2, 3, 4, 5].map((attempts) => retryDelaySeconds(OPTIONS, attempts))).toEqual([
      120, 240, 480, 960,
    ]);
  });

  // A claim that somehow reported no attempt must still push the message
  // into the future, or the sender would spin on it.
  it('never returns nothing to wait', () => {
    expect(retryDelaySeconds(OPTIONS, 0)).toBe(60);
  });

  it('is measured from the configured base, not a constant of its own', () => {
    expect(retryDelaySeconds({ ...OPTIONS, retryBackoffSeconds: 5 }, 3)).toBe(20);
  });
});
