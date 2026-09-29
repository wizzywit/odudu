import { isValidLocale } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import { localeName, localeOptions, localeProblem } from '#/shared/service/locales.ts';

describe('locales', () => {
  it('names a tag in the reader’s language', () => {
    expect(localeName('en-NG', 'en')).toBe('English (Nigeria)');
    expect(localeName('de-CH', 'de')).toBe('Deutsch (Schweiz)');
  });

  it('offers only tags the server accepts, the reader’s own among them', () => {
    const options = localeOptions('en', 'yo-BJ');
    expect(options.every((o) => isValidLocale(o.id))).toBe(true);
    expect(options.map((o) => o.id)).toContain('yo-BJ');
    expect(options.find((o) => o.id === 'en-NG')?.label).toBe('English (Nigeria)');
  });

  it('refuses a tag that is not BCP 47 in the shape the server takes', () => {
    expect(localeProblem('')).toBeNull();
    expect(localeProblem('en-NG')).toBeNull();
    expect(localeProblem('English')).toBe('Choose a language, or type a tag such as en-NG.');
    expect(localeProblem('en_US')).toBe('Choose a language, or type a tag such as en-NG.');
  });
});
