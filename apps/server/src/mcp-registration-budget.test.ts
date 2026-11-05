import { describe, expect, it } from 'vitest';
import { mcpRegistrationBudget } from '#/mcp-registration-budget';

const START = 1_700_000_040_000;
let clock = START;
const now = () => new Date(clock);

function budget(perOrigin: number, perTenant: number) {
  clock = START;
  return mcpRegistrationBudget({
    perOrigin: { limit: perOrigin, windowSeconds: 3600 },
    perTenant: { limit: perTenant, windowSeconds: 3600 },
    now,
  });
}

describe('mcpRegistrationBudget', () => {
  it('refuses an origin past its own budget and leaves another origin alone', () => {
    const limiter = budget(2, 100);
    expect(limiter.check('t1', '198.51.100.7').allowed).toBe(true);
    expect(limiter.check('t1', '198.51.100.7').allowed).toBe(true);
    expect(limiter.check('t1', '198.51.100.7')).toMatchObject({ allowed: false, scope: 'address' });
    expect(limiter.check('t1', '203.0.113.9').allowed).toBe(true);
  });

  it('refuses every origin once the tenant has spent its own budget', () => {
    const limiter = budget(10, 3);
    for (const origin of ['10.0.0.1', '10.0.0.2', '10.0.0.3']) {
      expect(limiter.check('t1', origin).allowed).toBe(true);
    }
    const refused = limiter.check('t1', '10.0.0.4');
    expect(refused.allowed).toBe(false);
    expect(refused).toMatchObject({ scope: 'tenant' });
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(limiter.check('t2', '10.0.0.4').allowed).toBe(true);
  });

  it('does not let a refused origin spend the tenant budget', () => {
    const limiter = budget(1, 2);
    expect(limiter.check('t1', '10.0.0.1').allowed).toBe(true);
    for (let attempt = 0; attempt < 20; attempt += 1) limiter.check('t1', '10.0.0.1');
    expect(limiter.check('t1', '10.0.0.2').allowed).toBe(true);
  });

  it('opens again when the window has passed', () => {
    const limiter = budget(1, 1);
    expect(limiter.check('t1', '10.0.0.1').allowed).toBe(true);
    expect(limiter.check('t1', '10.0.0.2').allowed).toBe(false);
    clock += 3601 * 1000;
    expect(limiter.check('t1', '10.0.0.2').allowed).toBe(true);
  });
});
