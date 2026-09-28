import { describe, expect, it } from 'vitest';
import { singleFlight } from '#/service/single-flight';

describe('singleFlight', () => {
  it('runs one call per key at a time and gives every waiter its result', async () => {
    const flight = singleFlight<string, number>();
    let runs = 0;
    let release: (value: number) => void = () => undefined;
    const run = (): Promise<number> => {
      runs += 1;
      return new Promise<number>((resolve) => {
        release = resolve;
      });
    };

    const first = flight('s1', run);
    const second = flight('s1', run);
    release(7);

    expect(await Promise.all([first, second])).toEqual([7, 7]);
    expect(runs).toBe(1);
  });

  it('runs again once the call in flight has settled', async () => {
    const flight = singleFlight<string, number>();
    let runs = 0;
    const run = (): Promise<number> => Promise.resolve((runs += 1));

    await flight('s1', run);
    await flight('s1', run);

    expect(runs).toBe(2);
  });

  it('keeps keys apart', async () => {
    const flight = singleFlight<string, string>();

    const results = await Promise.all([
      flight('a', () => Promise.resolve('a')),
      flight('b', () => Promise.resolve('b')),
    ]);

    expect(results).toEqual(['a', 'b']);
  });

  it('forgets a call that failed, so the next one runs', async () => {
    const flight = singleFlight<string, number>();

    await expect(flight('s1', () => Promise.reject(new Error('down')))).rejects.toThrow('down');

    expect(await flight('s1', () => Promise.resolve(1))).toBe(1);
  });
});
