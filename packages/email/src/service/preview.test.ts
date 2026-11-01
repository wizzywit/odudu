import { MAIL_PREVIEW_LOCALES } from '@odudu/contracts/admin';
import { SHIPPED_LOCALES } from '@odudu/i18n';
import { type MailBranding, type MailColours } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { MARK_CID } from '#/service/mark';
import { MAIL_PALETTE } from '#/service/palette.generated';
import { brandingInScheme, inlineMark, mailSchemeColours } from '#/service/preview';
import { renderVerifyEmail } from '#/service/templates';

const LIGHT: MailColours = {
  page: '#fdf6e3',
  panel: '#fffdf5',
  sunken: '#f5ecd0',
  border: '#8a7a4a',
  ink: '#1a1405',
  muted: '#5a4e2a',
  link: '#7a3b00',
  button: '#b45309',
  buttonInk: '#000000',
};
const DARK: MailColours = { ...LIGHT, page: '#0b0b0b', panel: '#151515' };
const LOGO = { src: 'https://idp.example/brand/a.png', alt: 'Acme', width: 40, height: 40 };
const DARK_LOGO = { ...LOGO, src: 'https://idp.example/brand/b.png' };
const THEME: MailBranding = { palette: LIGHT, darkPalette: DARK, logo: LOGO, darkLogo: DARK_LOGO };

describe('mailSchemeColours', () => {
  it('names the theme as the source of a palette it sets', () => {
    expect(mailSchemeColours(THEME, 'dark')).toEqual({ source: 'tenant', colours: DARK });
  });

  it('falls back to the default for a scheme the theme leaves out or breaks', () => {
    const broken = { ...THEME, palette: { ...LIGHT, ink: 'red' }, darkPalette: null };
    expect(mailSchemeColours(broken, 'light').source).toBe('default');
    expect(mailSchemeColours(null, 'dark')).toEqual({
      source: 'default',
      colours: expect.objectContaining({ page: MAIL_PALETTE.dark.page }) as MailColours,
    });
  });
});

describe('brandingInScheme', () => {
  it('makes the dark mail wear the dark palette and logo whatever the viewer prefers', () => {
    const html = renderVerifyEmail({
      to: 'a@b.test',
      link: 'https://idp.example/x',
      tenantDisplayName: 'Acme',
      now: new Date('2026-10-19T09:00:00Z'),
      branding: brandingInScheme(THEME, 'dark'),
    }).html;
    expect(html).toContain('#0b0b0b');
    expect(html).not.toContain('#fdf6e3');
    expect(html).toContain('brand/b.png');
    expect(html).not.toContain('brand/a.png');
  });

  it('leaves a theme with no logo on the default mark', () => {
    expect(brandingInScheme(null, 'light')).toMatchObject({ logo: null, darkLogo: null });
  });
});

describe('inlineMark', () => {
  it('turns the attachment reference into a picture a browser can show', () => {
    const out = inlineMark(`<img src="cid:${MARK_CID}">`);
    expect(out).toMatch(/^<img src="data:image\/png;base64,/u);
    expect(out).not.toContain('cid:');
  });
});

describe('the languages the preview offers', () => {
  it('are the languages this build ships and holds a mail catalogue for', () => {
    expect([...MAIL_PREVIEW_LOCALES]).toEqual([...SHIPPED_LOCALES]);
    for (const locale of MAIL_PREVIEW_LOCALES) {
      const html = renderVerifyEmail({
        to: 'a@b.test',
        link: 'https://idp.example/x',
        tenantDisplayName: 'Acme',
        now: new Date('2026-10-19T09:00:00Z'),
        locale,
      }).html;
      expect(html).toContain(`lang="${locale}"`);
    }
  });
});
