import { describe, expect, it } from 'vitest';
import { createToolLimiter, type ToolLimiterOptions } from '#/service/rate-limit';

function clock(start = Date.parse('2026-11-06T10:00:00Z')) {
  let t = start;
  return {
    now: () => new Date(t),
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function limiter(over: Partial<ToolLimiterOptions> = {}, c = clock()) {
  return {
    c,
    l: createToolLimiter({
      now: c.now,
      perPrincipal: { limit: 3, windowSeconds: 60 },
      perSubject: { limit: 100, windowSeconds: 60 },
      perTenant: { limit: 500, windowSeconds: 60 },
      maxPrincipals: 4,
      maxSubjects: 4,
      maxTenants: 3,
      maxConcurrentPerPrincipal: 2,
      ...over,
    }),
  };
}

type L = ReturnType<typeof limiter>['l'];

function spend(l: L, tenant: string, subject: string, client = 'c', times = 1): number {
  let admitted = 0;
  for (let i = 0; i < times; i += 1) {
    const a = l.admit(tenant, subject, client);
    if (a.admitted) {
      admitted += 1;
      a.release();
    }
  }
  return admitted;
}

describe('the per-principal budget', () => {
  it('admits the limit, then refuses with the time until a call would be admitted again', () => {
    const { l, c } = limiter();
    expect(spend(l, 't1', 's1', 'c', 3)).toBe(3);
    c.advance(20_000);
    const refused = l.admit('t1', 's1', 'c');
    expect(refused).toMatchObject({ admitted: false, reason: 'principal' });
    if (refused.admitted) throw new Error('admitted');
    expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(60);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(61);
  });

  it('admits again once the seconds it said have passed', () => {
    const { l, c } = limiter();
    spend(l, 't1', 's1', 'c', 3);
    const refused = l.admit('t1', 's1', 'c');
    if (refused.admitted) throw new Error('admitted');
    c.advance(refused.retryAfterSeconds * 1000);
    expect(l.admit('t1', 's1', 'c').admitted).toBe(true);
  });

  it('bounds a burst across a window boundary, which fixed windows would double', () => {
    const { l, c } = limiter({
      perPrincipal: { limit: 60, windowSeconds: 60 },
      perSubject: { limit: 1000, windowSeconds: 60 },
      perTenant: { limit: 1000, windowSeconds: 60 },
    });
    c.advance(59_000);
    expect(spend(l, 't1', 's1', 'c', 60)).toBe(60);
    c.advance(2_000);
    expect(spend(l, 't1', 's1', 'c', 60)).toBeLessThanOrEqual(2);
  });

  it('lets the budget back at the rate it is spent over a quiet minute', () => {
    const { l, c } = limiter({
      perPrincipal: { limit: 60, windowSeconds: 60 },
      perSubject: { limit: 1000, windowSeconds: 60 },
      perTenant: { limit: 1000, windowSeconds: 60 },
    });
    spend(l, 't1', 's1', 'c', 60);
    c.advance(120_000);
    expect(spend(l, 't1', 's1', 'c', 60)).toBe(60);
  });

  it('keeps one principal from spending another’s, in the same tenant or another', () => {
    const { l } = limiter();
    spend(l, 't1', 's1', 'c', 3);
    expect(l.admit('t1', 's1', 'c').admitted).toBe(false);
    expect(l.admit('t1', 's2', 'c').admitted).toBe(true);
    expect(l.admit('t2', 's1', 'c').admitted).toBe(true);
  });
});

describe('the per-subject budget', () => {
  it('stops one person spending the tenant with many clients', () => {
    const { l } = limiter({ perSubject: { limit: 4, windowSeconds: 60 } });
    expect(spend(l, 't1', 's1', 'c1', 3)).toBe(3);
    expect(spend(l, 't1', 's1', 'c2', 3)).toBe(1);
    expect(l.admit('t1', 's1', 'c3')).toMatchObject({ admitted: false, reason: 'subject' });
    expect(l.admit('t1', 's2', 'c1').admitted).toBe(true);
  });

  it('is one person’s in one tenant only', () => {
    const { l } = limiter({ perSubject: { limit: 1, windowSeconds: 60 } });
    spend(l, 't1', 's1', 'c', 1);
    expect(l.admit('t1', 's1', 'other').admitted).toBe(false);
    expect(l.admit('t2', 's1', 'c').admitted).toBe(true);
  });
});

describe('the per-tenant budget', () => {
  it('refuses every principal of a tenant once the tenant has spent its own', () => {
    const { l } = limiter({ perTenant: { limit: 4, windowSeconds: 60 } });
    spend(l, 't1', 'a', 'c', 3);
    spend(l, 't1', 'b', 'c', 1);
    expect(l.admit('t1', 'c', 'c')).toMatchObject({ admitted: false, reason: 'tenant' });
    expect(l.admit('t2', 'c', 'c').admitted).toBe(true);
  });

  it('spends no principal or subject budget on a call the tenant refused', () => {
    const { l, c } = limiter({ perTenant: { limit: 1, windowSeconds: 60 } });
    spend(l, 't1', 'a', 'c', 1);
    for (let i = 0; i < 5; i += 1) l.admit('t1', 'b', 'c');
    c.advance(120_000);
    expect(spend(l, 't1', 'b', 'c', 3)).toBe(1);
  });
});

describe('concurrency', () => {
  it('refuses a call while the principal already has the most it may have in flight', () => {
    const { l } = limiter();
    const one = l.admit('t1', 's1', 'c');
    const two = l.admit('t1', 's1', 'c');
    expect(one.admitted && two.admitted).toBe(true);
    expect(l.admit('t1', 's1', 'c')).toMatchObject({ admitted: false, reason: 'concurrency' });
    if (one.admitted) one.release();
    expect(l.admit('t1', 's1', 'c').admitted).toBe(true);
  });

  it('counts a call refused for concurrency against no budget', () => {
    const { l } = limiter({ perPrincipal: { limit: 2, windowSeconds: 60 } });
    const one = l.admit('t1', 's1', 'c');
    const two = l.admit('t1', 's1', 'c');
    for (let i = 0; i < 5; i += 1) l.admit('t1', 's1', 'c');
    if (one.admitted) one.release();
    if (two.admitted) two.release();
    expect(l.admit('t1', 's1', 'c')).toMatchObject({ admitted: false, reason: 'principal' });
  });

  it('releases once however often release is called', () => {
    const { l } = limiter();
    const one = l.admit('t1', 's1', 'c');
    if (!one.admitted) throw new Error('admitted');
    one.release();
    one.release();
    one.release();
    expect(l.size().inFlight).toBe(0);
    const a = l.admit('t1', 's1', 'c');
    const b = l.admit('t1', 's1', 'c');
    expect(a.admitted && b.admitted).toBe(true);
    expect(l.admit('t1', 's1', 'c')).toMatchObject({ reason: 'concurrency' });
  });
});

describe('the bounds', () => {
  it('remembers at most the keys it is allowed, dropping the coldest', () => {
    const { l } = limiter({ perPrincipal: { limit: 100, windowSeconds: 60 } });
    for (let i = 0; i < 50; i += 1) spend(l, `t${String(i)}`, `s${String(i)}`);
    const size = l.size();
    expect(size.principals).toBeLessThanOrEqual(4);
    expect(size.subjects).toBeLessThanOrEqual(4);
    expect(size.tenants).toBeLessThanOrEqual(3);
  });

  it('keeps a principal that keeps asking past its budget over a colder one', () => {
    const { l } = limiter({ maxPrincipals: 2, perPrincipal: { limit: 1, windowSeconds: 60 } });
    spend(l, 't1', 'hot');
    spend(l, 't1', 'cold');
    expect(l.admit('t1', 'hot', 'c').admitted).toBe(false);
    spend(l, 't1', 'other');
    expect(l.admit('t1', 'hot', 'c').admitted).toBe(false);
  });

  it('drops what two windows have passed over', () => {
    const { l, c } = limiter();
    spend(l, 't1', 's1');
    c.advance(130_000);
    spend(l, 't1', 's2');
    expect(l.size().principals).toBe(1);
  });
});
