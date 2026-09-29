import { isValidE164 } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import {
  callingCodeOf,
  composePhone,
  formatPhone,
  phoneProblem,
  phoneProblemPart,
  phoneRegions,
  readTypedNumber,
  splitPhone,
  typingInternational,
} from '#/shared/service/phone.ts';

describe('splitPhone', () => {
  it('finds the country a stored number belongs to', () => {
    expect(splitPhone('+2348031234567')).toEqual({
      region: 'NG',
      national: '8031234567',
      extension: null,
    });
    expect(splitPhone('+14165550100').region).toBe('CA');
    expect(splitPhone('+447700900123').region).toBe('GB');
  });

  it('keeps the country chosen before when it shares the code', () => {
    expect(splitPhone('+14155550100', 'CA').region).toBe('CA');
    expect(splitPhone('+2348031234567', 'CA').region).toBe('NG');
  });

  it('keeps an extension', () => {
    expect(splitPhone('+14155550100;ext=12')).toEqual({
      region: 'US',
      national: '4155550100',
      extension: '12',
    });
  });

  it('leaves a number not in international form with no country', () => {
    expect(splitPhone('555-2671')).toEqual({ region: null, national: '555-2671', extension: null });
    expect(splitPhone('')).toEqual({ region: null, national: '', extension: null });
  });
});

describe('composePhone, from a number dialled at home', () => {
  it.each([
    ['US', '1 (415) 555-0100', '+14155550100'],
    ['US', '(415) 555-0100', '+14155550100'],
    ['RU', '8 916 123-45-67', '+79161234567'],
    ['RU', '800 555 35 35', '+78005553535'],
    ['HU', '06 30 123 4567', '+36301234567'],
    ['LT', '8 612 34567', '+37061234567'],
    ['LT', '800 12345', '+37080012345'],
    ['TJ', '88 123 4567', '+992881234567'],
    ['UZ', '88 123 45 67', '+998881234567'],
    ['CG', '06 612 3456', '+242066123456'],
    ['GA', '06 12 34 56', '+24106123456'],
    ['NG', '0803 123 4567', '+2348031234567'],
    ['IT', '06 1234 5678', '+390612345678'],
  ])('stores %s %s as %s, which the server takes', (region, national, stored) => {
    expect(composePhone(region, national, null)).toBe(stored);
    expect(isValidE164(stored)).toBe(true);
  });

  it('adds an extension, and stores nothing for an empty number', () => {
    expect(composePhone('US', '(415) 555-0100', '12')).toBe('+14155550100;ext=12');
    expect(composePhone('NG', '', null)).toBe('');
    expect(composePhone(null, '555-2671', null)).toBe('555-2671');
  });

  it('round-trips a stored number', () => {
    for (const value of ['+2348031234567', '+14155550100;ext=12', '+390612345678']) {
      const { region, national, extension } = splitPhone(value);
      expect(composePhone(region, national, extension)).toBe(value);
    }
  });
});

describe('phoneProblem', () => {
  it('says nothing of an empty or well-formed number', () => {
    expect(phoneProblem(null, '')).toBeNull();
    expect(phoneProblem('NG', '0803 123 4567')).toBeNull();
  });

  it('asks for the country of a number without one', () => {
    expect(phoneProblem(null, '8031234567')).toBe('Choose the country the number is in.');
    expect(phoneProblemPart(null, '8031234567')).toBe('region');
  });

  it('refuses a number too short or too long for its country', () => {
    expect(phoneProblem('NG', '0803')).toBe('Too short for a phone number in this country.');
    expect(phoneProblem('TJ', '8 88 123 4567')).toBe(
      'Too long for a phone number in this country.',
    );
    expect(phoneProblemPart('NG', '0803')).toBe('number');
  });

  it('refuses letters', () => {
    expect(phoneProblem('NG', '0803-CALL-ME')).toBe(
      'Use digits only; spaces, dashes, dots and brackets are ignored.',
    );
  });
});

describe('an international number typed into the number', () => {
  it('is read for its country and the rest', () => {
    expect(readTypedNumber('+234 803 123 4567')).toEqual({ region: 'NG', national: '8031234567' });
    expect(readTypedNumber('0803 123 4567')).toBeNull();
  });

  it('is left alone, and unjudged, while its calling code is still being typed', () => {
    expect(typingInternational('+2')).toBe(true);
    expect(typingInternational('+23')).toBe(true);
    expect(typingInternational('+2a')).toBe(false);
    expect(typingInternational('0803')).toBe(false);
  });
});

describe('formatPhone', () => {
  it('writes a stored number as it is read aloud', () => {
    expect(formatPhone('+2348031234567')).toBe('+234 803 123 4567');
    expect(formatPhone('+14155550100;ext=12')).toBe('+1 415 555 0100 ext. 12');
    expect(formatPhone('555-2671')).toBe('555-2671');
  });
});

describe('phoneRegions', () => {
  it('names the calling code of every region a number can be in', () => {
    expect(callingCodeOf('NG')).toBe('234');
    expect(callingCodeOf('US')).toBe('1');
    expect(callingCodeOf('AQ')).toBeNull();
    expect(phoneRegions()).toContain('NG');
    expect(phoneRegions()).not.toContain('AQ');
  });
});
