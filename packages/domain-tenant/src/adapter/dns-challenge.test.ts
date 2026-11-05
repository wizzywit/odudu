import { afterEach, describe, expect, it, vi } from 'vitest';
import { dnsChallengeResolver } from '#/adapter/dns-challenge';

afterEach(() => {
  vi.useRealTimers();
});

describe('dnsChallengeResolver', () => {
  it('returns what the lookup resolves', async () => {
    const resolve = dnsChallengeResolver({ lookup: () => Promise.resolve([['a', 'b']]) });
    expect(await resolve('x.example.com')).toEqual([['a', 'b']]);
  });

  it('passes a lookup error through', async () => {
    const resolve = dnsChallengeResolver({ lookup: () => Promise.reject(new Error('ENOTFOUND')) });
    await expect(resolve('x.example.com')).rejects.toThrow('ENOTFOUND');
  });

  it('rejects a lookup that outlives its timeout', async () => {
    vi.useFakeTimers();
    const resolve = dnsChallengeResolver({
      timeoutMs: 1000,
      lookup: () => new Promise<string[][]>(() => undefined),
    });
    const outcome = expect(resolve('x.example.com')).rejects.toThrow(/timed out/u);
    await vi.advanceTimersByTimeAsync(1000);
    await outcome;
  });
});
