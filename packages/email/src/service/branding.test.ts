import { type MailBranding, type MailColours } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { MARK_CID } from '#/service/mark';
import { MAIL_PALETTE } from '#/service/palette.generated';
import {
  renderFinishRegistration,
  renderRecoveryCodesRevoked,
  renderRegistrationDuplicate,
  renderRequiredActions,
  renderResetPassword,
  renderSecondFactorRemoved,
  renderVerifyEmail,
} from '#/service/templates';

const LINK = 'https://idp.example/tenants/acme/login-actions/action-token?key=abc';
const NOW = new Date('2026-10-19T09:00:00Z');
const base = { to: 'ada@example.test', link: LINK, tenantDisplayName: 'Acme', now: NOW };

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
const DARK: MailColours = {
  page: '#0b1020',
  panel: '#121a33',
  sunken: '#070b17',
  border: '#5a6aa0',
  ink: '#f1f4ff',
  muted: '#b4bddb',
  link: '#9db4ff',
  button: '#9db4ff',
  buttonInk: '#050810',
};
const LOGO = {
  src: 'https://idp.example/tenants/acme/brand/aa.png',
  alt: 'Acme',
  width: 120,
  height: 40,
};
const DARK_LOGO = { ...LOGO, src: 'https://idp.example/tenants/acme/brand/bb.png' };
const branding: MailBranding = {
  palette: LIGHT,
  darkPalette: DARK,
  logo: LOGO,
  darkLogo: DARK_LOGO,
};

const withoutStyle = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/u, '');
const hexes = (html: string): string[] => [...html.matchAll(/#[0-9a-f]{6}\b/gu)].map((m) => m[0]);

describe('a themed mail', () => {
  const html = renderVerifyEmail({ ...base, branding }).html;

  it('uses the tenant palette on every element', () => {
    const body = withoutStyle(html);
    const allowed = new Set(Object.values(LIGHT));
    expect(hexes(body).length).toBeGreaterThan(10);
    for (const hex of hexes(body)) expect(allowed.has(hex)).toBe(true);
    for (const hex of Object.values(MAIL_PALETTE.light)) expect(body).not.toContain(hex);
  });

  it('puts an inline colour on every element that shows text or a surface', () => {
    const elements = [...withoutStyle(html).matchAll(/<(p|li|h1|a|td|body)\b([^>]*)>/gu)];
    const bare = elements.filter(([, tag, attrs = '']) => {
      const style = /style="([^"]*)"/u.exec(attrs)?.[1] ?? '';
      const inked = /(^|;)color:#/u.test(style);
      const filled = style.includes('background-color:#');
      // A cell that is only layout (no class, no fill) holds no text of its own.
      const shows = tag !== 'td' || attrs.includes('class="m-') || attrs.includes('bgcolor');
      return shows && !inked && !filled;
    });
    expect(bare.map((m) => m[0])).toEqual([]);
  });

  it('swaps in the tenant dark palette under prefers-color-scheme', () => {
    const style = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1] ?? '';
    expect(style).toContain('@media (prefers-color-scheme:dark)');
    for (const hex of Object.values(DARK)) expect(style).toContain(hex);
    for (const hex of Object.values(MAIL_PALETTE.dark)) expect(style).not.toContain(hex);
  });

  it('keeps the default dark colours when the theme sets no dark palette', () => {
    const light = renderVerifyEmail({ ...base, branding: { ...branding, darkPalette: null } });
    const style = /<style>([\s\S]*?)<\/style>/u.exec(light.html)?.[1] ?? '';
    expect(style).toContain(MAIL_PALETTE.dark.page);
  });

  it('keeps the default light colours when the theme sets only a dark palette', () => {
    const dark = renderVerifyEmail({ ...base, branding: { ...branding, palette: null } });
    expect(withoutStyle(dark.html)).toContain(MAIL_PALETTE.light.page);
  });

  it('logo has width, height and alt', () => {
    expect(html).toMatch(
      /<img(?: class="m-logo-light")? src="https:\/\/idp\.example\/tenants\/acme\/brand\/aa\.png"[^>]* width="120" height="40" alt="Acme"/u,
    );
    expect(html).not.toContain(`cid:${MARK_CID}`);
  });

  it('shows the dark logo only where the client honours prefers-color-scheme', () => {
    const dark = /<img class="m-logo-dark" src="[^"]*bb\.png"[^>]*style="([^"]*)"/u;
    const light = /<img class="m-logo-light" src="[^"]*aa\.png"[^>]*style="([^"]*)"/u;
    const darkStyle = dark.exec(html)?.[1] ?? '';
    const lightStyle = light.exec(html)?.[1] ?? '';
    const rules = (name: string): string => {
      const media = /@media \(prefers-color-scheme:dark\)\{([\s\S]*)\}<\/style>/u.exec(html);
      return new RegExp(`\\.${name}\\{([^}]*)\\}`, 'u').exec(media?.[1] ?? '')?.[1] ?? '';
    };
    // No media support: exactly the light logo is shown.
    expect(lightStyle).toContain('display:block');
    expect(darkStyle).toContain('display:none');
    // Dark mode: the inline declarations are overridden and nothing else on
    // the dark logo is left at zero size or clipped.
    expect(rules('m-logo-dark')).toContain('display:block!important');
    expect(rules('m-logo-light')).toContain('display:none!important');
    for (const declaration of [darkStyle, rules('m-logo-dark')]) {
      expect(declaration).not.toMatch(
        /max-height:\s*0|max-width:\s*0|overflow:\s*hidden|(^|;)(width|height):\s*0/u,
      );
    }
  });

  it('draws no dark logo when the theme has none', () => {
    const plain = renderVerifyEmail({ ...base, branding: { ...branding, darkLogo: null } }).html;
    expect(plain).not.toContain('m-logo-dark');
    expect(plain).not.toContain('bb.png');
  });

  it('still names the tenant beside the logo', () => {
    expect(html).toContain('<bdi');
    expect(html).toContain('Acme');
  });

  it('leaves the plain text alone and says the tenant', () => {
    const themed = renderVerifyEmail({ ...base, branding });
    const plain = renderVerifyEmail(base);
    expect(themed.text).toBe(plain.text);
    expect(themed.text).toContain('⁨Acme⁩');
    expect(themed.subject).toBe(plain.subject);
  });
});

describe('a mail with no branding', () => {
  it('falls back to the default palette without branding', () => {
    const html = renderVerifyEmail(base).html;
    expect(withoutStyle(html)).toContain(MAIL_PALETTE.light.panel);
    expect(html).toContain(`cid:${MARK_CID}`);
  });

  it('is byte for byte what a null branding gives', () => {
    expect(renderVerifyEmail({ ...base, branding: null }).html).toBe(renderVerifyEmail(base).html);
  });

  it('keeps the Odudu mark when the theme sets a palette and no logo', () => {
    const html = renderVerifyEmail({
      ...base,
      branding: { ...branding, logo: null, darkLogo: null },
    }).html;
    expect(html).toContain(`cid:${MARK_CID}`);
    expect(html).toContain(LIGHT.panel);
  });
});

describe('a theme that is hostile', () => {
  it('escapes a hostile logo alt', () => {
    const alt = '"><script>alert(1)</script><img src=x onerror=y';
    const html = renderVerifyEmail({
      ...base,
      branding: { ...branding, logo: { ...LOGO, alt }, darkLogo: { ...DARK_LOGO, alt } },
    }).html;
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img src=x/u);
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;');
  });

  it.each([
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user:pw@idp.example/a.png',
    '//idp.example/a.png',
    '/tenants/acme/brand/aa.png',
    ' https://idp.example/a.png',
    'https://idp.example/a.png"onerror="x',
  ])('refuses the logo address %s and keeps the default mark', (src) => {
    const html = renderVerifyEmail({
      ...base,
      branding: { ...branding, logo: { ...LOGO, src } },
    }).html;
    expect(html).not.toContain(src);
    expect(html).toContain(`cid:${MARK_CID}`);
  });

  it.each([
    [0, 40],
    [120, 0],
    [1.5, 40],
    [2000, 40],
    [Number.NaN, 40],
    [120, -1],
  ])('refuses a logo of %s by %s', (width, height) => {
    const html = renderVerifyEmail({
      ...base,
      branding: { ...branding, logo: { ...LOGO, width, height } },
    }).html;
    expect(html).not.toContain('aa.png');
    expect(html).toContain(`cid:${MARK_CID}`);
  });

  it('draws the default palette when a colour is not #rrggbb', () => {
    const palette = { ...LIGHT, ink: 'red;background:url(https://evil.example/x)' };
    const html = renderVerifyEmail({ ...base, branding: { ...branding, palette } }).html;
    expect(html).not.toContain('evil.example');
    expect(withoutStyle(html)).toContain(MAIL_PALETTE.light.ink);
  });

  it('refuses a dark logo address without dropping the light one', () => {
    const html = renderVerifyEmail({
      ...base,
      branding: { ...branding, darkLogo: { ...DARK_LOGO, src: 'javascript:1' } },
    }).html;
    expect(html).toContain('aa.png');
    expect(html).not.toContain('m-logo-dark');
  });
});

