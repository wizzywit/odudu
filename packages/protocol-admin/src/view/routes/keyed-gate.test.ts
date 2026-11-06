import { describe, expect, it } from 'vitest';
import { createKeyedGate, keyedLimitFor } from '#/view/routes/keyed-gate';

describe('createKeyedGate', () => {
  it('never runs more than the limit at once, and runs every call', async () => {
    const gate = createKeyedGate(2);
    let running = 0;
    let peak = 0;
    const done: number[] = [];
    await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        gate.run(async () => {
          running += 1;
          peak = Math.max(peak, running);
          await new Promise((resolve) => setTimeout(resolve, 5));
          running -= 1;
          done.push(n);
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(done.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('frees its slot when a call throws', async () => {
    const gate = createKeyedGate(1);
    await expect(gate.run(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(await gate.run(() => Promise.resolve('next'))).toBe('next');
  });
});

describe('keyedLimitFor', () => {
  it('keeps two connections per call and one spare, and never goes below one', () => {
    expect(keyedLimitFor(10)).toBe(4);
    expect(keyedLimitFor(5)).toBe(2);
    expect(keyedLimitFor(2)).toBe(1);
    expect(keyedLimitFor(1)).toBe(1);
  });
});
