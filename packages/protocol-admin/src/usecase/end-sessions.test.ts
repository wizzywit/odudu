import { describe, expect, it } from 'vitest';
import { inBatches, type BatchOutcome } from '#/usecase/end-sessions';

function batches(...outcomes: (BatchOutcome | Error)[]): {
  run: () => Promise<BatchOutcome>;
  calls: () => number;
} {
  let n = 0;
  return {
    run: () => {
      const next = outcomes[n];
      n += 1;
      if (next === undefined) return Promise.reject(new Error('no batch left'));
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    calls: () => n,
  };
}

describe('inBatches', () => {
  it('runs batches until none remain, and sums what they ended', async () => {
    const fake = batches(
      { ended: 500, remaining: 700 },
      { ended: 500, remaining: 200 },
      { ended: 200, remaining: 0 },
    );
    expect(await inBatches(fake.run)).toEqual({ ended: 1200, remaining: 0 });
    expect(fake.calls()).toBe(3);
  });

  it('stops at a batch that ends nothing, rather than spinning on it', async () => {
    const fake = batches({ ended: 0, remaining: 3 });
    expect(await inBatches(fake.run)).toEqual({ ended: 0, remaining: 3 });
    expect(fake.calls()).toBe(1);
  });

  it('hands back a failing batch with what was ended before it', async () => {
    const failure = new Error('connection lost');
    const fake = batches({ ended: 500, remaining: 1 }, failure);
    expect(await inBatches(fake.run)).toEqual({ ended: 500, remaining: 1, failure });
  });

  it('knows nothing of what remains when the first batch fails', async () => {
    const failure = new Error('connection lost');
    expect(await inBatches(batches(failure).run)).toEqual({
      ended: 0,
      remaining: null,
      failure,
    });
  });
});
