import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  INSTRUMENT_STYLESHEET,
  brandMarkup,
  brandingHead,
  brandingProblems,
  mainClass,
  pageHeaders,
  reloadOnRestore,
  withBranding,
  type ResolvedBranding,
} from '#/page';
import { PAGE_KINDS, type PageKind } from '#/page-kinds';

const headerMap = (page: Parameters<typeof pageHeaders>[0]): Record<string, string> =>
  Object.fromEntries(pageHeaders(page).map(([name, value]) => [name, value]));

const MARKUP_ONLY_PAGE = {
  html: '<!doctype html>',
  body: '<!doctype html>',
  title: 'Untitled',
  script: null,
  frames: [],
  locale: { tag: 'en', dir: 'ltr' as const },
};

describe('the headers every rendered page carries', () => {
  it('describes a markup-only page as needing nothing', () => {
    const csp = headerMap(MARKUP_ONLY_PAGE)['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
  });

  it('licenses a same-origin stylesheet, font and image on every page', () => {
    const csp = headerMap(MARKUP_ONLY_PAGE)['content-security-policy'] ?? '';
    const directives = csp.split('; ');
    expect(directives).toContain("style-src 'self'");
    expect(directives).toContain("font-src 'self'");
    expect(directives).toContain("img-src 'self'");
    expect(directives).toContain("default-src 'none'");
    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
  });

  it('names the stylesheet the pages link', () => {
    expect(INSTRUMENT_STYLESHEET).toBe('/instrument/instrument.css');
  });

  it('sends exactly six headers, one of them forbidding a sniffed content type', () => {
    const headers = headerMap(MARKUP_ONLY_PAGE);
    expect(headers['content-security-policy']).toBe(
      [
        "default-src 'none'",
        "style-src 'self'",
        "font-src 'self'",
        "img-src 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'none'",
      ].join('; '),
    );
    expect(Object.keys(headers).sort()).toEqual([
      'cache-control',
      'content-language',
      'content-security-policy',
      'referrer-policy',
      'x-content-type-options',
      'x-frame-options',
    ]);
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['cache-control']).toBe('no-store');
  });

  it('sends Content-Language from the negotiated locale', () => {
    expect(headerMap(MARKUP_ONLY_PAGE)['content-language']).toBe('en');
    expect(
      headerMap({ ...MARKUP_ONLY_PAGE, locale: { tag: 'ar-EG', dir: 'rtl' } })['content-language'],
    ).toBe('ar-EG');
  });

  it('carries the framing defence and the referrer policy on every page', () => {
    const headers = headerMap(MARKUP_ONLY_PAGE);
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
  });

  it('forbids every cache from storing a page', () => {
    expect(headerMap(MARKUP_ONLY_PAGE)['cache-control']).toBe('no-store');
    expect(
      headerMap({ ...MARKUP_ONLY_PAGE, script: { nonce: 'abc', fetchesSameOrigin: false } })[
        'cache-control'
      ],
    ).toBe('no-store');
  });

  // The nonce comes from the markup that used it, never from the caller:
  // a policy naming a nonce the page does not carry fails exactly as
  // silently as no policy at all (ADR 0018's amendment).
  it('derives script-src from the nonce the page reports', () => {
    const csp = headerMap({
      html: '<script nonce="abc">',
      body: '<script nonce="abc">',
      title: 'Untitled',
      script: { nonce: 'abc', fetchesSameOrigin: false },
      frames: [],
      locale: { tag: 'en', dir: 'ltr' as const },
    })['content-security-policy'];
    expect(csp).toContain("script-src 'nonce-abc'");
    expect(csp).not.toContain('connect-src');
  });

  it('licenses connect-src only for a script that actually fetches', () => {
    const csp = headerMap({
      html: '<script nonce="abc">',
      body: '<script nonce="abc">',
      title: 'Untitled',
      script: { nonce: 'abc', fetchesSameOrigin: true },
      frames: [],
      locale: { tag: 'en', dir: 'ltr' as const },
    })['content-security-policy'];
    expect(csp).toContain("connect-src 'self'");
  });

  it('names no frame-src for a page that frames nothing', () => {
    const csp = headerMap(MARKUP_ONLY_PAGE)['content-security-policy'];
    expect(csp).not.toContain('frame-src');
    expect(csp).toContain("default-src 'none'");
  });

  it('derives frame-src from the origins the page itself carries', () => {
    const csp = headerMap({
      ...MARKUP_ONLY_PAGE,
      frames: ['https://rp.example', 'https://other.example'],
    })['content-security-policy'];
    expect(csp).toContain('frame-src https://rp.example https://other.example');
  });

  it('keeps x-frame-options DENY for a page that frames others', () => {
    const headers = headerMap({ ...MARKUP_ONLY_PAGE, frames: ['https://rp.example'] });
    expect(headers['x-frame-options']).toBe('DENY');
  });

  // The origins come from a row per relying party, and two clients may
  // register logout URIs on one host.
  it('deduplicates repeated origins rather than repeating them in the policy', () => {
    const csp = headerMap({
      ...MARKUP_ONLY_PAGE,
      frames: ['https://rp.example', 'https://rp.example'],
    })['content-security-policy'];
    expect(csp).toContain('frame-src https://rp.example');
    expect(csp?.match(/rp\.example/gu)).toHaveLength(1);
  });

  // `new URL('https://a.test;script-src/x').origin` keeps the semicolon, so
  // an origin from a registered URI can open a directive of its own.
  it('names no origin that is not a plain host, so none can add a directive', () => {
    const csp = headerMap({
      ...MARKUP_ONLY_PAGE,
      frames: ['https://rp.example', 'https://a.test;sandbox', "https://a.test 'self'", 'null'],
    })['content-security-policy'];
    expect(csp).toContain('frame-src https://rp.example');
    expect(csp).not.toContain('sandbox');
    expect(csp?.split('; ').filter((directive) => directive.startsWith('frame-src'))).toEqual([
      'frame-src https://rp.example',
    ]);
  });

  it('names no frame-src when none of the origins is a plain host', () => {
    const csp = headerMap({ ...MARKUP_ONLY_PAGE, frames: ['https://a.test;sandbox'] })[
      'content-security-policy'
    ];
    expect(csp).not.toContain('frame-src');
  });
});

