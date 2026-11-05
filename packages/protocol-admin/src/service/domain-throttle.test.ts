import { describe, expect, it } from 'vitest';
import { createVerifyThrottle } from '#/service/domain-throttle';

const T0 = new Date('2026-11-04T12:00:00Z');
const at = (ms: number): Date => new Date(T0.getTime() + ms);
const options = { hostCooldownMs: 30_000, tenantLimit: 3, tenantWindowMs: 60_000, maxEntries: 4 };

describe('the verify throttle', () => {
  it('allows a tenant a host once per cooldown, and never makes one tenant wait for another', () => {
    const throttle = createVerifyThrottle(options);
    expect(throttle.take('a', 'login.acme.com', T0)).toEqual({ allowed: true });
    expect(throttle.take('a', 'login.acme.com', at(10_000))).toEqual({
      allowed: false,
      retryAfterSeconds: 20,
    });
    expect(throttle.take('b', 'login.acme.com', at(10_001))).toEqual({ allowed: true });
    expect(throttle.take('a', 'login.acme.com', at(29_999))).toMatchObject({ allowed: false });
    expect(throttle.take('a', 'login.acme.com', at(30_000))).toEqual({ allowed: true });
  });

  it('limits one tenant across hosts and says when its oldest lookup leaves the window', () => {
    const throttle = createVerifyThrottle(options);
    for (const [i, host] of ['a.x.com', 'b.x.com', 'c.x.com'].entries()) {
      expect(throttle.take('t', host, at(i * 1000))).toEqual({ allowed: true });
    }
    expect(throttle.take('t', 'd.x.com', at(5_000))).toEqual({
      allowed: false,
      retryAfterSeconds: 55,
    });
    expect(throttle.take('other', 'd.x.com', at(5_000))).toEqual({ allowed: true });
    expect(throttle.take('t', 'd.x.com', at(60_000))).toEqual({ allowed: true });
  });

  it('spends nothing from the tenant when the host is cooling down', () => {
    const throttle = createVerifyThrottle(options);
    throttle.take('t', 'a.x.com', T0);
    for (let i = 1; i < 10; i += 1) throttle.take('t', 'a.x.com', at(i));
    expect(throttle.take('t', 'b.x.com', at(100))).toEqual({ allowed: true });
    expect(throttle.take('t', 'c.x.com', at(101))).toEqual({ allowed: true });
  });

  it('holds no more than its bound, dropping the oldest', () => {
    const throttle = createVerifyThrottle({ ...options, tenantLimit: 100 });
    for (let i = 0; i < 10; i += 1) throttle.take('t', `h${String(i)}.x.com`, at(i));
    // h0 was dropped, so it is allowed again inside its cooldown; h9 is held.
    expect(throttle.take('t', 'h0.x.com', at(20))).toEqual({ allowed: true });
    expect(throttle.take('t', 'h9.x.com', at(21))).toMatchObject({ allowed: false });
  });
});
