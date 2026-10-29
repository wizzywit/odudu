import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { brandingHead, pageHeaders, stylesheetLink, type RenderedPage } from '#/page';
import { inlinePreview, mailPreviewHeaders, previewHeaders } from '#/page-preview';

const SHEET = '/tenants/acme/brand/' + 'a'.repeat(64) + '.css';
const LOGO = '/tenants/acme/brand/' + 'b'.repeat(64) + '.png';
const LOGO_URI = 'data:image/png;base64,AAAA';

function pageWith(html: string, script: RenderedPage['script'] = null): RenderedPage {
  return {
    html,
    body: html,
    title: 'T',
    script,
    frames: [],
    locale: { tag: 'en', dir: 'ltr' },
  };
}

const POLICY = (headers: readonly (readonly [string, string])[]): string =>
  headers.find(([name]) => name === 'content-security-policy')?.[1] ?? '';

describe('inlinePreview', () => {
  const html = `<head>${stylesheetLink(SHEET)}</head><img src="${LOGO}">`;

  it('replaces the linked stylesheet with its text and names its hash', () => {
    const css = `.a{background:url(${LOGO})}`;
    const out = inlinePreview(pageWith(html), {
      stylesheetUrl: SHEET,
      css,
      images: new Map([[LOGO, LOGO_URI]]),
    });
    const inlined = `.a{background:url(${LOGO_URI})}`;
    expect(out.html).toContain(`<style>${inlined}</style>`);
    expect(out.html).not.toContain('<link rel="stylesheet" href="/tenants');
    expect(out.html).toContain(`<img src="${LOGO_URI}">`);
    expect(out.styleSha256).toBe(createHash('sha256').update(inlined).digest('base64'));
  });

  it('takes no hash when the theme links no stylesheet', () => {
    const out = inlinePreview(pageWith('<p>x</p>'), {
      stylesheetUrl: null,
      css: '',
      images: new Map(),
    });
    expect(out.styleSha256).toBeNull();
  });

  it('removes the page script and says so', () => {
    const page = pageWith('<p>a</p><script nonce="n+/=">start()</script><p>b</p>', {
      nonce: 'n+/=',
      fetchesSameOrigin: false,
    });
    const out = inlinePreview(page, { stylesheetUrl: null, css: '', images: new Map() });
    expect(out.html).toBe('<p>a</p><p>b</p>');
    expect(out.scriptOmitted).toBe(true);
  });

  it('leaves out the icon links the real head carries, wherever they sit in it', () => {
    const head = brandingHead({ tag: 'en', dir: 'ltr' });
    expect(head).toContain('rel="icon"');
    for (const page of [
      `<head>${head}</head><p>x</p>`,
      `<head>${head}<meta name="a" content="b"></head>`,
      `<head><meta name="a" content="b">${head}</head>`,
    ]) {
      const out = inlinePreview(pageWith(page), {
        stylesheetUrl: null,
        css: '',
        images: new Map(),
      });
      expect(out.html).not.toContain('rel="icon"');
      expect(out.html).toContain('<head>');
    }
  });

  it('keeps a theme’s own favicon, carried as the data it was swapped for', () => {
    const icon = `<link rel="icon" href="${LOGO}">`;
    const out = inlinePreview(pageWith(`<head>${icon}</head>`), {
      stylesheetUrl: null,
      css: '',
      images: new Map([[LOGO, LOGO_URI]]),
    });
    expect(out.html).toBe(`<head><link rel="icon" href="${LOGO_URI}"></head>`);
  });

  it('does not inline a stylesheet that could close its own element', () => {
    const out = inlinePreview(pageWith(stylesheetLink(SHEET)), {
      stylesheetUrl: SHEET,
      css: 'a{}</style><script>x</script>',
      images: new Map(),
    });
    expect(out.html).not.toContain('<script>');
    expect(out.styleSha256).toBeNull();
  });
});

describe('previewHeaders', () => {
  const inlined = { html: '', styleSha256: 'abc=', scriptOmitted: false };

  it('lets the console frame the response and nothing else frame it', () => {
    const policy = POLICY(previewHeaders(inlined));
    expect(policy.split('; ')).toContain("frame-ancestors 'self'");
  });

  it('licenses only the inlined stylesheet and data images, and no script', () => {
    const policy = POLICY(previewHeaders(inlined));
    const directives = policy.split('; ');
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("style-src 'self' 'sha256-abc='");
    expect(directives).toContain('img-src data:');
    expect(policy).not.toContain('script-src');
    expect(policy).not.toContain('unsafe-inline');
    expect(policy).not.toContain('unsafe-eval');
  });

  it('is not cached, not sniffed and sends no referrer', () => {
    const headers = Object.fromEntries(previewHeaders(inlined));
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-frame-options']).toBeUndefined();
  });

  it('leaves the headers of an ordinary page as they were', () => {
    const headers = Object.fromEntries(pageHeaders(pageWith('<p>')));
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('mailPreviewHeaders', () => {
  const policy = (origins: string[]): string[] => POLICY(mailPreviewHeaders(origins)).split('; ');

  it('licenses images from the logo origins and data addresses, and no script', () => {
    const directives = policy(['https://id.example']);
    expect(directives).toContain('img-src data: https://id.example');
    expect(directives).toContain("default-src 'none'");
    expect(directives).toContain("frame-ancestors 'self'");
    expect(directives.join(';')).not.toContain('script-src');
  });

  it('allows data images alone when no logo is set', () => {
    expect(policy([])).toContain('img-src data:');
  });

  it('sends what every framed preview sends', () => {
    const headers = Object.fromEntries(mailPreviewHeaders([]));
    expect(headers['cache-control']).toBe('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['referrer-policy']).toBe('no-referrer');
    expect(headers['x-frame-options']).toBeUndefined();
  });
});
