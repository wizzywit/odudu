import { describe, expect, it, vi } from 'vitest';
import {
  defaultChoices,
  languageSettingsOf,
  languagesHold,
  languagesOf,
  addLanguage,
  addsOnKey,
  languageAdded,
  languagesRequest,
  openingLocale,
  shownLocale,
  supportedChoices,
  SHIPPED_LANGUAGES,
} from '#/features/branding/service';

describe('the shipped languages', () => {
  it('are English and Arabic', () => {
    expect(SHIPPED_LANGUAGES).toEqual(['en', 'ar']);
  });

  it('are offered first, then any other the tenant supports or is adding, each once', () => {
    expect(supportedChoices(['fr', 'en'], ['en', 'pt-BR']).map((c) => c.id)).toEqual([
      'en',
      'ar',
      'fr',
      'pt-BR',
    ]);
  });
});

describe('the settings as languages', () => {
  it('read the two settings out of the whole record, whatever else is in it', () => {
    expect(
      languageSettingsOf({ supported_locales: ['en', 3, 'ar'], default_locale: null, other: 1 }),
    ).toEqual({ supported_locales: ['en', 'ar'], default_locale: null });
    expect(languageSettingsOf({})).toEqual({ supported_locales: [], default_locale: null });
  });

  it('show no default as an empty choice', () => {
    expect(languagesOf({ supported_locales: ['en'], default_locale: null }).default_locale).toBe(
      '',
    );
  });
});

describe('the default language choices', () => {
  it('always offer "the browser decides", first', () => {
    expect(defaultChoices(['en', 'ar']).map((choice) => choice.id)).toEqual(['', 'en', 'ar']);
  });
});

describe('what holds the section', () => {
  it('is no language at all, and a default that is not offered', () => {
    expect(languagesHold({ supported_locales: [], default_locale: '' })).toMatch(/at least one/u);
    expect(languagesHold({ supported_locales: ['en'], default_locale: 'ar' })).toMatch(
      /must be one of the supported/u,
    );
    expect(
      languagesHold({ supported_locales: ['en', 'ar'], default_locale: 'ar' }),
    ).toBeUndefined();
    expect(languagesHold({ supported_locales: ['en'], default_locale: '' })).toBeUndefined();
  });
});

describe('the request', () => {
  it('carries what changed, and an empty default to clear it', () => {
    expect(languagesRequest({ supported_locales: ['en', 'ar'] })).toEqual({
      supported_locales: ['en', 'ar'],
    });
    expect(languagesRequest({ default_locale: 'ar' })).toEqual({ default_locale: 'ar' });
    expect(languagesRequest({ default_locale: '' })).toEqual({ default_locale: '' });
  });
});

describe('the language the overrides open on', () => {
  it('is the default when it is offered, else the first, else English', () => {
    expect(openingLocale({ supported_locales: ['en', 'ar'], default_locale: 'ar' })).toBe('ar');
    expect(openingLocale({ supported_locales: ['en', 'ar'], default_locale: null })).toBe('en');
    expect(openingLocale({ supported_locales: [], default_locale: null })).toBe('en');
  });

  it('is the one picked while it is still offered', () => {
    expect(shownLocale('ar', ['en', 'ar'], 'en')).toBe('ar');
    expect(shownLocale('fr', ['en', 'ar'], 'en')).toBe('en');
    expect(shownLocale(null, ['en', 'ar'], 'en')).toBe('en');
  });
});

describe('adding a language', () => {
  it('joins a tag the server takes, as typed', () => {
    expect(languageAdded(['en'], ' pt-BR ')).toEqual({ supported: ['en', 'pt-BR'], problem: null });
  });

  it('refuses nothing chosen, a tag that is not one, and one already offered in any case', () => {
    expect(languageAdded(['en'], '').problem).toMatch(/Choose a language/u);
    expect(languageAdded(['en'], 'English').supported).toBeNull();
    expect(languageAdded(['en'], 'English').problem).toMatch(/type a tag/u);
    expect(languageAdded(['en', 'fr-CA'], 'FR-ca').problem).toBe(
      'That language is already offered.',
    );
  });

  it('refuses a thirty-third', () => {
    const full = Array.from(
      { length: 32 },
      (_, i) => `x${String.fromCharCode(97 + (i % 26))}${String(i)}`,
    );
    expect(languageAdded(full, 'fr').problem).toMatch(/at most 32/u);
  });
});

describe('adding what was typed', () => {
  it('hands on the new list and clears the problem, or hands on only the problem', () => {
    const to = { problem: vi.fn(), accepted: vi.fn() };
    addLanguage(['en'], 'fr', to);
    expect(to.problem).toHaveBeenCalledExactlyOnceWith(undefined);
    expect(to.accepted).toHaveBeenCalledExactlyOnceWith(['en', 'fr']);

    const refused = { problem: vi.fn(), accepted: vi.fn() };
    addLanguage(['en'], 'EN', refused);
    expect(refused.problem).toHaveBeenCalledExactlyOnceWith('That language is already offered.');
    expect(refused.accepted).not.toHaveBeenCalled();
  });

  it('is done by Enter, except when Enter chooses another option', () => {
    expect(addsOnKey('Enter', false)).toBe(true);
    expect(addsOnKey('Enter', true)).toBe(false);
    expect(addsOnKey('a', false)).toBe(false);
  });
});
