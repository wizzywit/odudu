import { describe, expect, it } from 'vitest';
import { canonicalLocale, isValidLocale } from '#/profile-claims';

describe('canonicalLocale', () => {
  it.each([
    ['en', 'en'],
    ['EN', 'en'],
    ['fr-ca', 'fr-CA'],
    ['ZH-hant-tw', 'zh-Hant-TW'],
    ['zh-HANT', 'zh-Hant'],
    ['es-419', 'es-419'],
  ])('spells %s as %s', (given, spelled) => {
    expect(canonicalLocale(given)).toBe(spelled);
  });

  it.each(['', 'e', 'english', 'en_US', 'en-', 'fr-CAN-x', 'en-US-posix', '../etc', 'en\n'])(
    'refuses %j, as isValidLocale does',
    (given) => {
      expect(isValidLocale(given)).toBe(false);
      expect(canonicalLocale(given)).toBeNull();
    },
  );
});