describe('every kind of mail takes the theme', () => {
  const kinds = {
    verification: renderVerifyEmail({ ...base, branding }),
    finish: renderFinishRegistration({ ...base, branding }),
    reset: renderResetPassword({ ...base, branding }),
    duplicate: renderRegistrationDuplicate({
      to: base.to,
      resetLink: LINK,
      tenantDisplayName: 'Acme',
      now: NOW,
      branding,
    }),
    actions: renderRequiredActions({ ...base, branding, actions: ['update-password'] }),
    factor: renderSecondFactorRemoved({ ...base, branding, factor: 'totp', codes: false }),
    codes: renderRecoveryCodesRevoked({ ...base, branding, newSet: false }),
  };
  it.each(Object.entries(kinds))('%s carries the logo and the palette', (_, message) => {
    expect(message.html).toContain('aa.png');
    expect(message.html).toContain(LIGHT.panel);
  });
});

describe('the language of a mail', () => {
  it('uses the tenant default locale when the recipient has none', () => {
    const message = renderVerifyEmail({ ...base, locale: null, tenantDefaultLocale: 'ar' });
    expect(message.html).toContain('<html lang="ar" dir="rtl">');
  });

  it("prefers the recipient's own locale over the tenant default", () => {
    const message = renderVerifyEmail({ ...base, locale: 'en', tenantDefaultLocale: 'ar' });
    expect(message.html).toContain('<html lang="en" dir="ltr">');
  });

  it('is English with neither', () => {
    expect(renderVerifyEmail(base).html).toContain('<html lang="en" dir="ltr">');
  });

  it('is English when the tenant default has no catalogue here', () => {
    const message = renderVerifyEmail({ ...base, tenantDefaultLocale: 'tlh' });
    expect(message.html).toContain('<html lang="en" dir="ltr">');
  });

  it('keeps dir="rtl" and the logo on the right in a themed Arabic mail', () => {
    const html = renderVerifyEmail({ ...base, locale: 'ar', branding }).html;
    expect(html).toContain('<html lang="ar" dir="rtl">');
    expect(html).toContain('text-align:right');
    expect(html).toContain('padding-left:12px');
    expect(html).toContain('aa.png');
  });
});
