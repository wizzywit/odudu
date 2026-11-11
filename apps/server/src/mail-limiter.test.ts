import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mailGate, MAIL_LIMIT, MAIL_WINDOW_SECONDS } from '#/mail-limiter';

describe('the per-address mail bound', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-23T09:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const gate = () => mailGate(() => new Date());

  it('allows three an hour to one address, then none until the window has passed', () => {
    const allow = gate();
    const results = Array.from({ length: MAIL_LIMIT + 2 }, () =>
      allow('registration', 't1', 'ada@example.test'),
    );
    expect(results).toEqual([true, true, true, false, false]);

    vi.advanceTimersByTime((MAIL_WINDOW_SECONDS + 1) * 1000);
    expect(allow('registration', 't1', 'ada@example.test')).toBe(true);
  });

  it('counts an address once whatever its case, and one tenant apart from another', () => {
    const allow = gate();
    for (const spelling of ['ada@example.test', 'ADA@Example.test', 'Ada@example.test']) {
      expect(allow('registration', 't1', spelling)).toBe(true);
    }
    expect(allow('registration', 't1', 'aDa@example.test')).toBe(false);
    expect(allow('registration', 't2', 'ada@example.test')).toBe(true);
  });

  it('keeps a budget for each kind, so a flood of one cannot silence another', () => {
    const allow = gate();
    for (let i = 0; i < MAIL_LIMIT + 2; i += 1) allow('registration', 't1', 'ada@example.test');
    expect(allow('registration', 't1', 'ada@example.test')).toBe(false);
    expect(allow('reset', 't1', 'ada@example.test')).toBe(true);
    expect(allow('held', 't1', 'ada@example.test')).toBe(true);
  });

  it('keeps addresses apart', () => {
    const allow = gate();
    for (let i = 0; i < MAIL_LIMIT; i += 1) allow('registration', 't1', 'ada@example.test');
    expect(allow('registration', 't1', 'bea@example.test')).toBe(true);
  });

  it('forgets the coldest address past its cap rather than growing', () => {
    const allow = mailGate(() => new Date(), 2);
    for (let i = 0; i < MAIL_LIMIT; i += 1) allow('registration', 't1', 'a@example.test');
    expect(allow('registration', 't1', 'a@example.test')).toBe(false);
    allow('registration', 't1', 'b@example.test');
    allow('registration', 't1', 'c@example.test');
    expect(allow('registration', 't1', 'a@example.test')).toBe(true);
  });

  it('keeps a proof of a changed address apart from a registration to the same address', () => {
    const allow = gate();
    for (let i = 0; i < MAIL_LIMIT; i += 1) allow('change', 't1', 'ada@example.test');
    expect(allow('change', 't1', 'ada@example.test')).toBe(false);
    expect(allow('registration', 't1', 'ada@example.test')).toBe(true);
  });
});
