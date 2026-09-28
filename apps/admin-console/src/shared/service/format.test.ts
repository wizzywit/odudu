import { describe, expect, it } from 'vitest';
import { formatAbsolute, formatDuration, formatRelative } from '#/shared/service/format.ts';

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [1, '1 s'],
    [59, '59 s'],
    [60, '60 s · 1 minute'],
    [90, '90 s · 1 minute 30 seconds'],
    [3600, '3600 s · 1 hour'],
    [7260, '7260 s · 2 hours 1 minute'],
    [86400, '86400 s · 1 day'],
    [93784, '93784 s · 1 day 2 hours 3 minutes 4 seconds'],
    [1209600, '1209600 s · 14 days'],
    [31536000, '31536000 s · 365 days'],
    [-5, '-5 s'],
    [1.5, '1.5 s'],
  ])('reads %i seconds as "%s"', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});

describe('formatAbsolute', () => {
  it('gives the instant in UTC to the second', () => {
    expect(formatAbsolute(new Date('2026-09-28T14:03:22.917Z'))).toBe('2026-09-28 14:03:22 UTC');
  });
});

describe('formatRelative', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  it.each([
    ['2026-09-28T12:00:00Z', 'now'],
    ['2026-09-28T11:59:30Z', '30 seconds ago'],
    ['2026-09-28T11:57:00Z', '3 minutes ago'],
    ['2026-09-28T09:00:00Z', '3 hours ago'],
    ['2026-09-27T12:00:00Z', 'yesterday'],
    ['2026-09-14T12:00:00Z', '14 days ago'],
    ['2026-06-28T12:00:00Z', '3 months ago'],
    ['2024-09-28T12:00:00Z', '2 years ago'],
    ['2026-09-28T12:05:00Z', 'in 5 minutes'],
  ])('reads %s as "%s"', (iso, expected) => {
    expect(formatRelative(new Date(iso), now)).toBe(expected);
  });
});