// Chromium applies form-action to every redirect a form submission follows,
// so a login form whose POST answers 302 to a relying party on another
// origin is refused there unless the policy names that origin.
describe('form-action on a page whose form may redirect to a client', () => {
  const formAction = (redirectsTo: string | undefined): string | undefined =>
    headerMap({ ...MARKUP_ONLY_PAGE, ...(redirectsTo === undefined ? {} : { redirectsTo }) })
      ['content-security-policy']?.split('; ')
      .find((directive) => directive.startsWith('form-action'));

  it("keeps 'self' alone for a page that names no client redirect", () => {
    expect(formAction(undefined)).toBe("form-action 'self'");
  });

  it('adds the origin of the redirect URI, never its path or query', () => {
    expect(formAction('https://rp.example:8443/callback?x=1')).toBe(
      "form-action 'self' https://rp.example:8443",
    );
    expect(formAction('http://localhost:8080/cb')).toBe("form-action 'self' http://localhost:8080");
  });

  it('names the scheme alone for a private-use URI scheme', () => {
    expect(formAction('com.example.app:/oauth2redirect')).toBe(
      "form-action 'self' com.example.app:",
    );
  });

  it('adds nothing for a value it cannot express as a source', () => {
    for (const value of [
      '',
      'not a uri',
      'https://a;b.example/',
      'javascript:alert(1)',
      'data:,x',
    ]) {
      expect(formAction(value)).toBe("form-action 'self'");
    }
    expect(formAction("https://rp.example/'none'")).toBe("form-action 'self' https://rp.example");
  });
});

