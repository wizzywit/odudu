import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAIL_CHOICE,
  logoViews,
  LOGO_ELSEWHERE,
  mailChoiceWith,
  mailFrameKey,
  mailLocaleLabel,
  mailLocaleOf,
  MAIL_LOCALE_OPTIONS,
  paletteRows,
  sourceText,
} from '#/features/branding/service';
import { mailBranding } from '#/testing/brandingFixtures';

describe('the mail palette', () => {
  it('lists all nine roles, each with its colour', () => {
    const rows = paletteRows(mailBranding().light.colours);
    expect(rows).toHaveLength(9);
    expect(rows.find((row) => row.role === 'panel')?.colour).toBe('#fafafa');
    expect(rows.find((row) => row.role === 'button_ink')?.label).toBe('Button text');
  });

  it('names who supplies it', () => {
    expect(sourceText('tenant')).toMatch(/published theme/u);
    expect(sourceText('default')).toMatch(/default/u);
  });
});

const ORIGIN = 'http://console.test';

describe('the logos', () => {
  it('are drawn only from the console’s own address, which is all its policy loads', () => {
    const same = mailBranding({
      logo: { src: 'http://console.test/tenants/acme/brand/a.png', alt: 'A', width: 1, height: 1 },
    });
    expect(logoViews(same, ORIGIN)[0]?.picture).toBe(
      'http://console.test/tenants/acme/brand/a.png',
    );
    expect(logoViews(mailBranding(), ORIGIN)[0]?.picture).toBeNull();
    expect(logoViews(mailBranding({ logo: null }), ORIGIN)[0]?.picture).toBeNull();
    const odd = mailBranding({ logo: { src: 'not a url', alt: '', width: 1, height: 1 } });
    expect(logoViews(odd, ORIGIN)[0]?.picture).toBeNull();
  });

  it('say where the picture is when the console cannot draw it', () => {
    expect(LOGO_ELSEWHERE).toMatch(/preview/u);
  });

  it('say what a missing one means', () => {
    const [light, dark] = logoViews(mailBranding({ logo: null }), ORIGIN);
    expect(light?.src).toBeNull();
    expect(light?.empty).toMatch(/Odudu’s own mark/u);
    expect(dark?.empty).toMatch(/light logo is shown/u);
  });

  it('say the size a mail draws a logo at', () => {
    expect(logoViews(mailBranding(), ORIGIN)[0]?.size).toBe('160 by 32 pixels');
  });
});

describe('the preview', () => {
  it('asks for the tenant’s language unless one is chosen, and only for languages that ship', () => {
    expect(DEFAULT_MAIL_CHOICE.locale).toBe('');
    expect(MAIL_LOCALE_OPTIONS.map((option) => option.id)).toEqual(['', 'en', 'ar']);
    expect(mailLocaleOf('ar')).toBe('ar');
    expect(mailLocaleOf('fr')).toBeUndefined();
    expect(mailLocaleLabel('')).toBe('The tenant’s default');
  });

  it('reloads the frame when the theme is published or the choice changes', () => {
    const base = mailFrameKey(1, DEFAULT_MAIL_CHOICE);
    expect(mailFrameKey(2, DEFAULT_MAIL_CHOICE)).not.toBe(base);
    expect(mailFrameKey(1, mailChoiceWith(DEFAULT_MAIL_CHOICE, { scheme: 'dark' }))).not.toBe(base);
    expect(mailFrameKey(1, mailChoiceWith(DEFAULT_MAIL_CHOICE, { locale: 'ar' }))).not.toBe(base);
  });
});
