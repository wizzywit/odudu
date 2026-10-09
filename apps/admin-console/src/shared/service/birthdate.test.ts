import { describe, expect, it } from 'vitest';
import {
  birthdateProblem,
  composeBirthdate,
  daysIn,
  readBirthdate,
} from '#/shared/service/birthdate.ts';

describe('readBirthdate', () => {
  it('reads a full date', () => {
    expect(readBirthdate('1990-01-31')).toEqual({ kind: 'date', year: 1990, month: 1, day: 31 });
  });

  it('reads a year alone', () => {
    expect(readBirthdate('1990')).toEqual({ kind: 'year', year: 1990 });
  });

  it('reads a day and month whose year is withheld', () => {
    expect(readBirthdate('0000-02-29')).toEqual({ kind: 'no-year', month: 2, day: 29 });
  });

  it('reads nothing as empty', () => {
    expect(readBirthdate('')).toEqual({ kind: 'empty' });
  });

  it('keeps a stored value that is no calendar date as it is', () => {
    expect(readBirthdate('1990-02-31')).toEqual({ kind: 'other', raw: '1990-02-31' });
    expect(readBirthdate('0000')).toEqual({ kind: 'other', raw: '0000' });
  });
});

describe('composeBirthdate', () => {
  it('writes each form in the shape OIDC Core §5.1 names', () => {
    expect(composeBirthdate({ kind: 'date', year: 1990, month: 1, day: 5 })).toBe('1990-01-05');
    expect(composeBirthdate({ kind: 'year', year: 987 })).toBe('0987');
    expect(composeBirthdate({ kind: 'no-year', month: 12, day: 1 })).toBe('0000-12-01');
    expect(composeBirthdate({ kind: 'empty' })).toBe('');
    expect(composeBirthdate({ kind: 'other', raw: 'x' })).toBe('x');
  });

  it('round-trips what it reads', () => {
    for (const value of ['1990-01-31', '2004', '0000-02-29', '']) {
      expect(composeBirthdate(readBirthdate(value))).toBe(value);
    }
  });
});

describe('daysIn', () => {
  it('allows 29 February when the year is withheld', () => {
    expect(daysIn(2, null)).toBe(29);
    expect(daysIn(2, 2001)).toBe(28);
    expect(daysIn(4, null)).toBe(30);
  });
});

describe('birthdateProblem', () => {
  const TODAY = { year: 2026, month: 9, day: 29 };

  it('refuses a day or a year still to come', () => {
    expect(birthdateProblem({ kind: 'date', year: 2026, month: 9, day: 30 }, TODAY)).toBe(
      'A birthdate cannot be in the future.',
    );
    expect(birthdateProblem({ kind: 'year', year: 2027 }, TODAY)).toBe(
      'A birthdate cannot be in the future.',
    );
  });

  it('accepts today, the past, and a withheld year', () => {
    expect(birthdateProblem({ kind: 'date', year: 2026, month: 9, day: 29 }, TODAY)).toBeNull();
    expect(birthdateProblem({ kind: 'no-year', month: 12, day: 31 }, TODAY)).toBeNull();
    expect(birthdateProblem({ kind: 'empty' }, TODAY)).toBeNull();
  });
});
