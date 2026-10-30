import { describe, expect, it } from 'vitest';
import { MAIL_PALETTE } from '#/service/palette.generated';
import { renderShell } from '#/service/shell';
import {
  renderFinishRegistration,
  renderRecoveryCodesRevoked,
  renderRegistrationDuplicate,
  renderRequiredActions,
  renderSecondFactorRemoved,
  renderResetPassword,
  renderSmtpTest,
  renderVerifyEmail,
} from '#/service/templates';
import { type EmailMessage } from '#/service/sender';

const LINK = 'https://idp.example/tenants/demo/login-actions/action-token?key=abc&n=1';
const NOW = new Date('2026-10-19T09:00:00Z');
const RLO = String.fromCodePoint(0x202e);
const LRI = String.fromCodePoint(0x2066);

interface Kind {
  readonly render: (tenant: string, now?: Date) => EmailMessage;
  readonly button: string | null;
}

const base = { to: 'ada@example.test', link: LINK, now: NOW };
const kinds: Record<string, Kind> = {
  verification: {
    render: (tenantDisplayName, now = NOW) =>
      renderVerifyEmail({ ...base, tenantDisplayName, now }),
    button: 'Verify email',
  },
  'finish registration': {
    render: (tenantDisplayName, now = NOW) =>
      renderFinishRegistration({ ...base, tenantDisplayName, now }),
    button: 'Finish sign-up',
  },
  'password reset': {
    render: (tenantDisplayName, now = NOW) =>
      renderResetPassword({ ...base, tenantDisplayName, now }),
    button: 'Reset password',
  },
  'registration duplicate': {
    render: (tenantDisplayName, now = NOW) =>
      renderRegistrationDuplicate({ to: base.to, resetLink: LINK, tenantDisplayName, now }),
    button: 'Reset password',
  },
  'required actions': {
    render: (tenantDisplayName, now = NOW) =>
      renderRequiredActions({
        ...base,
        tenantDisplayName,
        now,
        actions: ['update-password', 'configure-totp'],
      }),
    button: 'Update account',
  },
  'second factor removed': {
    render: (tenantDisplayName, now = NOW) =>
      renderSecondFactorRemoved({ ...base, tenantDisplayName, now, factor: 'totp', codes: true }),
    button: null,
  },
  'recovery codes revoked': {
    render: (tenantDisplayName, now = NOW) =>
      renderRecoveryCodesRevoked({ ...base, tenantDisplayName, now, newSet: true }),
    button: null,
  },
  'smtp test': {
    render: (tenantDisplayName, now = NOW) =>
      renderSmtpTest({ to: base.to, tenantDisplayName, now }),
    button: null,
  },
};

const each = Object.entries(kinds);
const attr = (html: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`\\s${name}="([^"]*)"`, 'gu'))].map((m) => m[1] ?? '');
const unescape = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

