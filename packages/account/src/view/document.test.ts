import { pageHeaders, type PageLocale, type ResolvedBranding } from '@odudu/kernel';
import { describe, expect, it } from 'vitest';
import { intro, page } from '#/view/document';

describe('page', () => {
  it('links the Instrument stylesheet, declares lang and dir and a viewport', () => {
    const { html } = page('Sign in', '<p>hello</p>');
    expect(html).toContain('<html lang="en" dir="ltr">');
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain('<link rel="stylesheet" href="/instrument/instrument.css">');
    expect(html).toContain(
      '<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">\n<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">',
    );
  });

  it('takes the language and direction from the locale it is given', () => {
    const { html } = page('x', '<p>hello</p>', null, [], { tag: 'ar', dir: 'rtl' });
    expect(html).toContain('<html lang="ar" dir="rtl">');
  });

  it('names the theme the person chose on <html>, and none otherwise', () => {
    const none = page('x', '');
    expect(none.html).not.toContain('data-theme');
    const dark = page('x', '', null, [], { tag: 'en', dir: 'ltr', theme: 'dark' });
    expect(dark.html).toContain('<html lang="en" dir="ltr" data-theme="dark">');
    const light = page('x', '', null, [], { tag: 'ar', dir: 'rtl', theme: 'light' });
    expect(light.html).toContain('<html lang="ar" dir="rtl" data-theme="light">');
  });

  it('never writes a theme that is not one of the two', () => {
    const { html } = page('x', '', null, [], {
      tag: 'en',
      dir: 'ltr',
      theme: 'x"><script>' as never,
    });
    expect(html).not.toContain('data-theme');
    expect(html).not.toContain('<script>');
  });

  it('wraps the body in one main landmark under the brand', () => {
    const { html } = page('Sign in', '<p>hello</p>');
    expect(html.match(/<main /gu)).toHaveLength(1);
    expect(html).toMatch(
      /<main class="page">\s*<p class="brand"><svg class="mark"[^>]*aria-hidden="true"/u,
    );
    expect(html.indexOf('class="mark"')).toBeLessThan(html.indexOf('<p>hello</p>'));
  });

  it('names the product beside the mark, outside the body a theme replaces', () => {
    const rendered = page('Sign in', '<p>hello</p>');
    expect(rendered.html).toContain('<span class="wordmark">odudu</span></p>');
    expect(rendered.body).not.toContain('wordmark');
  });

  it('keeps the body a theme may replace free of the document chrome', () => {
    const rendered = page('Sign in', '<p>hello</p>');
    expect(rendered.body).toBe('<p>hello</p>');
    expect(rendered.body).not.toMatch(/<link|<html|<head|<main|<svg/u);
  });

  it('puts no inline style or script in the shell', () => {
    const { html } = page('Sign in', '');
    expect(html).not.toMatch(/<style|style=|<script|onerror=/u);
  });

  it('escapes the title', () => {
    const { html } = page('<img src=x onerror=1>', '');
    expect(html).toContain('<title>&lt;img src=x onerror=1&gt;</title>');
  });

  it('escapes a hostile locale tag', () => {
    const { html } = page('x', '', null, [], { tag: 'en"><script>', dir: 'ltr' });
    expect(html).not.toContain('<script>');
  });
});

describe('intro', () => {
  it('is a heading alone when no tenant or context is named', () => {
    expect(intro('Sign in')).toBe('<header class="intro">\n<h1>Sign in</h1>\n</header>');
  });

  it('puts the context lines, then the tenant isolated and escaped, under the heading', () => {
    const html = intro('Sign in', '<acme>&', ['to continue to <bdi>Portal</bdi>']);
    expect(html).toBe(
      '<header class="intro">\n<h1>Sign in</h1>\n' +
        '<p class="context">to continue to <bdi>Portal</bdi></p>\n' +
        '<p class="tenant"><bdi>&lt;acme&gt;&amp;</bdi></p>\n</header>',
    );
  });
});

describe('page head without and with branding', () => {
  const STOCK_HEAD =
    '<link rel="stylesheet" href="/instrument/instrument.css">\n' +
    '<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">\n' +
    '<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">\n</head>';

  it('is byte-identical to the stock head without branding', () => {
    expect(page('x', '').html).toContain(STOCK_HEAD);
  });

  it('carries the tenant stylesheet link after the Instrument link and escapes it', () => {
    const { html } = page('x', '', null, [], {
      tag: 'en',
      dir: 'ltr',
      branding: {
        origin: 'https://idp.example',
        templates: {},
        tokensCss: '',
        stylesheetUrl: '/t/a/abc.css',
        faviconUrl: '/t/a/fav.png',
        logo: null,
        assetUrls: [],
      },
    });
    expect(html).toContain(
      '<link rel="stylesheet" href="/instrument/instrument.css">\n' +
        '<link rel="stylesheet" href="/t/a/abc.css">\n' +
        '<link rel="icon" href="/t/a/fav.png">\n</head>',
    );
    expect(html).not.toContain('/instrument/favicon');
  });

  it('refuses a stylesheet that is not a same-origin path', () => {
    const branding = {
      origin: 'https://idp.example',
      templates: {},
      tokensCss: '',
      stylesheetUrl: '"><script>x</script>',
      faviconUrl: null,
      logo: null,
      assetUrls: [],
    };
    expect(() => page('x', '', null, [], { tag: 'en', dir: 'ltr', branding })).toThrow();
  });
});

