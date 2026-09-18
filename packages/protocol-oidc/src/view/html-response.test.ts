import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { scriptNonce } from '@odudu/kernel';
import { sendHtml } from '#/view/html-response';

const VIEW_DIR = import.meta.dirname;
const HTML_MEDIA_TYPE = ['text', 'html'].join('/');
const PACKAGES_DIR = join(VIEW_DIR, '..', '..', '..', '..', 'packages');
const HEADER_NAMES = ['content-security-policy', 'x-frame-options', 'referrer-policy'];
// The two files that legitimately spread the header set `pageHeaders`
// (`@odudu/kernel`) returns — every other view-layer file gets it only by
// going through one of them.
const EXEMPT_FILES = ['html-response.ts', 'verification-html.ts'];

async function sourcesUnder(dir: string): Promise<{ path: string; text: string }[]> {
  const found: { path: string; text: string }[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await sourcesUnder(path)));
      continue;
    }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    found.push({ path, text: await readFile(path, 'utf8') });
  }
  return found;
}

async function headersOf(
  status: number,
  script?: { nonce: string; fetchesSameOrigin: boolean },
): Promise<Record<string, string>> {
  const app = Fastify();
  const html = '<!doctype html><p>hello';
  app.get('/page', (_request, reply) =>
    sendHtml(reply, status, { html, body: html, title: 'Test page', script: script ?? null }),
  );
  const res = await app.inject({ url: '/page' });
  expect(res.statusCode).toBe(status);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

async function viewSources(): Promise<{ path: string; text: string }[]> {
  const found: { path: string; text: string }[] = [];
  for (const entry of await readdir(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const viewDir = join(PACKAGES_DIR, entry.name, 'src', 'view');
    try {
      found.push(...(await sourcesUnder(viewDir)));
    } catch {
      // No view layer in this package.
    }
  }
  return found;
}

describe('[ODUDU-VIEW-HTML-01] an HTML response cannot leave without its framing defences', () => {
  it('refuses to be framed, by the header modern browsers honour and the one they all do', async () => {
    const headers = await headersOf(200);
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['x-frame-options']).toBe('DENY');
  });

  it('permits no subresource, no foreign form target and no injected base', async () => {
    const policy = (await headersOf(200))['content-security-policy'] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("base-uri 'none'");
  });

  it('carries the defences on an error page as on a rendered form', async () => {
    for (const status of [200, 400, 415]) {
      const headers = await headersOf(status);
      expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(headers['x-frame-options']).toBe('DENY');
      expect(headers['content-type']).toContain(HTML_MEDIA_TYPE);
    }
  });

  // A WebAuthn ceremony can only happen in a script, and `default-src
  // 'none'` blocks an inline one without saying so — the page just looks
  // broken. The nonce is what licenses that one script and nothing else.
  it('licenses a nonced script only for a page that carries one', async () => {
    const withScript =
      (await headersOf(200, { nonce: 'Zm9vYmFyMTIzNA==', fetchesSameOrigin: true }))[
        'content-security-policy'
      ] ?? '';
    expect(withScript).toContain("script-src 'nonce-Zm9vYmFyMTIzNA=='");
    expect(withScript).not.toContain("'unsafe-inline'");

    const plain = (await headersOf(200))['content-security-policy'] ?? '';
    expect(plain).not.toContain('script-src');
    expect(plain).not.toContain('connect-src');
  });

  // A directive licensing nothing stops describing the page, which is the
  // property the whole policy is chosen for.
  it('licenses a request only for a script that makes one', async () => {
    const fetching =
      (await headersOf(200, { nonce: 'YWFhYWFhYWFhYWFhYWFhYQ==', fetchesSameOrigin: true }))[
        'content-security-policy'
      ] ?? '';
    const inline =
      (await headersOf(200, { nonce: 'YWFhYWFhYWFhYWFhYWFhYQ==', fetchesSameOrigin: false }))[
        'content-security-policy'
      ] ?? '';

    expect(fetching).toContain("connect-src 'self'");
    expect(inline).not.toContain('connect-src');
    expect(inline).toContain("script-src 'nonce-YWFhYWFhYWFhYWFhYWFhYQ=='");
  });

  it('issues a different nonce every time, so one page cannot license another', () => {
    expect(scriptNonce()).not.toBe(scriptNonce());
    expect(Buffer.from(scriptNonce(), 'base64')).toHaveLength(16);
  });

  // The headers above are worth nothing if the next page to be added sets
  // its own content type and skips them, which is exactly how the first
  // clickjacking defence came to be missing while the clause row read
  // `covered`. One function is the only place in this layer that may name
  // the HTML media type, so a new page either goes through it or fails here.
  it('is the only place in the view layer that names the HTML media type', async () => {
    const offenders = (await sourcesUnder(VIEW_DIR))
      .filter((f) => !f.path.endsWith('html-response.ts') && f.text.includes(HTML_MEDIA_TYPE))
      .map((f) => f.path.slice(VIEW_DIR.length + 1));
    expect(offenders).toEqual([]);
  });

  // pageHeaders (@odudu/kernel) is the one authority for these header
  // names; every view-layer file gets them by spreading its result rather
  // than naming a header itself, which is what let referrer-policy diverge
  // between the two exits this file and verification-html.ts now share.
  it('is one of only two files across every package that names a page header', async () => {
    const offenders = (await viewSources())
      .filter((f) => !EXEMPT_FILES.includes(f.path.split('/').pop() ?? ''))
      .filter((f) => HEADER_NAMES.some((name) => f.text.includes(name)))
      .map((f) => f.path.slice(PACKAGES_DIR.length + 1));
    expect(offenders).toEqual([]);
  });
});
