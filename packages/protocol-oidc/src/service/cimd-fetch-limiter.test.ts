import { describe, expect, it } from 'vitest';
import { createFetchLimiter } from '#/service/cimd-fetch-limiter';

function setup(over: Partial<Parameters<typeof createFetchLimiter>[0]> = {}) {
  let now = 0;
  const limiter = createFetchLimiter({
    now: () => new Date(now),
    perHost: 3,
    perTenant: 5,
    windowMs: 60_000,
    maxHosts: 4,
    maxTenants: 4,
    ...over,
  });
  return {
    limiter,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createFetchLimiter', () => {
  it('admits up to the per-host count in a window, then refuses', () => {
    const { limiter } = setup();
    expect([1, 2, 3, 4].map(() => limiter.tryAcquire('t1', 'a.example'))).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('counts hosts separately', () => {
    const { limiter } = setup();
    for (let i = 0; i < 3; i += 1) limiter.tryAcquire('t1', 'a.example');
    expect(limiter.tryAcquire('t1', 'b.example')).toBe(true);
  });

  it('admits up to the per-tenant count across hosts, then refuses', () => {
    const { limiter } = setup();
    const results = ['a', 'b', 'c', 'd', 'e', 'f'].map((h) =>
      limiter.tryAcquire('t1', `${h}.example`),
    );
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(limiter.tryAcquire('t2', 'a.example')).toBe(true);
  });

  it('does not spend the tenant budget on a fetch the host budget refused', () => {
    const { limiter } = setup();
    for (let i = 0; i < 10; i += 1) limiter.tryAcquire('t1', 'a.example');
    // three admitted for a.example; the seven refused ones spent nothing
    expect(limiter.tryAcquire('t1', 'b.example')).toBe(true);
    expect(limiter.tryAcquire('t1', 'c.example')).toBe(true);
    expect(limiter.tryAcquire('t1', 'd.example')).toBe(false);
  });

  it('starts a new window once the old one has passed', () => {
    const { limiter, advance } = setup();
    for (let i = 0; i < 4; i += 1) limiter.tryAcquire('t1', 'a.example');
    advance(60_000);
    expect(limiter.tryAcquire('t1', 'a.example')).toBe(true);
  });

  it('tracks at most maxHosts hosts, evicting the oldest', () => {
    const { limiter } = setup({ perTenant: 1000 });
    for (let i = 0; i < 3; i += 1) limiter.tryAcquire('t1', 'a.example');
    for (const h of ['b', 'c', 'd', 'e']) limiter.tryAcquire('t1', `${h}.example`);
    expect(limiter.size()).toEqual({ hosts: 4, tenants: 1 });
    expect(limiter.tryAcquire('t1', 'a.example')).toBe(true);
  });

  it('tracks at most maxTenants tenants', () => {
    const { limiter } = setup();
    for (let i = 0; i < 9; i += 1) limiter.tryAcquire(`t${String(i)}`, `h${String(i)}.example`);
    expect(limiter.size().tenants).toBe(4);
  });

  it('does not evict a host budget for a request the tenant budget refused', () => {
    const { limiter } = setup({ perTenant: 2, perHost: 1, maxHosts: 2 });
    limiter.tryAcquire('t1', 'a.example');
    limiter.tryAcquire('t1', 'b.example');
    expect(limiter.tryAcquire('t1', 'c.example')).toBe(false);
    expect(limiter.size().hosts).toBe(2);
    expect(limiter.tryAcquire('t2', 'a.example')).toBe(false);
  });
});