describe.each(each)('the %s mail shell', (_name, kind) => {
  const { html, text } = kind.render('Demo');

  it('is a complete document that declares both colour schemes and its language', () => {
    expect(html.startsWith('<!doctype html><html lang="en" dir="ltr">')).toBe(true);
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).toContain('<meta name="viewport"');
  });

  it('is built from presentation tables, at most 560px wide', () => {
    const tables = html.match(/<table\b[^>]*>/gu) ?? [];
    expect(tables.length).toBeGreaterThan(2);
    for (const table of tables) expect(table).toContain('role="presentation"');
    expect(html).toContain('max-width:560px');
  });

  it('has one h1 and a title, and no script, remote style, font or form', () => {
    expect(html.match(/<h1\b/gu)).toHaveLength(1);
    expect(html).toMatch(/<title>[^<]+<\/title>/u);
    expect(html).not.toMatch(/<script|<link|<form|<iframe|<object|<embed|@import|@font-face/iu);
    expect(html).not.toMatch(/url\(/iu);
    expect(html).not.toMatch(/\son\w+=/iu);
  });

  it('loads one image, the mark by content id, and names it with its size', () => {
    const images = html.match(/<img\b[^>]*>/gu) ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain('src="cid:odudu-mark"');
    expect(images[0]).toContain('alt="odudu"');
    expect(images[0]).not.toContain('class=');
    expect(images[0]).toContain('width="40"');
    expect(images[0]).toContain('height="40"');
    expect(attr(html, 'src')).toEqual(['cid:odudu-mark']);
  });

  it('links only to web addresses', () => {
    for (const href of attr(html, 'href')) expect(href).toMatch(/^https?:\/\//u);
  });

  it('uses only colours from the compiled palette', () => {
    const allowed = new Set([
      ...Object.values(MAIL_PALETTE.light),
      ...Object.values(MAIL_PALETTE.dark),
    ]);
    const used = html.match(/#[0-9a-f]{6}\b/giu) ?? [];
    expect(used.length).toBeGreaterThan(10);
    for (const colour of used) expect(allowed.has(colour)).toBe(true);
    expect(html).not.toMatch(/rgba?\(|hsla?\(|var\(|light-dark\(/iu);
  });

  it('keeps every light colour inline, so a client that ignores the style block is readable', () => {
    const inline = (html.match(/style="[^"]*"/gu) ?? []).join('');
    for (const role of ['page', 'panel', 'ink', 'muted'] as const) {
      expect(inline).toContain(MAIL_PALETTE.light[role]);
    }
  });

  it('stays well under the size Gmail clips at', () => {
    expect(Buffer.byteLength(html)).toBeLessThan(40_000);
  });

  it('names the tenant in the header, isolated', () => {
    expect(html).toMatch(/alt="odudu"[^>]*><\/td><td[^>]*><bdi>Demo<\/bdi><\/td>/u);
  });

  it("says why it was sent, then the year and who it is powered by, in the footer's muted text", () => {
    const footer = html.slice(html.lastIndexOf('<tr><td style="padding:20px'));
    expect(footer).toMatch(/You received this because .*<bdi>Demo<\/bdi>/u);
    expect(footer).toContain('© 2026 Odudu &middot; Powered by odudu');
    expect(footer).not.toContain('<a ');
    expect(text).toMatch(/\n--\nYou received this because .*\n© 2026 Odudu · Powered by odudu$/u);
  });

  it('has the button and the raw link, or neither', () => {
    const anchors = html.match(/<a\b[^>]*>[^<]*<\/a>/gu) ?? [];
    if (kind.button === null) {
      expect(anchors).toEqual([]);
      expect(text).not.toContain('http');
      return;
    }
    expect(anchors).toHaveLength(2);
    const [button = '', raw = ''] = anchors;
    expect(button).toContain(`>${kind.button}</a>`);
    expect(button).toContain('class="m-button-link"');
    expect(unescape(attr(button, 'href')[0] ?? '')).toBe(LINK);
    expect(unescape(raw.replace(/<[^>]*>/gu, ''))).toBe(LINK);
    expect(unescape(attr(raw, 'href')[0] ?? '')).toBe(LINK);
    expect(html.indexOf(raw)).toBeGreaterThan(html.indexOf(button));
    expect(html).toContain('If the button does not work, copy this link into your browser:');
    expect(html).toContain('word-break:break-all');
    expect(text.split('\n')).toContain(LINK);
  });

  it('gives the button a tap target of at least 44px', () => {
    if (kind.button === null) return;
    const cell = /<td class="m-button"[^>]*>/u.exec(html)?.[0] ?? '';
    expect(cell).toContain('padding:12px 24px');
    expect(html).toMatch(/class="m-button-link"[^>]*font:600 15px\/20px/u);
  });
});

describe('the year in the footer', () => {
  const render = kinds.verification?.render;
  if (render === undefined) throw new Error('no verification renderer');

  it.each([
    ['2026-12-31T23:59:59Z', '2026'],
    ['2027-01-01T00:00:00Z', '2027'],
    ['2026-12-31T23:30:00-05:00', '2027'],
    ['2027-01-01T01:00:00+03:00', '2026'],
    ['2031-06-01T12:00:00Z', '2031'],
  ])('is the UTC year of %s: %s', (instant, year) => {
    const msg = render('Demo', new Date(instant));
    expect(msg.html).toContain(`© ${year} Odudu`);
    expect(msg.text).toContain(`© ${year} Odudu`);
    expect(msg.html).not.toContain(`© ${String(Number(year) + 1)} Odudu`);
  });
});

describe.each(each)('the %s mail, given a hostile or unusual tenant name', (_name, kind) => {
  it('escapes markup and keeps the name out of every attribute', () => {
    const { html } = kind.render('<script>alert(1)</script>"><img src=x onerror=y>');
    expect(html).not.toContain('<script');
    expect(html.match(/<img\b/gu)).toHaveLength(1);
    expect(html).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt;&quot;&gt;&lt;img src=x onerror=y&gt;',
    );
  });

  it('drops bidi overrides and keeps the markup balanced', () => {
    const { html, subject } = kind.render(`Ac${RLO}me${LRI}`);
    expect(html).not.toContain(RLO);
    expect(html).not.toContain(LRI);
    expect(subject).not.toContain(RLO);
    expect(html.match(/<table\b/gu)?.length).toBe(html.match(/<\/table>/gu)?.length);
  });

  it('lets a very long name wrap instead of widening the page', () => {
    const name = 'Northwind '.repeat(40) + 'x'.repeat(300);
    const { html } = kind.render(name);
    expect(html).toMatch(
      /<td[^>]*word-break:break-word;overflow-wrap:anywhere[^>]*><bdi>Northwind/u,
    );
    expect(Buffer.byteLength(html)).toBeLessThan(60_000);
  });

  it('keeps an emoji name and a right-to-left name as typed', () => {
    expect(kind.render('Café \u{1f680}\u{1f9d1}‍\u{1f4bb}').html).toContain(
      '<bdi>Café \u{1f680}\u{1f9d1}‍\u{1f4bb}</bdi>',
    );
    expect(kind.render('شركة المثال').html).toContain('<bdi>شركة المثال</bdi>');
  });

  it('[ODUDU-THEME-MAILHEADER-01] keeps line breaks out of the subject', () => {
    const { subject } = kind.render('Acme\r\nBcc: x@example.test');
    expect(subject).not.toMatch(/[\r\n]/u);
  });
});

describe('the table of kinds', () => {
  it('holds every renderer the package exports', async () => {
    const exported = Object.keys(await import('#/service/templates')).filter((name) =>
      name.startsWith('render'),
    );
    expect(exported.length).toBe(Object.keys(kinds).length);
  });
});

describe.each(each)('the %s mail preheader', (_name, kind) => {
  const { html } = kind.render('Demo');

  it('is the first thing in the body, hidden from view and from Outlook, padded out', () => {
    const body = html.slice(html.indexOf('<body'));
    const hidden = /^<body[^>]*><div style="([^"]*)">([^<]*)<\/div>/u.exec(body);
    expect(hidden).not.toBeNull();
    expect(hidden?.[1]).toContain('display:none');
    expect(hidden?.[1]).toContain('max-height:0');
    expect(hidden?.[1]).toContain('overflow:hidden');
    expect(hidden?.[1]).toContain('mso-hide:all');
    const [sentence = '', padding = ''] = (hidden?.[2] ?? '').split('‌');
    expect(sentence.length).toBeGreaterThan(20);
    expect(sentence).not.toContain('odudu');
    expect(padding.length + (hidden?.[2] ?? '').length).toBeGreaterThan(100);
  });
});

describe('the preheader sentences', () => {
  it('differ per kind and come from the catalogue', () => {
    const sentences = each.map(([, kind]) => {
      const html = kind.render('Demo').html;
      return /^<body[^>]*><div[^>]*>([^<‌]*)/u.exec(html.slice(html.indexOf('<body')))?.[1];
    });
    expect(new Set(sentences).size).toBe(each.length);
  });
});

describe('renderShell given a link of its own', () => {
  const base = {
    locale: { tag: 'en', dir: 'ltr' as const },
    tenant: 'Demo',
    now: NOW,
    heading: 'h',
    preheader: 'p',
    blocks: [],
    reason: 'r',
  };

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,x'],
    ['/relative'],
    [' https://x.test/'],
    ['https://x.test/ '],
    ['https://user:secret@x.test/'],
    ['https://user@x.test/'],
    ['https://x.test/\u0001'],
    ['https://x.test/\nBcc: y'],
    ['https://x.test/ '],
    [''],
  ])('refuses %j', (href) => {
    expect(() => renderShell({ ...base, action: { label: 'Go', href } })).toThrow(RangeError);
  });

  it('accepts a plain https and a plain http address', () => {
    for (const href of ['https://x.test/a?b=c', 'http://localhost:3000/x']) {
      expect(renderShell({ ...base, action: { label: 'Go', href } })).toContain(`href="${href}"`);
    }
  });
});

describe('a link with + and %2F in it', () => {
  const link = 'https://idp.example/x?key=a+b%2Fc&next=%2Fhome%3Fx%3D1';

  it('reaches the href, the shown text and the plain text unchanged', () => {
    const msg = renderVerifyEmail({
      to: 'a@b.test',
      link,
      tenantDisplayName: 'Demo',
      now: NOW,
    });
    const anchors = msg.html.match(/<a\b[^>]*>[^<]*<\/a>/gu) ?? [];
    expect(anchors).toHaveLength(2);
    for (const anchor of anchors) {
      expect(attr(anchor, 'href')[0]).toBe(link.replaceAll('&', '&amp;'));
    }
    expect(unescape(anchors[1]?.replace(/<[^>]*>/gu, '') ?? '')).toBe(link);
    expect(msg.text.split('\n')).toContain(link);
  });
});

describe('a very long tenant name', () => {
  const long = 'N'.repeat(10_000);

  it.each(each)(
    'is shortened with an ellipsis in the %s mail, escaped after the cut',
    (_n, kind) => {
      const { html, text, subject } = kind.render(long);
      expect(Buffer.byteLength(html)).toBeLessThan(14_000);
      expect(text.length).toBeLessThan(3_000);
      expect(subject.length).toBeLessThan(300);
      expect(html).toContain('…</bdi>');
      expect(html).not.toContain('N'.repeat(200));
    },
  );

  it('cuts before escaping, so markup cannot grow the page', () => {
    const { html } = kind0().render('<'.repeat(10_000));
    expect(html.match(/&lt;/gu)?.length ?? 0).toBeLessThan(1_000);
    expect(html).not.toMatch(/&l?t?…/u);
  });

  it('never splits a surrogate pair', () => {
    const { html } = kind0().render('\u{1f680}'.repeat(5_000));
    expect(html).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/u);
  });

  it('leaves a name of ordinary length alone', () => {
    expect(kind0().render('Northwind International Holdings').html).toContain(
      '<bdi>Northwind International Holdings</bdi>',
    );
  });
});

function kind0(): Kind {
  const first = each[0]?.[1];
  if (first === undefined) throw new Error('no kinds');
  return first;
}