// A page restored from the back/forward cache is the DOM it was left with,
// whatever its headers said, so a form bound to a session that has since
// expired comes back alive-looking. `pageshow` with `persisted` is the one
// signal a restore gives.
describe('reloading a form restored from the back/forward cache', () => {
  const PAGE = {
    html: '<!doctype html>\n<html><body>\n<form></form>\n</body></html>',
    body: '<form></form>',
    title: 'Sign in',
    script: null,
    frames: [],
    locale: { tag: 'en', dir: 'ltr' as const },
  };
  const SCRIPT_ELEMENT =
    /<script nonce="([^"]+)">[^<]*pageshow[^<]*persisted[^<]*reload\(\)[^<]*<\/script>/u;

  it('adds one script, in the document and in the body a theme is handed', () => {
    const page = reloadOnRestore(PAGE);
    expect(page.script).not.toBeNull();
    for (const markup of [page.html, page.body]) {
      expect(markup.match(/<script/gu)).toHaveLength(1);
      expect(SCRIPT_ELEMENT.exec(markup)?.[1]).toBe(page.script?.nonce);
    }
    expect(page.html.indexOf('<script')).toBeLessThan(page.html.indexOf('</body>'));
  });

  it('licenses exactly that nonce in the policy, and no request', () => {
    const page = reloadOnRestore(PAGE);
    const csp = headerMap(page)['content-security-policy'];
    expect(csp).toContain(`script-src 'nonce-${page.script?.nonce ?? ''}'`);
    expect(csp).not.toContain('connect-src');
  });

  it('shares the nonce of a script the page already carries', () => {
    const page = reloadOnRestore({
      ...PAGE,
      html: PAGE.html.replace('<form></form>', '<form></form><script nonce="abc">1</script>'),
      body: '<form></form><script nonce="abc">1</script>',
      script: { nonce: 'abc', fetchesSameOrigin: true },
    });
    expect(page.script).toEqual({ nonce: 'abc', fetchesSameOrigin: true });
    expect(page.body.match(/nonce="abc"/gu)).toHaveLength(2);
    expect(page.body.match(/nonce="/gu)).toHaveLength(2);
    expect(headerMap(page)['content-security-policy']).toContain("connect-src 'self'");
  });

  it('mints a different nonce for each page', () => {
    expect(reloadOnRestore(PAGE).script?.nonce).not.toBe(reloadOnRestore(PAGE).script?.nonce);
  });

  it('leaves the rest of the page as it was', () => {
    const page = reloadOnRestore(PAGE);
    expect(page.title).toBe('Sign in');
    expect(page.html.startsWith('<!doctype html>\n<html><body>\n<form></form>')).toBe(true);
    expect(page.html.endsWith('\n</body></html>')).toBe(true);
  });
});

// The script text itself, run against a stand-in window: no bfcache exists
// in the browsers CI drives, so the one decision it makes is held here.
describe('what the reload script does when run', () => {
  const PAGE = {
    html: '<html><body>\n</body></html>',
    body: '',
    title: 'Sign in',
    script: null,
    frames: [],
    locale: { tag: 'en', dir: 'ltr' as const },
  };

  function run(): { fire(persisted: boolean): void; reloads: () => number } {
    const text = /<script nonce="[^"]+">([^<]*)<\/script>/u.exec(reloadOnRestore(PAGE).body)?.[1];
    let handler: ((event: { persisted: boolean }) => void) | undefined;
    let reloads = 0;
    const events: string[] = [];
    const window = {
      addEventListener(type: string, listener: (event: { persisted: boolean }) => void) {
        events.push(type);
        handler = listener;
      },
    };
    const location = { reload: () => (reloads += 1) };
    runInNewContext(text ?? '', { window, location });
    expect(events).toEqual(['pageshow']);
    return {
      fire: (persisted) => handler?.({ persisted }),
      reloads: () => reloads,
    };
  }

  it('does nothing when it is loaded, so a reload cannot start another', () => {
    expect(run().reloads()).toBe(0);
  });

  it('reloads on a restore and not on an ordinary show', () => {
    const page = run();
    page.fire(false);
    expect(page.reloads()).toBe(0);
    page.fire(true);
    expect(page.reloads()).toBe(1);
  });
});

describe('the locale a page is sent under', () => {
  it('refuses a direction that is neither ltr nor rtl', () => {
    const page = { ...MARKUP_ONLY_PAGE, locale: { tag: 'en', dir: 'up' as never } };
    expect(() => pageHeaders(page)).toThrow();
  });

  it('refuses a tag that could break out of the header', () => {
    for (const tag of ['en\r\nX: y', 'en"><script>', '', 'x'.repeat(36)]) {
      expect(() => pageHeaders({ ...MARKUP_ONLY_PAGE, locale: { tag, dir: 'ltr' } })).toThrow();
    }
  });
});

const BASE = [
  "default-src 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'none'",
];
const FIXED_HEADERS = [
  ['x-frame-options', 'DENY'],
  ['referrer-policy', 'no-referrer'],
  ['cache-control', 'no-store'],
  ['x-content-type-options', 'nosniff'],
  ['content-language', 'en'],
];
const withCsp = (directives: string[]): (readonly [string, string])[] => [
  ['content-security-policy', directives.join('; ')],
  ...(FIXED_HEADERS as [string, string][]),
];

