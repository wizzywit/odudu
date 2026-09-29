import { isValidE164 } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import {
  composePhone,
  phoneProblem,
  phoneProblemPart,
  readTypedNumber,
  splitPhone,
} from '#/shared/service/phone.ts';

describe('splitPhone', () => {
  it('finds the country by the longest calling code', () => {
    expect(splitPhone('+2348031234567')).toEqual({
      region: 'NG',
      national: '8031234567',
      extension: null,
    });
  });

  it('names the usual country of a shared code', () => {
    expect(splitPhone('+14155550100').region).toBe('US');
    expect(splitPhone('+447700900123').region).toBe('GB');
  });

  it('keeps the country chosen before when it shares the code', () => {
    expect(splitPhone('+14165550100', 'CA').region).toBe('CA');
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

describe('composePhone', () => {
  it('writes E.164 from a country and a number as it is dialled at home', () => {
    expect(composePhone('NG', '0803 123 4567', null)).toBe('+2348031234567');
    expect(composePhone('US', '(415) 555-0100', '12')).toBe('+14155550100;ext=12');
  });

  it('keeps the leading 0 where it is part of the number', () => {
    expect(composePhone('IT', '06 1234 5678', null)).toBe('+390612345678');
  });

  it('stores nothing for an empty number, and the text as typed with no country', () => {
    expect(composePhone('NG', '', null)).toBe('');
    expect(composePhone(null, '555-2671', null)).toBe('555-2671');
  });

  it('round-trips a stored number', () => {
    for (const value of ['+2348031234567', '+14155550100;ext=12', '+390612345678']) {
      const { region, national, extension } = splitPhone(value);
      expect(composePhone(region, national, extension)).toBe(value);
    }
  });

  it('produces what the server accepts as E.164', () => {
    expect(isValidE164(composePhone('GB', '07700 900123', null))).toBe(true);
  });
});

describe('phoneProblem', () => {
  it('says nothing of an empty or well-formed number', () => {
    expect(phoneProblem(null, '')).toBeNull();
    expect(phoneProblem('NG', '0803 123 4567')).toBeNull();
  });

  it('asks for the country of a number without one', () => {
    expect(phoneProblem(null, '8031234567')).toBe('Choose the country the number is in.');
  });

  it('refuses letters, and more digits than E.164 holds', () => {
    expect(phoneProblem('NG', '0803-CALL-ME')).toBe(
      'Use digits only; spaces, dashes, dots and brackets are ignored.',
    );
    expect(phoneProblem('NG', '1234567890123456')).toBe(
      'Too long: a phone number has at most 15 digits, country code included.',
    );
  });
});

describe('the national trunk prefix', () => {
  it.each([
    ['US', '1 (415) 555-0100', '+14155550100'],
    ['CA', '1-416-555-0100', '+14165550100'],
    ['US', '(415) 555-0100', '+14155550100'],
    ['RU', '8 916 123-45-67', '+79161234567'],
    ['KZ', '8 701 123 4567', '+77011234567'],
    ['BY', '8 029 123 45 67', '+375291234567'],
    ['HU', '06 30 123 4567', '+36301234567'],
    ['GB', '07700 900123', '+447700900123'],
    ['NG', '0803 123 4567', '+2348031234567'],
    ['IT', '06 1234 5678', '+390612345678'],
  ])('is dropped as %s dials it at home: %s', (region, national, stored) => {
    expect(composePhone(region, national, null)).toBe(stored);
  });

  it('is left on a number already written without it', () => {
    expect(composePhone('RU', '916 123-45-67', null)).toBe('+79161234567');
    expect(composePhone('HU', '30 123 4567', null)).toBe('+36301234567');
  });
});

describe('an international number typed into the number', () => {
  it('is read for its country and the rest', () => {
    expect(readTypedNumber('+234 803 123 4567')).toEqual({ region: 'NG', national: '8031234567' });
    expect(readTypedNumber('0803 123 4567')).toBeNull();
  });
});

describe('phoneProblem names the part that is wrong', () => {
  it('points at the country or at the number', () => {
    expect(phoneProblemPart(null, '8031234567')).toBe('region');
    expect(phoneProblemPart('NG', '0803-CALL-ME')).toBe('number');
    expect(phoneProblemPart('NG', '0803 123 4567')).toBeNull();
  });
});
