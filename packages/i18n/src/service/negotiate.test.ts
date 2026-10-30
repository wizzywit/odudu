import { describe, expect, it } from 'vitest';
import { negotiateLocale } from '#/service/negotiate';
import type { NegotiationInput } from '#/service/negotiate';

const SUPPORTED = ['en', 'fr', 'de', 'de-CH', 'zh', 'zh-Hant', 'ar'] as const;

function input(overrides: Partial<NegotiationInput> = {}): NegotiationInput {
  return {
    uiLocales: [],
    subjectLocale: null,
    authenticated: false,
    tenantDefault: null,
    acceptLanguage: null,
    supported: SUPPORTED,
    ...overrides,
  };
}

describe('negotiateLocale', () => {
  it('[ODUDU-THEME-LOCALE-01] prefers the first supported ui_locales tag', () => {
    const page = negotiateLocale(
      input({ uiLocales: ['sw', 'fr', 'de'], subjectLocale: 'de', authenticated: true }),
    );
    expect(page).toEqual({ tag: 'fr', dir: 'ltr' });
  });

  it('ignores the subject locale before the first factor is verified', () => {
    const base = input({ tenantDefault: 'de', acceptLanguage: 'fr' });
    const without = negotiateLocale(base);
    expect(negotiateLocale({ ...base, subjectLocale: 'ar' })).toEqual(without);
    expect(negotiateLocale({ ...base, subjectLocale: 'fr' })).toEqual(without);
    expect(without.tag).toBe('de');
  });

  it('uses the subject locale once authenticated', () => {
    const page = negotiateLocale(
      input({ subjectLocale: 'ar', authenticated: true, tenantDefault: 'de' }),
    );
    expect(page).toEqual({ tag: 'ar', dir: 'rtl' });
  });

  it('falls to the tenant default, then Accept-Language by quality, then en', () => {
    expect(negotiateLocale(input({ tenantDefault: 'de', acceptLanguage: 'fr' })).tag).toBe('de');
    expect(negotiateLocale(input({ acceptLanguage: 'de;q=0.5, fr;q=0.9, sw' })).tag).toBe('fr');
    expect(negotiateLocale(input({ acceptLanguage: 'sw, es;q=0.4' })).tag).toBe('en');
    expect(negotiateLocale(input({ tenantDefault: 'sw' })).tag).toBe('en');
  });

  it('skips an Accept-Language entry of quality zero or malformed quality', () => {
    expect(negotiateLocale(input({ acceptLanguage: 'fr;q=0, de;q=abc, ar;q=0.1' })).tag).toBe('ar');
  });

  it('keeps an Accept-Language entry whose parameter is not q, and ignores the parameter', () => {
    expect(negotiateLocale(input({ acceptLanguage: 'fr;level=1' })).tag).toBe('fr');
    expect(negotiateLocale(input({ acceptLanguage: 'de;level=1;q=0.2, fr;q=0.5' })).tag).toBe('fr');
    expect(negotiateLocale(input({ acceptLanguage: 'fr;q=0' })).tag).toBe('en');
  });

  it('looks up by truncation: zh-Hant-TW tries zh-Hant-TW, zh-Hant, zh', () => {
    expect(negotiateLocale(input({ uiLocales: ['zh-Hant-TW'] })).tag).toBe('zh-Hant');
    expect(negotiateLocale(input({ uiLocales: ['zh-Hans-CN'] })).tag).toBe('zh');
    expect(negotiateLocale(input({ uiLocales: ['de-AT'] })).tag).toBe('de');
    const narrow = input({ uiLocales: ['zh-Hant-TW'], supported: ['en', 'zh'] });
    expect(negotiateLocale(narrow).tag).toBe('zh');
  });

  it('does not match a broader request to a narrower supported tag', () => {
    expect(negotiateLocale(input({ uiLocales: ['pt'], supported: ['en', 'pt-BR'] })).tag).toBe(
      'en',
    );
  });

  it('matches case-insensitively and returns the supported spelling', () => {
    expect(negotiateLocale(input({ uiLocales: ['ZH-hant'] })).tag).toBe('zh-Hant');
    expect(negotiateLocale(input({ uiLocales: ['de-ch'] })).tag).toBe('de-CH');
  });

  it('reduces a variant or extension tag to language-script-region: de-CH-1996 matches de-CH, en-u-ca-iso8601 matches en', () => {
    expect(negotiateLocale(input({ uiLocales: ['de-CH-1996'] })).tag).toBe('de-CH');
    expect(negotiateLocale(input({ uiLocales: ['fr', 'en-u-ca-iso8601'] })).tag).toBe('fr');
    expect(
      negotiateLocale(input({ uiLocales: ['en-u-ca-iso8601'], supported: ['fr', 'en'] })).tag,
    ).toBe('en');
  });

  it('reads at most 16 Accept-Language entries and 1024 bytes', () => {
    const fillers = Array.from({ length: 16 }, (_unused, index) => `x${String(index)}`);
    const seventeenth = [...fillers, 'fr'].join(',');
    expect(negotiateLocale(input({ acceptLanguage: seventeenth })).tag).toBe('en');

    const padded = `${'x'.repeat(1100)};q=0.1,fr`;
    expect(negotiateLocale(input({ acceptLanguage: padded })).tag).toBe('en');
    const huge = `${'a,'.repeat(2500)}fr`;
    expect(huge.length).toBeGreaterThan(5000);
    expect(negotiateLocale(input({ acceptLanguage: huge })).tag).toBe('en');
    const sixteenth = [...fillers.slice(0, 15), 'fr'].join(',');
    expect(negotiateLocale(input({ acceptLanguage: sixteenth })).tag).toBe('fr');
  });

  it('counts the 1024-byte limit in bytes, not characters', () => {
    const multibyte = `${'é'.repeat(600)},fr`;
    expect(negotiateLocale(input({ acceptLanguage: multibyte })).tag).toBe('en');
  });

  it('refuses a tag that fails isLocale shape', () => {
    const hostile = ['../../etc', 'en\r\nX', `en-${'a'.repeat(200)}`, 'e', 'en_US', 'fr\u0000'];
    for (const tag of hostile) {
      const page = negotiateLocale(
        input({
          uiLocales: [tag],
          tenantDefault: tag,
          subjectLocale: tag,
          authenticated: true,
          acceptLanguage: tag,
          supported: [...SUPPORTED, tag],
        }),
      );
      expect(page.tag).toBe('en');
    }
  });

  it('never returns a tag that is not in supported', () => {
    const tags = ['fr', 'de-CH-1996', 'zh-Hant-TW', 'sw', '../x'];
    for (const tag of tags) {
      const page = negotiateLocale(
        input({ uiLocales: [tag], acceptLanguage: tag, supported: ['de', 'ja'] }),
      );
      expect(['de', 'ja']).toContain(page.tag);
    }
    expect(negotiateLocale(input({ supported: ['ja'] })).tag).toBe('ja');
  });

  it('answers the direction of the negotiated tag', () => {
    expect(negotiateLocale(input({ uiLocales: ['ar'] })).dir).toBe('rtl');
    expect(negotiateLocale(input({ uiLocales: ['fr'] })).dir).toBe('ltr');
  });
});
