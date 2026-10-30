import { describe, expect, it } from 'vitest';
import { brandingCache, createBrandingCache } from '#/service/branding-cache';

function cacheAt(clock: { now: number }, options = {}) {
  return createBrandingCache<string | null>({ now: () => clock.now, ...options });
}

describe('brandingCache', () => {
  it('states the bound the spec gives', () => {
    expect(brandingCache.maxEntries).toBe(5000);
    expect(brandingCache.ttlMs).toBe(30_000);
  });
});

describe('createBrandingCache', () => {
  it('the cache never holds more than maxEntries', () => {
    const cache = cacheAt({ now: 0 });
    const total = brandingCache.maxEntries * 3;
    for (let i = 0; i < total; i += 1) {
      cache.set(`t:${String(i)}`, 't', 'v', 10, cache.generation('t'));
      expect(cache.size()).toBeLessThanOrEqual(brandingCache.maxEntries);
    }
    expect(cache.size()).toBe(brandingCache.maxEntries);
    expect(cache.get('t:0')).toBeUndefined();
    expect(cache.get(`t:${String(total - 1)}`)).toEqual({ value: 'v' });
  });

  it('never holds more than maxBytes of weight', () => {
    const cache = cacheAt({ now: 0 }, { maxBytes: 100 });
    for (let i = 0; i < 20; i += 1) cache.set(`k${String(i)}`, 't', 'v', 30, cache.generation('t'));
    expect(cache.size()).toBe(3);
    cache.set('big', 't', 'v', 101, cache.generation('t'));
    expect(cache.get('big')).toBeUndefined();
  });

  it('evicts the least recently used entry first', () => {
    const cache = cacheAt({ now: 0 }, { maxEntries: 2 });
    cache.set('a', 't', 'a', 1, 0);
    cache.set('b', 't', 'b', 1, 0);
    cache.get('a');
    cache.set('c', 't', 'c', 1, 0);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual({ value: 'a' });
    expect(cache.get('c')).toEqual({ value: 'c' });
  });

  it('answers a stored null as an entry, not as a miss', () => {
    const cache = cacheAt({ now: 0 });
    cache.set('a', 't', null, 1, 0);
    expect(cache.get('a')).toEqual({ value: null });
  });

  it('forgets an entry after the ttl', () => {
    const clock = { now: 0 };
    const cache = cacheAt(clock);
    cache.set('a', 't', 'a', 1, 0);
    clock.now = brandingCache.ttlMs - 1;
    expect(cache.get('a')).toEqual({ value: 'a' });
    clock.now = brandingCache.ttlMs;
    expect(cache.get('a')).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it('publishing invalidates the entry', () => {
    const cache = cacheAt({ now: 0 });
    cache.set('t1:', 't1', 'a', 1, 0);
    cache.set('t1:web', 't1', 'a', 1, 0);
    cache.set('t2:', 't2', 'b', 1, 0);
    cache.invalidateTenant('t1');
    expect(cache.get('t1:')).toBeUndefined();
    expect(cache.get('t1:web')).toBeUndefined();
    expect(cache.get('t2:')).toEqual({ value: 'b' });
  });

  it('ignores a fill that began before an invalidation', () => {
    const cache = cacheAt({ now: 0 });
    const began = cache.generation('t1');
    cache.invalidateTenant('t1');
    cache.set('t1:', 't1', 'stale', 1, began);
    expect(cache.get('t1:')).toBeUndefined();
  });

  it('counts invalidations per tenant', () => {
    const cache = cacheAt({ now: 0 });
    const other = cache.generation('t2');
    cache.invalidateTenant('t1');
    expect(cache.generation('t2')).toBe(other);
    cache.set('t2:', 't2', 'v', 1, other);
    expect(cache.get('t2:')).toEqual({ value: 'v' });
  });

  it('never lets a forgotten tenant take a stale generation back', () => {
    const cache = createBrandingCache<string>({ now: () => 0, maxTenants: 2 });
    const held = cache.generation('t1');
    cache.invalidateTenant('t1');
    cache.invalidateTenant('t2');
    cache.invalidateTenant('t3');
    cache.set('t1:', 't1', 'stale', 1, held);
    expect(cache.get('t1:')).toBeUndefined();
  });
});
