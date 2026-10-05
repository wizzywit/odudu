import { describe, expect, it } from 'vitest';
import { pageHeaders } from '#/page';

const headerMap = (page: Parameters<typeof pageHeaders>[0]): Record<string, string> =>
  Object.fromEntries(pageHeaders(page).map(([name, value]) => [name, value]));

const MARKUP_ONLY_PAGE = {
  html: '<!doctype html>',
  body: '<!doctype html>',
  title: 'Untitled',
  script: null,
  frames: [],
};

describe('the headers every rendered page carries', () => {
  it('describes a markup-only page as needing nothing', () => {
    const csp = headerMap(MARKUP_ONLY_PAGE)['content-security-policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
  });

  it('carries the framing defence and the referrer policy on every page', () => {
    const headers = headerMap(MARKUP_ONLY_PAGE);
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['referrer-policy']).toBe('no-referrer');
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
