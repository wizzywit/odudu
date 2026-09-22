import { describe, expect, it } from 'vitest';
import { passwordExpired } from '#/service/password-age';

const CREATED_AT = new Date('2031-01-01T00:00:00.000Z');
const DAY_MS = 86_400_000;

function at(offsetMs: number): Date {
  return new Date(CREATED_AT.getTime() + offsetMs);
}

describe('passwordExpired', () => {
  it('never expires a password in a tenant whose maximum age is zero', () => {
    expect(passwordExpired({ createdAt: CREATED_AT }, 0, at(3650 * DAY_MS))).toBe(false);
  });

  it('leaves a password younger than the maximum age alone', () => {
    expect(passwordExpired({ createdAt: CREATED_AT }, 90, at(89 * DAY_MS))).toBe(false);
    expect(passwordExpired({ createdAt: CREATED_AT }, 90, at(90 * DAY_MS - 1))).toBe(false);
  });

  it('expires a password exactly at the maximum age', () => {
    expect(passwordExpired({ createdAt: CREATED_AT }, 90, at(90 * DAY_MS))).toBe(true);
  });

  it('expires a password past the maximum age', () => {
    expect(passwordExpired({ createdAt: CREATED_AT }, 90, at(91 * DAY_MS))).toBe(true);
  });

  // A limit read as milliseconds rather than days expires everything: 90ms
  // after it was set, a 90-day password would be gone.
  it('measures the limit in days, not milliseconds', () => {
    expect(passwordExpired({ createdAt: CREATED_AT }, 90, at(90))).toBe(false);
    expect(passwordExpired({ createdAt: CREATED_AT }, 1, at(23 * 3_600_000))).toBe(false);
    expect(passwordExpired({ createdAt: CREATED_AT }, 1, at(DAY_MS))).toBe(true);
  });

  // A clock that has gone backwards — a replica behind the writer, a manual
  // correction — makes the age negative, which is not an expiry.
  it('does not expire a password created after the instant it is judged at', () => {
    expect(passwordExpired({ createdAt: CREATED_AT }, 90, at(-DAY_MS))).toBe(false);
  });
});
