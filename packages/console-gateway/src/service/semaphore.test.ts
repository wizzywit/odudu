import { describe, expect, it } from 'vitest';
import { refreshConcurrency, semaphore } from '#/service/semaphore';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('semaphore', () => {
  it('runs at most its limit at once and starts a waiter as one finishes', async () => {
    const limited = semaphore(2);
    let running = 0;
    let peak = 0;
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const runs = gates.map((gate, index) =>
      limited(async () => {
        running += 1;
        peak = Math.max(peak, running);
        started.push(index);
        await gate.promise;
        running -= 1;
      }),
    );
    await Promise.resolve();

    expect(started).toEqual([0, 1]);
    gates[0]?.resolve();
    await runs[0];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2]);
    gates[1]?.resolve();
    gates[2]?.resolve();
    await Promise.all(runs);
    expect(peak).toBe(2);
  });

  it('releases its slot when a run fails', async () => {
    const limited = semaphore(1);

    await expect(limited(() => Promise.reject(new Error('down')))).rejects.toThrow('down');

    expect(await limited(() => Promise.resolve(1))).toBe(1);
  });
});

describe('refreshConcurrency', () => {
  it.each([
    [10, 2],
    [8, 2],
    [7, 1],
    [5, 1],
    [4, 1],
    [1, 1],
  ])('allows a pool of %i connections %i refreshes at once', (max, expected) => {
    expect(refreshConcurrency(max)).toBe(expected);
  });
});
