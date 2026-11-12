import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_POOL_MAX } from '@odudu/db';
import { BREACHED_LOOKUPS_IN_PROCESS, createBreachedRangeFetch } from '#/breached-range-transport';

const URL_OF = new URL('https://api.pwnedpasswords.com/range/5BAA6');
const LIMIT = { timeoutMs: 3000, maxBytes: 4096 };

function fakeRequest() {
  return vi.fn().mockResolvedValue({
    status: 200,
    contentType: 'text/plain',
    cacheControl: null,
    body: 'ABC:1',
  });
}

describe('createBreachedRangeFetch', () => {
  it('connects to the address the lookup returned and hands back status and body', async () => {
    const request = fakeRequest();
    const fetchRange = createBreachedRangeFetch({
      lookup: () => Promise.resolve(['203.0.113.7']),
      requestFor: () => request,
    });

    expect(await fetchRange(URL_OF, LIMIT)).toEqual({ status: 200, body: 'ABC:1' });
    expect(request).toHaveBeenCalledWith(URL_OF, '203.0.113.7');
  });

  it('builds the request from the caller’s time and size bounds', async () => {
    const requestFor = vi.fn().mockReturnValue(fakeRequest());
    const fetchRange = createBreachedRangeFetch({
      lookup: () => Promise.resolve(['203.0.113.7']),
      requestFor,
    });

    await fetchRange(URL_OF, LIMIT);

    expect(requestFor).toHaveBeenCalledWith(LIMIT);
  });

  it('refuses any host but the fixed one, before resolving it', async () => {
    const lookup = vi.fn().mockResolvedValue(['203.0.113.7']);
    const fetchRange = createBreachedRangeFetch({ lookup, requestFor: () => fakeRequest() });

    await expect(fetchRange(new URL('https://evil.example/range/5BAA6'), LIMIT)).rejects.toThrow(
      /fixed host/u,
    );
    expect(lookup).not.toHaveBeenCalled();
  });

  it('refuses a path that is not a five-character range', async () => {
    const fetchRange = createBreachedRangeFetch({
      lookup: () => Promise.resolve(['203.0.113.7']),
      requestFor: () => fakeRequest(),
    });

    for (const bad of ['/range/5BAA61E4C9B93F3F', '/range/5BAA6/extra', '/other/5BAA6']) {
      await expect(
        fetchRange(new URL(`https://api.pwnedpasswords.com${bad}`), LIMIT),
      ).rejects.toThrow(/range/u);
    }
    await expect(
      fetchRange(new URL('https://api.pwnedpasswords.com/range/5BAA6?x=1'), LIMIT),
    ).rejects.toThrow(/range/u);
  });

  it('refuses an address that is not public, and sends nothing to it', async () => {
    const request = fakeRequest();
    const fetchRange = createBreachedRangeFetch({
      lookup: () => Promise.resolve(['10.0.0.5']),
      requestFor: () => request,
    });

    await expect(fetchRange(URL_OF, LIMIT)).rejects.toThrow(/private address/u);
    expect(request).not.toHaveBeenCalled();
  });

  it('admits a private address only when explicitly allowed', async () => {
    const fetchRange = createBreachedRangeFetch({
      lookup: () => Promise.resolve(['10.0.0.5']),
      allowPrivate: true,
      requestFor: () => fakeRequest(),
    });

    expect((await fetchRange(URL_OF, LIMIT)).status).toBe(200);
  });
});

describe('BREACHED_LOOKUPS_IN_PROCESS', () => {
  it('is at least one and below the pool size', () => {
    expect(BREACHED_LOOKUPS_IN_PROCESS).toBeGreaterThan(0);
    expect(BREACHED_LOOKUPS_IN_PROCESS).toBeLessThan(DEFAULT_POOL_MAX);
  });
});
