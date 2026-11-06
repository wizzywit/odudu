import { describe, expect, it } from 'vitest';
import { createToolLimiter, type ToolLimiterOptions } from '#/service/rate-limit';

function clock(start = Date.parse('2026-11-06T10:00:00Z')) {
  let t = start;
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

function limiter(over: Partial<ToolLimiterOptions> = {}, c = clock()) {
  return {
    c,
    l: createToolLimiter({
      now: c.now,
      perPrincipal: { limit: 3, windowSeconds: 60 },
      perTenant: { limit: 5, windowSeconds: 60 },
      maxPrincipals: 4,
      maxTenants: 3,
      maxConcurrentPerPrincipal: 2,
      ...over,
    }),
  };
}

describe('the per-principal budget', () => {
  it('admits the limit and refuses the next with the seconds until the window ends', () => {
    const { l, c } = limiter();
    for (let i = 0; i < 3; i += 1) {
      const a = l.admit('t1', 'p1');
      expect(a.admitted).toBe(true);
      if (a.admitted) a.release();
    }
    c.advance(20_000);
    const refused = l.admit('t1', 'p1');
    expect(refused).toEqual({ admitted: false, reason: 'principal', retryAfterSeconds: 40 });
  });

  it('opens a new window once the old one has passed', () => {
    const { l, c } = limiter();
    for (let i = 0; i < 3; i += 1) {
      const a = l.admit('t1', 'p1');
      if (a.admitted) a.release();
    }
    expect(l.admit('t1', 'p1').admitted).toBe(false);
    c.advance(60_000);
    expect(l.admit('t1', 'p1').admitted).toBe(true);
  });

  it('keeps one principal from spending another’s budget, in the same tenant or another', () => {
    const { l } = limiter();
    for (let i = 0; i < 3; i += 1) {
      const a = l.admit('t1', 'p1');
      if (a.admitted) a.release();
    }
    expect(l.admit('t1', 'p1').admitted).toBe(false);
    expect(l.admit('t1', 'p2').admitted).toBe(true);
    expect(l.admit('t2', 'p1').admitted).toBe(true);
  });
});

describe('the per-tenant budget', () => {
  it('refuses every principal of a tenant once the tenant has spent its own', () => {
    const { l } = limiter({ perPrincipal: { limit: 3, windowSeconds: 60 } });
    for (const p of ['a', 'b']) {
      for (let i = 0; i < 3 && !(p === 'b' && i === 2); i += 1) {
        const a = l.admit('t1', p);
        if (a.admitted) a.release();
      }
    }
    const refused = l.admit('t1', 'c');
    expect(refused).toMatchObject({ admitted: false, reason: 'tenant' });
    expect(l.admit('t2', 'c').admitted).toBe(true);
  });

  it('spends no principal budget on a call the tenant budget refused', () => {
    const { l, c } = limiter({ perTenant: { limit: 1, windowSeconds: 60 } });
    const first = l.admit('t1', 'a');
    if (first.admitted) first.release();
    expect(l.admit('t1', 'b')).toMatchObject({ admitted: false, reason: 'tenant' });
    c.advance(60_000);
    for (let i = 0; i < 1; i += 1) expect(l.admit('t1', 'b').admitted).toBe(true);
  });
});

describe('concurrency', () => {
  it('refuses a call while the principal already has the most it may have in flight', () => {
    const { l } = limiter();
    const one = l.admit('t1', 'p1');
    const two = l.admit('t1', 'p1');
    expect(one.admitted && two.admitted).toBe(true);
    expect(l.admit('t1', 'p1')).toMatchObject({ admitted: false, reason: 'concurrency' });
    if (one.admitted) one.release();
    expect(l.admit('t1', 'p1').admitted).toBe(true);
  });

  it('counts a refused-for-concurrency call against no budget', () => {
    const { l } = limiter({ perPrincipal: { limit: 2, windowSeconds: 60 } });
    const one = l.admit('t1', 'p1');
    const two = l.admit('t1', 'p1');
    for (let i = 0; i < 5; i += 1) l.admit('t1', 'p1');
    if (one.admitted) one.release();
    if (two.admitted) two.release();
    expect(l.admit('t1', 'p1')).toMatchObject({ admitted: false, reason: 'principal' });
  });

  it('releases once however often release is called', () => {
    const { l } = limiter();
    const one = l.admit('t1', 'p1');
    if (!one.admitted) throw new Error('admitted');
    one.release();
    one.release();
    one.release();
    expect(l.size().inFlight).toBe(0);
    const a = l.admit('t1', 'p1');
    const b = l.admit('t1', 'p1');
    expect(a.admitted && b.admitted).toBe(true);
    expect(l.admit('t1', 'p1')).toMatchObject({ reason: 'concurrency' });
  });

  it('holds no entry for a principal with nothing in flight', () => {
    const { l } = limiter();
    const a = l.admit('t1', 'p1');
    if (a.admitted) a.release();
    expect(l.size().inFlight).toBe(0);
  });
});

describe('the bounds', () => {
  it('remembers at most the principals and tenants it is allowed, dropping the coldest', () => {
    const { l } = limiter({ perPrincipal: { limit: 100, windowSeconds: 60 } });
    for (let i = 0; i < 50; i += 1) {
      const a = l.admit(`t${String(i)}`, `p${String(i)}`);
      if (a.admitted) a.release();
    }
    expect(l.size().principals).toBeLessThanOrEqual(4);
    expect(l.size().tenants).toBeLessThanOrEqual(3);
  });

  it('keeps a recently used principal over a colder one', () => {
    const { l } = limiter({ maxPrincipals: 2, perPrincipal: { limit: 1, windowSeconds: 60 } });
    const hot = l.admit('t1', 'hot');
    if (hot.admitted) hot.release();
    const cold = l.admit('t1', 'cold');
    if (cold.admitted) cold.release();
    expect(l.admit('t1', 'hot').admitted).toBe(false);
    const other = l.admit('t1', 'other');
    if (other.admitted) other.release();
    expect(l.admit('t1', 'hot').admitted).toBe(false);
  });

  it('drops a window that has ended instead of keeping it', () => {
    const { l, c } = limiter();
    const a = l.admit('t1', 'p1');
    if (a.admitted) a.release();
    c.advance(120_000);
    const b = l.admit('t1', 'p2');
    if (b.admitted) b.release();
    expect(l.size().principals).toBe(1);
  });
});
