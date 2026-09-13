import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { sendHtml } from '#/view/html-response';

const VIEW_DIR = import.meta.dirname;
const HTML_MEDIA_TYPE = ['text', 'html'].join('/');

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

async function headersOf(status: number): Promise<Record<string, string>> {
  const app = Fastify();
  app.get('/page', (_request, reply) => sendHtml(reply, status, '<!doctype html><p>hello'));
  const res = await app.inject({ url: '/page' });
  expect(res.statusCode).toBe(status);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(res.headers)) {
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
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
});
