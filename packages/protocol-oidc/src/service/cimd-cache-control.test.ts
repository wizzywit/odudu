import { describe, expect, it } from 'vitest';
import {
  cimdCacheSeconds,
  CIMD_CACHE_MAX_SECONDS,
  CIMD_CACHE_MIN_SECONDS,
} from '#/service/cimd-cache-control';

describe('cimdCacheSeconds', () => {
  it('takes the lifetime from max-age', () => {
    expect(cimdCacheSeconds('public, max-age=3600')).toBe(3600);
  });

  it('clamps a short lifetime up to one minute and a long one down to a day', () => {
    expect(cimdCacheSeconds('max-age=0')).toBe(CIMD_CACHE_MIN_SECONDS);
    expect(cimdCacheSeconds('max-age=5')).toBe(60);
    expect(cimdCacheSeconds('max-age=31536000')).toBe(CIMD_CACHE_MAX_SECONDS);
    expect(CIMD_CACHE_MAX_SECONDS).toBe(86_400);
  });

  it('never caches no-store, whatever else the header says', () => {
    expect(cimdCacheSeconds('no-store')).toBeNull();
    expect(cimdCacheSeconds('max-age=3600, No-Store')).toBeNull();
    expect(cimdCacheSeconds('no-store, max-age=3600')).toBeNull();
  });

  it('never caches a response that must be revalidated, since none can be', () => {
    expect(cimdCacheSeconds('no-cache')).toBeNull();
  });

  it('keeps a response with no stated freshness for the shortest time', () => {
    expect(cimdCacheSeconds(null)).toBe(60);
    expect(cimdCacheSeconds('public')).toBe(60);
    expect(cimdCacheSeconds('max-age=abc')).toBe(60);
    expect(cimdCacheSeconds('max-age=-5')).toBe(60);
  });

  it('reads directive names case-insensitively and ignores a quoted value form', () => {
    expect(cimdCacheSeconds('MAX-AGE=120')).toBe(120);
    expect(cimdCacheSeconds('max-age="120"')).toBe(120);
  });

  it('does not read a directive that only contains no-store as part of its name', () => {
    expect(cimdCacheSeconds('x-no-store=1, max-age=300')).toBe(300);
  });
});