describe('the brand block', () => {
  const MARK_SVG =
    '<svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg>';
  const STOCK_BRAND = `<p class="brand">${MARK_SVG}<span class="wordmark">odudu</span></p>`;
  const branded = (logo: ResolvedBranding['logo']): PageLocale => ({
    tag: 'en',
    dir: 'ltr',
    branding: {
      origin: 'https://idp.example',
      templates: {},
      tokensCss: '',
      stylesheetUrl: '/t/a/abc.css',
      faviconUrl: '/t/a/fav.png',
      logo,
      assetUrls: [],
    },
  });

  it('without branding the shell is byte-identical', () => {
    expect(page('T', '<p>hello</p>').html).toContain(
      `<main class="page">\n${STOCK_BRAND}\n<p>hello</p>\n</main>`,
    );
  });

  it('without a logo the branded shell keeps the mark and wordmark', () => {
    const { html } = page('T', '<p>hello</p>', null, [], branded(null));
    expect(html).toContain(`<main class="page">\n${STOCK_BRAND}\n<p>hello</p>\n</main>`);
  });

  it('a branded page shows the logo instead of the mark and wordmark', () => {
    const logo = { url: '/t/a/logo.png', darkUrl: null, alt: 'Acme' };
    const { html } = page('T', '<p>hello</p>', null, [], branded(logo));
    expect(html).toContain(
      '<main class="page">\n<p class="brand"><img class="logo" src="/t/a/logo.png" alt="Acme"></p>\n<p>hello</p>',
    );
    expect(html).not.toContain('class="mark"');
    expect(html).not.toContain('wordmark');
  });

  it('a logo with a dark variant renders two images', () => {
    const logo = { url: '/t/a/l.png', darkUrl: '/t/a/d.png', alt: 'Acme' };
    const { html } = page('T', '', null, [], branded(logo));
    expect(html).toContain(
      '<p class="brand"><img class="logo logo-light" src="/t/a/l.png" alt="Acme">' +
        '<img class="logo logo-dark" src="/t/a/d.png" alt="Acme"></p>',
    );
  });

  it('escapes the alt text and the urls', () => {
    const logo = { url: '/t/a/l.png', darkUrl: null, alt: '"><script>x</script> & co' };
    const { html } = page('T', '', null, [], branded(logo));
    expect(html).not.toContain('<script>');
    expect(html).toContain('alt="&quot;>&lt;script>x&lt;/script> &amp; co"');
  });

  it('every image the shell loads is in img-src', () => {
    const logo = { url: '/t/a/l.png', darkUrl: '/t/a/d.png', alt: 'A' };
    const rendered = page('T', '', null, [], branded(logo));
    const csp = Object.fromEntries(pageHeaders(rendered))['content-security-policy'] ?? '';
    const imgSrc = (csp.split('; ').find((d) => d.startsWith('img-src ')) ?? '')
      .split(' ')
      .slice(1);
    const loaded = [
      ...[...rendered.html.matchAll(/<img [^>]*src="([^"]+)"/gu)].map((m) => m[1] ?? ''),
      ...[...rendered.html.matchAll(/<link rel="icon" href="([^"]+)"/gu)].map((m) => m[1] ?? ''),
    ];
    expect(loaded).toEqual(['/t/a/l.png', '/t/a/d.png', '/t/a/fav.png']);
    for (const url of loaded) expect(imgSrc).toContain(`https://idp.example${url}`);
  });
});

describe('the main element names the page kind of a themed page', () => {
  const branding: ResolvedBranding = {
    origin: 'https://idp.example',
    templates: {},
    tokensCss: '',
    stylesheetUrl: '/t/a/abc.css',
    faviconUrl: null,
    logo: null,
    assetUrls: [],
  };

  it('adds page-<kind> only with a branding', () => {
    const themed = page('x', '', null, [], { tag: 'en', dir: 'ltr', branding }, 'sign-in');
    expect(themed.html).toContain('<main class="page page-sign-in">');
    const plain = page('x', '', null, [], { tag: 'en', dir: 'ltr' }, 'sign-in');
    expect(plain.html).toContain('<main class="page">');
  });

  it('adds nothing for a page with no kind', () => {
    const themed = page('x', '', null, [], { tag: 'en', dir: 'ltr', branding });
    expect(themed.html).toContain('<main class="page">');
  });
});
