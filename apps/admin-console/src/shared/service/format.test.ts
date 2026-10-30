import { describe, expect, it } from 'vitest';
import {
  byteSizeReading,
  nullWhenBlank,
  utf8Length,
  bytesText,
  shortened,
  groupedNumber,
  andList,
  attemptsText,
  capitalise,
  counted,
  describeId,
  describeIds,
  flagText,
  formatAbsolute,
  formatDuration,
  formatRelative,
  lowerFirst,
  orBlank,
  plural,
  sentence,
} from '#/shared/service/format';

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
    expect(sentence('rule.')).toBe('Rule.');
    expect(sentence('rule')).toBe('Rule.');
  });
});

describe('capitalise and lowerFirst', () => {
  it('change only the first letter', () => {
    expect(capitalise('a tenant name')).toBe('A tenant name');
    expect(capitalise('')).toBe('');
    expect(lowerFirst('Passkey')).toBe('passkey');
    expect(lowerFirst('TOTP code')).toBe('tOTP code');
  });
});

describe('plural', () => {
  it('picks the singular for one and the plural for every other count', () => {
    expect(plural(1, 'tab', 'tabs')).toBe('tab');
    expect(plural(0, 'tab', 'tabs')).toBe('tabs');
    expect(plural(2, 'tab', 'tabs')).toBe('tabs');
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

describe('groupedNumber', () => {
  it('groups thousands with commas', () => {
    expect(groupedNumber(1234567)).toBe('1,234,567');
    expect(groupedNumber(200)).toBe('200');
  });
});

describe('orBlank', () => {
  it('shows a text a record does not hold as an empty one', () => {
    expect(orBlank('a')).toBe('a');
    expect(orBlank('')).toBe('');
    expect(orBlank(null)).toBe('');
    expect(orBlank(undefined)).toBe('');
  });
});

describe('attemptsText', () => {
  it('counts attempts in words', () => {
    expect(attemptsText(1)).toBe('1 attempt');
    expect(attemptsText(0)).toBe('0 attempts');
    expect(attemptsText(5)).toBe('5 attempts');
  });
});

describe('byteSizeReading', () => {
  it('says how much of the limit is used, and by how much it is passed', () => {
    expect(byteSizeReading(1500, 2000)).toEqual({ text: '1,500 of 2,000 bytes.', over: false });
    expect(byteSizeReading(2000, 2000).over).toBe(false);
    expect(byteSizeReading(2001, 2000)).toEqual({
      text: '1 bytes over the limit of 2,000.',
      over: true,
    });
  });
});

describe('shortened', () => {
  it('keeps a text that fits and cuts a longer one to the limit with an ellipsis', () => {
    expect(shortened('abc', 3)).toBe('abc');
    expect(shortened('abcd', 3)).toBe('abc…');
    expect(shortened('', 3)).toBe('');
  });
});

describe('a size in bytes', () => {
  it('is read as a person would', () => {
    expect(bytesText(512)).toBe('512 bytes');
    expect(bytesText(256 * 1024)).toBe('256 KiB');
    expect(bytesText(16 * 1024 * 1024)).toBe('16 MiB');
  });

  it('keeps one decimal only when the size is not whole', () => {
    expect(bytesText(1536)).toBe('1.5 KiB');
    expect(bytesText(5 * 1024 * 1024 + 1)).toBe('5.0 MiB');
  });

  it('reads the unit edges without a 1024.0 KiB', () => {
    expect(bytesText(0)).toBe('0 bytes');
    expect(bytesText(1023)).toBe('1023 bytes');
    expect(bytesText(1024)).toBe('1 KiB');
    expect(bytesText(1024 * 1024 - 1)).toBe('1.0 MiB');
  });
});

describe('texts as the server reads them', () => {
  it('counts bytes, not characters', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('')).toBe(0);
    expect(utf8Length('😀')).toBe(4);
  });

  it('takes blank for null and leaves other text as typed', () => {
    expect(nullWhenBlank('  ')).toBeNull();
    expect(nullWhenBlank(' a ')).toBe(' a ');
  });
});