const ORIGIN = 'https://idp.example';
const branding = (over: Partial<ResolvedBranding> = {}): ResolvedBranding => ({
  origin: ORIGIN,
  templates: {},
  tokensCss: ':root{--x:1}',
  stylesheetUrl: '/t/acme/theme/abc123.css',
  faviconUrl: '/t/acme/theme/fav456.png',
  logo: { url: '/t/acme/theme/logo789.png', darkUrl: null, alt: 'Acme' },
  assetUrls: ['/t/acme/theme/logo789.png'],
  ...over,
});
const themed = (b: ResolvedBranding | null, over = {}): Parameters<typeof pageHeaders>[0] => ({
  ...MARKUP_ONLY_PAGE,
  ...over,
  locale: withBranding(MARKUP_ONLY_PAGE.locale, b),
});

describe('a page without branding', () => {
  it("has today's headers exactly", () => {
    expect(pageHeaders(MARKUP_ONLY_PAGE)).toEqual(withCsp(BASE));
    expect(
      pageHeaders({ ...MARKUP_ONLY_PAGE, script: { nonce: 'abc', fetchesSameOrigin: true } }),
    ).toEqual(withCsp([...BASE, "script-src 'nonce-abc'", "connect-src 'self'"]));
    expect(pageHeaders({ ...MARKUP_ONLY_PAGE, frames: ['https://rp.example'] })).toEqual(
      withCsp([...BASE, 'frame-src https://rp.example']),
    );
    expect(pageHeaders({ ...MARKUP_ONLY_PAGE, redirectsTo: 'https://rp.example/cb' })).toEqual(
      withCsp([...BASE.slice(0, 5), "form-action 'self' https://rp.example", BASE[6] ?? '']),
    );
  });

  it('is what withBranding(null) leaves', () => {
    expect(withBranding(MARKUP_ONLY_PAGE.locale, null)).toEqual(MARKUP_ONLY_PAGE.locale);
  });
});

