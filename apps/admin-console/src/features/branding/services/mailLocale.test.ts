import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_CHOICE } from '#/features/branding/services/mailChoice';
import {
  mailLocaleLabel,
  mailLocaleOf,
  MAIL_LOCALE_OPTIONS,
} from '#/features/branding/services/mailLocale';

describe('the language a preview is asked in', () => {
  it('asks for the tenant’s language unless one is chosen, and only for languages that ship', () => {
    expect(DEFAULT_MAIL_CHOICE.locale).toBe('');
    expect(MAIL_LOCALE_OPTIONS.map((option) => option.id)).toEqual(['', 'en', 'ar']);
    expect(mailLocaleOf('ar')).toBe('ar');
    expect(mailLocaleOf('fr')).toBeUndefined();
    expect(mailLocaleLabel('')).toBe('The tenant’s default');
  });
});
