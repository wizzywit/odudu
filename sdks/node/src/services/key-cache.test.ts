import { describe, expect, it } from 'vitest';
import { MAX_ISSUERS, TimedCache } from '#/services/key-cache';

describe('the per-issuer cache', () => {
  it('holds at most 256 issuers, dropping the oldest', () => {
    const cache = new TimedCache<number>();
    for (let i = 0; i < MAX_ISSUERS + 5; i += 1)
      cache.set(`issuer-${String(i)}`, Promise.resolve(i), 0, 1_000);
    expect(cache.size).toBe(MAX_ISSUERS);
    expect(cache.get('issuer-0', 0)).toBeUndefined();
    expect(cache.get(`issuer-${String(MAX_ISSUERS + 4)}`, 0)).toBeDefined();
  });

  it('forgets an entry once its time has passed', () => {
    const cache = new TimedCache<number>();
    cache.set('a', Promise.resolve(1), 100, 50);
    expect(cache.get('a', 149)).toBeDefined();
    expect(cache.get('a', 150)).toBeUndefined();
  });
});