describe('a themed page', () => {
  it('lists only its own asset urls in img-src and style-src', () => {
    const csp = headerMap(themed(branding()))['content-security-policy'] ?? '';
    expect(csp.split('; ')).toEqual([
      "default-src 'none'",
      `style-src ${ORIGIN}${INSTRUMENT_STYLESHEET} ${ORIGIN}/t/acme/theme/abc123.css`,
      "font-src 'self'",
      `img-src ${ORIGIN}/t/acme/theme/logo789.png ${ORIGIN}/t/acme/theme/fav456.png`,
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
    ]);
  });

  it('keeps the other directives, script-src and the framing defence as they were', () => {
    const page = themed(branding(), {
      script: { nonce: 'abc', fetchesSameOrigin: false },
      frames: ['https://rp.example'],
    });
    const csp = headerMap(page)['content-security-policy'] ?? '';
    expect(csp.split('; ').filter((d) => !/^(style|img)-src /u.test(d))).toEqual([
      "default-src 'none'",
      "font-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'none'",
      "script-src 'nonce-abc'",
      'frame-src https://rp.example',
    ]);
  });

  it('keeps the instrument favicons when the theme brings none', () => {
    const csp = headerMap(themed(branding({ faviconUrl: null, logo: null, assetUrls: [] })))[
      'content-security-policy'
    ];
    expect(csp).toContain(
      `img-src ${ORIGIN}/instrument/favicon.svg ${ORIGIN}/instrument/favicon.ico`,
    );
  });

  const BAD = [
    'https://evil/x',
    '//evil/x',
    '/a b',
    '/a;b',
    '/a,b',
    "/a'b",
    '/a"b',
    '/a*b',
    '/a\nb',
    '/a\u0000',
    `/${'a'.repeat(256)}`,
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'a/relative',
    '/a?x=1',
    '/',
    '/a//b',
    '/a/./b',
    '/a/../b',
    '/a/.',
    '/a/..',
    '/.',
    '/..',
    '/x/',
    '/a/b/',
    '',
    '/a#f',
  ];
  it.each(BAD)('refuses an asset url that is not a same-origin path: %j', (url) => {
    expect(() => pageHeaders(themed(branding({ assetUrls: [url] })))).toThrow(/branding/u);
    expect(() => pageHeaders(themed(branding({ stylesheetUrl: url })))).toThrow(/branding/u);
    expect(() => pageHeaders(themed(branding({ faviconUrl: url })))).toThrow(/branding/u);
    expect(() => brandingHead(themed(branding({ stylesheetUrl: url })).locale)).toThrow(
      /branding/u,
    );
  });

  it.each(BAD)('reports, without throwing, an asset url that is not a path: %j', (url) => {
    expect(brandingProblems(branding({ assetUrls: [url] })).length).toBeGreaterThan(0);
    expect(brandingProblems(branding({ stylesheetUrl: url })).length).toBeGreaterThan(0);
    expect(brandingProblems(branding({ faviconUrl: url })).length).toBeGreaterThan(0);
  });

  it('reports nothing for a valid branding, and an origin or count problem by name', () => {
    expect(brandingProblems(branding())).toEqual([]);
    expect(brandingProblems(branding({ origin: 'https://a; x' }))).toHaveLength(1);
    const many = Array.from({ length: 17 }, (_, i) => `/t/a/${String(i)}.png`);
    expect(brandingProblems(branding({ assetUrls: many }))).toEqual(['more than 16 urls']);
  });

  it('refuses an origin that is not an origin', () => {
    for (const origin of ['https://a; script-src *', '/x', 'https://a/b', '']) {
      expect(() => pageHeaders(themed(branding({ origin })))).toThrow(/branding/u);
    }
  });

  it('refuses more than 16 urls', () => {
    const urls = (n: number): string[] =>
      Array.from({ length: n }, (_, i) => `/t/a/${String(i)}.png`);
    expect(() =>
      pageHeaders(
        themed(
          branding({ assetUrls: urls(16), faviconUrl: null, logo: null, stylesheetUrl: null }),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      pageHeaders(
        themed(
          branding({ assetUrls: urls(17), faviconUrl: null, logo: null, stylesheetUrl: null }),
        ),
      ),
    ).toThrow(/branding/u);
  });
});

describe('the head a themed page adds', () => {
  const STOCK =
    '<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">\n' +
    '<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">';

  it('is the stock favicons alone without branding', () => {
    expect(brandingHead(MARKUP_ONLY_PAGE.locale)).toBe(STOCK);
  });

  it('puts the tenant stylesheet and favicon in place of the stock favicons', () => {
    expect(brandingHead(themed(branding()).locale)).toBe(
      '<link rel="stylesheet" href="/t/acme/theme/abc123.css">\n' +
        '<link rel="icon" href="/t/acme/theme/fav456.png">',
    );
  });

  it('keeps the stock favicons when the theme has none', () => {
    const head = brandingHead(themed(branding({ faviconUrl: null })).locale);
    expect(head).toBe('<link rel="stylesheet" href="/t/acme/theme/abc123.css">\n' + STOCK);
  });
});

describe('brandingProblems is total and agrees with what is sent', () => {
  it.each(['/a/b.css', '/.well-known/x', '/a-b_c.d~e', '/~'])('accepts %s', (url) => {
    expect(brandingProblems(branding({ assetUrls: [url] }))).toEqual([]);
  });

  it('quotes a bounded part of a huge value', () => {
    const huge = `/${'a'.repeat(1e7)}`;
    const started = Date.now();
    const problems = [
      ...brandingProblems(branding({ stylesheetUrl: huge })),
      ...brandingProblems(branding({ origin: huge })),
      ...brandingProblems(branding({ assetUrls: [huge] })),
    ];
    expect(Date.now() - started).toBeLessThan(2000);
    expect(problems).toHaveLength(3);
    for (const problem of problems) expect(problem.length).toBeLessThan(140);
  });

  const good = (): Record<string, unknown> => ({ ...branding() });
  const throwing = (): unknown => {
    const o = good();
    Object.defineProperty(o, 'origin', {
      get() {
        throw new Error('boom');
      },
    });
    return o;
  };
  const cyclic = (): unknown => {
    const o: Record<string, unknown> = good();
    o.assetUrls = [o];
    return o;
  };
  const nullProto = (): unknown => Object.assign(Object.create(null) as object, good());
  const MALFORMED: [string, unknown][] = [
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['a string', 'x'],
    ['an array', []],
    ['an empty object', {}],
    ['assetUrls string', { ...good(), assetUrls: '/a' }],
    ['assetUrls object', { ...good(), assetUrls: {} }],
    ['assetUrls numbers', { ...good(), assetUrls: [1, 2] }],
    ['assetUrls sparse', { ...good(), assetUrls: new Array<string>(2) }],
    ['assetUrls symbol', { ...good(), assetUrls: [Symbol('x')] }],
    ['url array', { ...good(), stylesheetUrl: ['/a'] }],
    ['url symbol', { ...good(), stylesheetUrl: Symbol('x') }],
    ['url null-prototype', { ...good(), faviconUrl: Object.create(null) as object }],
    ['origin number', { ...good(), origin: 5 }],
    ['origin array', { ...good(), origin: [ORIGIN] }],
    ['logo string', { ...good(), logo: 'x' }],
    ['logo without alt', { ...good(), logo: { url: '/a', darkUrl: null } }],
    ['logo url number', { ...good(), logo: { url: 1, darkUrl: null, alt: '' } }],
    ['templates null', { ...good(), templates: null }],
    ['tokensCss number', { ...good(), tokensCss: 1 }],
    ['throwing getter', throwing()],
    [
      'throwing proxy',
      new Proxy(
        {},
        {
          get() {
            throw new Error('boom');
          },
        },
      ),
    ],
    ['cyclic', cyclic()],
  ];

  it.each(MALFORMED)('reports %s and every consumer refuses it', (name, value) => {
    const problems = brandingProblems(value);
    expect(Array.isArray(problems)).toBe(true);
    expect(problems.length).toBeGreaterThan(0);
    if (name === 'undefined') return; // an absent branding is no branding
    const locale = { tag: 'en', dir: 'ltr' as const, branding: value as ResolvedBranding };
    expect(() => pageHeaders({ ...MARKUP_ONLY_PAGE, locale })).toThrow();
    expect(() => brandingHead(locale)).toThrow();
  });

  it('accepts a valid branding with a null prototype', () => {
    expect(brandingProblems(nullProto())).toEqual([]);
  });

  it('agrees with pageHeaders and brandingHead over 2,000 random shapes', () => {
    let seed = 7;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const atoms: unknown[] = [
      null,
      undefined,
      0,
      '',
      '/a',
      '/a/',
      '/a//b',
      '/a/../b',
      ['/a'],
      [],
      {},
      ORIGIN,
      'https://x',
      Symbol('s'),
      '/' + 'a'.repeat(300),
      { url: '/l', darkUrl: null, alt: 'x' },
    ];
    const pick = (): unknown => atoms[rnd(atoms.length)];
    for (let i = 0; i < 2000; i += 1) {
      const value = {
        origin: rnd(3) === 0 ? pick() : ORIGIN,
        templates: rnd(4) === 0 ? pick() : {},
        tokensCss: rnd(4) === 0 ? pick() : '',
        stylesheetUrl: pick(),
        faviconUrl: pick(),
        logo: rnd(2) === 0 ? null : pick(),
        assetUrls: rnd(3) === 0 ? pick() : [pick(), pick()],
      };
      const locale = { tag: 'en', dir: 'ltr' as const, branding: value as ResolvedBranding };
      const ok = brandingProblems(value).length === 0;
      const run = (f: () => unknown): boolean => {
        try {
          f();
          return true;
        } catch {
          return false;
        }
      };
      expect(run(() => pageHeaders({ ...MARKUP_ONLY_PAGE, locale }))).toBe(ok);
      expect(run(() => brandingHead(locale))).toBe(ok);
    }
  });
});

describe('brandingProblems reads assetUrls.length once', () => {
  const urls = (n: number): string[] =>
    Array.from({ length: n }, (_, i) => `/t/a/${String(i)}.png`);
  const lying = (lengths: number[], items: string[] = urls(100)): unknown => {
    let reads = 0;
    return new Proxy(items, {
      get(target, key) {
        if (key === 'length') {
          const at = Math.min(reads, lengths.length - 1);
          reads += 1;
          return lengths[at];
        }
        return Reflect.get(target, key) as unknown;
      },
    });
  };
  const sources = (value: unknown): number => {
    const csp =
      headerMap(themed(branding({ assetUrls: value as string[], faviconUrl: null, logo: null })))[
        'content-security-policy'
      ] ?? '';
    return (csp.split('; ').find((d) => d.startsWith('img-src ')) ?? '').split(' ').length - 1;
  };

  it.each([
    ['1 then 100', [1, 100]],
    ['1 then 1e9', [1, 1e9]],
    ['16, 16, 17', [16, 16, 17]],
  ])('holds the cap and returns promptly for length %s', (_name, lengths) => {
    const started = Date.now();
    const value = lying(lengths);
    const problems = brandingProblems(branding({ assetUrls: value as string[] }));
    let emitted = 0;
    try {
      emitted = sources(lying(lengths));
    } catch {
      emitted = 0;
    }
    expect(Date.now() - started).toBeLessThan(2000);
    expect(emitted).toBeLessThanOrEqual(16 + 2);
    expect(Array.isArray(problems)).toBe(true);
  });

  it('copies at most the length it read when an element getter grows the array', () => {
    const grower = (): string[] => {
      const items = urls(4);
      Object.defineProperty(items, 0, {
        get() {
          for (let i = 0; i < 50; i += 1) items.push('/t/a/extra.png');
          return '/t/a/zero.png';
        },
      });
      return items;
    };
    expect(brandingProblems(branding({ assetUrls: grower() }))).toEqual([]);
    expect(sources(grower())).toBeLessThanOrEqual(16);
  });
});

describe('a problem message is one clean line', () => {
  it.each(['\n', '\r', '\u001b', '\u2028', '\u2029'])('escapes %j in a url', (ch) => {
    const [problem] = brandingProblems(branding({ stylesheetUrl: `/a${ch}b` }));
    expect(problem).toBeDefined();
    expect(problem).not.toMatch(/[\u0000-\u001f\u2028\u2029]/u);
  });
});

describe('a hostile assetUrls length', () => {
  const counted = (lengths: unknown[]): unknown => {
    let reads = 0;
    return new Proxy(['/t/a/0.png'], {
      get(target, key, receiver) {
        if (key !== 'length') return Reflect.get(target, key, receiver) as unknown;
        const value = lengths[Math.min(reads, lengths.length - 1)];
        reads += 1;
        return value;
      },
    });
  };
  const flip = (first: number, then: number): unknown => {
    let c = 0;
    return {
      valueOf() {
        c += 1;
        return c === 1 ? first : then;
      },
    };
  };
  const CASES: [string, unknown][] = [
    ['valueOf 1 then 1e9', flip(1, 1e9)],
    ['valueOf 1 then 100', flip(1, 100)],
    ['symbol', Symbol('n')],
    ['bigint', 1n],
    ['string', '1'],
    ['NaN', Number.NaN],
    ['-1', -1],
    ['1.5', 1.5],
    ['Infinity', Number.POSITIVE_INFINITY],
  ];
  it.each(CASES)('reports %s without looping', (_name, length) => {
    const started = Date.now();
    const problems = brandingProblems(branding({ assetUrls: counted([length]) as string[] }));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(problems.length).toBeGreaterThan(0);
  });
});

describe('a problem message stays short and clean', () => {
  const NASTY: [string, string][] = [
    ['lone surrogates', '/' + '\ud800'.repeat(80)],
    ['line separators', '/' + '\u2028'.repeat(500)],
    ['backslashes', '/' + '\\'.repeat(100)],
    ['emoji', '/' + '\u{1f600}'.repeat(200)],
    ['bidi and C1', '/a\u0085\u007f\u009b\u202e\u2066\u200f\u061cb'],
  ];
  it.each(NASTY)('bounds and escapes %s', (_name, url) => {
    const [problem] = brandingProblems(branding({ stylesheetUrl: url }));
    expect(problem?.length).toBeLessThanOrEqual(200);
    expect(problem).not.toMatch(
      /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u,
    );
  });
});

describe('a quoted value in a problem message', () => {
  it('escapes zero-width and joiner characters, which print as nothing', () => {
    const [problem] = brandingProblems(branding({ stylesheetUrl: '/a​‌‍⁠﻿b' }));
    expect(problem).not.toMatch(/[​-‍⁠﻿]/u);
    expect(problem).toContain('\\u200b');
    expect(problem).toContain('\\ufeff');
  });

  it('says it was cut with one ellipsis, then how long the value was', () => {
    const [cut] = brandingProblems(branding({ stylesheetUrl: `/${'‮'.repeat(60)}` }));
    expect(cut).toMatch(/…\s\(61 chars\)$/u);
    expect(cut).not.toContain('……');
    const [long] = brandingProblems(branding({ stylesheetUrl: `/${'a'.repeat(100)}^` }));
    expect(long).toMatch(/[^…]…\s\(102 chars\)$/u);
  });
});

describe('brandMarkup', () => {
  const MARK = '<svg class="mark"></svg>';
  const STOCK = `<p class="brand">${MARK}<span class="wordmark">odudu</span></p>`;

  it('is the default mark and the wordmark without branding or a logo', () => {
    expect(brandMarkup(MARKUP_ONLY_PAGE.locale, MARK)).toBe(STOCK);
    expect(brandMarkup(themed(branding({ logo: null })).locale, MARK)).toBe(STOCK);
  });

  it('is one image for a logo and two when it has a dark variant', () => {
    expect(brandMarkup(themed(branding()).locale, MARK)).toBe(
      '<p class="brand"><img class="logo" src="/t/acme/theme/logo789.png" alt="Acme"></p>',
    );
    const dark = branding({ logo: { url: '/l.png', darkUrl: '/d.png', alt: 'A' } });
    expect(brandMarkup(themed(dark).locale, MARK)).toBe(
      '<p class="brand"><img class="logo logo-light" src="/l.png" alt="A">' +
        '<img class="logo logo-dark" src="/d.png" alt="A"></p>',
    );
  });

  it('escapes the alt text', () => {
    const hostile = branding({ logo: { url: '/l.png', darkUrl: null, alt: '"><b>&' } });
    expect(brandMarkup(themed(hostile).locale, MARK)).toContain('alt="&quot;>&lt;b>&amp;"');
  });

  it('refuses a branding that fails validation, an empty alt among them', () => {
    const bad = branding({ logo: { url: '/l.png', darkUrl: null, alt: '' } });
    expect(brandingProblems(bad)).not.toEqual([]);
    expect(() => brandMarkup(themed(bad).locale, MARK)).toThrow(/branding/u);
    const url = branding({ logo: { url: 'https://evil.example/l.png', darkUrl: null, alt: 'A' } });
    expect(() => brandMarkup(themed(url).locale, MARK)).toThrow(/branding/u);
  });

  it('refuses a blank or overlong alt, quoting a bounded part of it', () => {
    const blank = branding({ logo: { url: '/l.png', darkUrl: null, alt: ' \n ' } });
    expect(brandingProblems(blank)).toEqual(['logo.alt is empty']);
    const huge = branding({ logo: { url: '/l.png', darkUrl: null, alt: 'x'.repeat(10_000_000) } });
    const problems = brandingProblems(huge);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^logo\.alt is longer than 200 characters: /u);
    expect(problems[0]?.length).toBeLessThan(200);
    const exact = branding({ logo: { url: '/l.png', darkUrl: null, alt: 'x'.repeat(200) } });
    expect(brandingProblems(exact)).toEqual([]);
  });

  it('reads the logo from one validated copy', () => {
    let reads = 0;
    const logo = {
      get url(): string {
        reads += 1;
        return reads === 1 ? '/ok.png' : 'https://evil.example/x.png';
      },
      darkUrl: null,
      alt: 'A',
    };
    const out = brandMarkup(themed(branding({ logo })).locale, MARK);
    expect(out).not.toContain('evil');
  });
});

describe('the class of the main element', () => {
  it('is `page` alone for an unthemed page, whatever its kind', () => {
    expect(mainClass(MARKUP_ONLY_PAGE.locale)).toBe('page');
    expect(mainClass(MARKUP_ONLY_PAGE.locale, 'sign-in')).toBe('page');
  });

  it('adds the kind to a themed page', () => {
    expect(mainClass(themed(branding()).locale, 'sign-in')).toBe('page page-sign-in');
  });

  it('is `page` alone for a themed page outside any tenant, which has no kind', () => {
    expect(mainClass(themed(branding()).locale)).toBe('page');
  });

  it('names every kind there is, and refuses a name that is not one', () => {
    for (const kind of Object.keys(PAGE_KINDS) as PageKind[]) {
      expect(mainClass(themed(branding()).locale, kind)).toBe(`page page-${kind}`);
    }
    for (const hostile of ['"><script>', '__proto__', 'toString', 'constructor']) {
      expect(mainClass(themed(branding()).locale, hostile as PageKind)).toBe('page');
    }
  });
});
