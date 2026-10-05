import { describe, expect, it } from 'vitest';
import {
  andList,
  counted,
  describeId,
  describeIds,
  flagText,
  formatAbsolute,
  formatDuration,
  formatRelative,
  sentence,
} from '#/shared/service/format.ts';

describe('formatDuration', () => {
  it.each([
    [0, '0 s'],
    [1, '1 s'],
    [59, '59 s'],
    [3599, '3599 s · 59 minutes 59 seconds'],
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
    [90.4, '90.4 s · 1 minute 30 seconds'],
    [89.6, '89.6 s · 1 minute 30 seconds'],
    [Number.NaN, '—'],
    [Number.POSITIVE_INFINITY, '—'],
    [Number.NEGATIVE_INFINITY, '—'],
  ])('reads %s seconds as "%s"', (seconds, expected) => {
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

describe('andList', () => {
  it('joins with "and", and an Oxford comma never', () => {
    expect(andList([])).toBe('');
    expect(andList(['a'])).toBe('a');
    expect(andList(['a', 'b'])).toBe('a and b');
    expect(andList(['a', 'b', 'c'])).toBe('a, b and c');
  });
});

describe('sentence', () => {
  it('capitalises and ends with one full stop', () => {
    expect(sentence('that name is taken')).toBe('That name is taken.');
    expect(sentence('Already there.')).toBe('Already there.');
    expect(sentence('')).toBe('.');
  });
});

describe('counted', () => {
  it('says one in the singular and every other count in the plural', () => {
    expect(counted(1, 'session', 'sessions')).toBe('1 session');
    expect(counted(0, 'session', 'sessions')).toBe('0 sessions');
    expect(counted(3, 'grant', 'grants')).toBe('3 grants');
  });
});

describe('flagText', () => {
  it('says on only for true, off for anything else', () => {
    expect(flagText(true, 'on', 'off')).toBe('on');
    expect(flagText(false, 'on', 'off')).toBe('off');
    expect(flagText(undefined, 'verified', 'not verified')).toBe('not verified');
  });
});

describe('describeIds', () => {
  const names = new Map([['a', 'Alpha']]);
  const nameOf = (id: string): string => names.get(id) ?? id;
  it('names each id, falling back to the id itself, and says none for an empty or foreign value', () => {
    expect(describeIds(['a', 'b'], nameOf)).toBe('Alpha, b');
    expect(describeIds([], nameOf)).toBe('none');
    expect(describeIds('nope', nameOf)).toBe('none');
  });
});

describe('describeId', () => {
  it('names one id, and says none for anything that is not one', () => {
    expect(describeId('a', (id) => id.toUpperCase())).toBe('A');
    expect(describeId(null, (id) => id)).toBe('none');
  });
});
