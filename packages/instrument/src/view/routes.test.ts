import Fastify, { type FastifyInstance } from 'fastify';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { instrumentRoutes } from '#/view/routes';

const FONT = 'ibm-plex-sans-latin-400-normal.0a1b2c3d.woff2';
const dirs: string[] = [];
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function builtDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'instrument-'));
  dirs.push(dir);
  await mkdir(join(dir, 'fonts'));
  await writeFile(join(dir, 'instrument.css'), 'body{margin:0}');
  await writeFile(join(dir, 'mark.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dir, 'apple-touch-icon.png'), 'png-bytes');
  await writeFile(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(dir, 'favicon.ico'), 'ico-bytes');
  await writeFile(join(dir, 'fonts', FONT), 'woff2-bytes');
  await writeFile(join(dir, 'fonts', '.hidden.woff2'), 'x');
  await writeFile(join(dir, 'notes.txt'), 'not a served type');
  return dir;
}

async function served(dir: string, logs: string[] = []): Promise<FastifyInstance> {
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs.push(chunk.toString('utf8'));
      done();
    },
  });
  const instance = Fastify({ logger: { level: 'warn', stream } });
  await instance.register(instrumentRoutes(dir));
  await instance.ready();
  app = instance;
  return instance;
}

describe('instrumentRoutes', () => {
  it('serves the stylesheet as text/css with a strong etag that revalidates', async () => {
    const server = await served(await builtDir());
    const response = await server.inject('/instrument/instrument.css');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers.etag).toMatch(/^"[A-Za-z0-9_-]+"$/u);
    expect(response.body).toBe('body{margin:0}');
  });

  it('answers 304 when the etag still matches, and 200 when it does not', async () => {
    const server = await served(await builtDir());
    const first = await server.inject('/instrument/instrument.css');
    const etag = String(first.headers.etag);
    const same = await server.inject({
      url: '/instrument/instrument.css',
      headers: { 'if-none-match': etag },
    });
    expect(same.statusCode).toBe(304);
    expect(same.body).toBe('');
    expect(same.headers.etag).toBe(etag);
    const stale = await server.inject({
      url: '/instrument/instrument.css',
      headers: { 'if-none-match': '"other"' },
    });
    expect(stale.statusCode).toBe(200);
  });

  it('serves a hashed font as immutable', async () => {
    const server = await served(await builtDir());
    const response = await server.inject(`/instrument/fonts/${FONT}`);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('font/woff2');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('lets any origin read a font, since the theme preview frame has none of its own, and nothing else', async () => {
    const server = await served(await builtDir());
    const font = await server.inject(`/instrument/fonts/${FONT}`);
    expect(font.headers['access-control-allow-origin']).toBe('*');
    expect(font.headers['access-control-allow-credentials']).toBeUndefined();
    const notModified = await server.inject({
      url: `/instrument/fonts/${FONT}`,
      headers: { 'if-none-match': String(font.headers.etag) },
    });
    expect(notModified.statusCode).toBe(304);
    expect(notModified.headers['access-control-allow-origin']).toBe('*');
    for (const url of ['/instrument/instrument.css', '/instrument/mark.svg', '/favicon.ico']) {
      const other = await server.inject(url);
      expect(other.headers['access-control-allow-origin'], url).toBeUndefined();
    }
  });

  it('serves the mark as an svg image that cannot be sniffed as anything else', async () => {
    const server = await served(await builtDir());
    const response = await server.inject('/instrument/mark.svg');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/svg+xml');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('serves the touch icon as a png that cannot be sniffed as anything else', async () => {
    const server = await served(await builtDir());
    const response = await server.inject('/instrument/apple-touch-icon.png');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-cache');
    const etag = response.headers.etag;
    expect(etag).toMatch(/^"?W?\/?"?[\w-]+/u);
    const again = await server.inject({
      url: '/instrument/apple-touch-icon.png',
      headers: { 'if-none-match': String(etag) },
    });
    expect(again.statusCode).toBe(304);
  });

  it('serves the favicon as svg and as ico, revalidating like the mark', async () => {
    const server = await served(await builtDir());
    for (const [url, type] of [
      ['/instrument/favicon.svg', 'image/svg+xml'],
      ['/instrument/favicon.ico', 'image/x-icon'],
    ] as const) {
      const response = await server.inject(url);
      expect(response.statusCode, url).toBe(200);
      expect(response.headers['content-type'], url).toBe(type);
      expect(response.headers['x-content-type-options'], url).toBe('nosniff');
      expect(response.headers['cache-control'], url).toBe('no-cache');
    }
  });

  it('answers the default browser request for /favicon.ico with the same icon', async () => {
    const server = await served(await builtDir());
    const response = await server.inject('/favicon.ico');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/x-icon');
    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.body).toBe('ico-bytes');
    const again = await server.inject({
      url: '/favicon.ico',
      headers: { 'if-none-match': String(response.headers.etag) },
    });
    expect(again.statusCode).toBe(304);
  });

  it('answers 404 for /favicon.ico when the build has no icon', async () => {
    const dir = await builtDir();
    await rm(join(dir, 'favicon.ico'));
    const server = await served(dir);
    expect((await server.inject('/favicon.ico')).statusCode).toBe(404);
  });

  it('refuses a path outside the manifest', async () => {
    const server = await served(await builtDir());
    for (const path of [
      '/instrument/../etc/passwd',
      '/instrument/%2e%2e/x',
      '/instrument/..%2f..%2fetc/passwd',
      '/instrument/notes.txt',
      '/instrument/fonts/.hidden.woff2',
      '/instrument/fonts/',
      '/instrument/',
      '/instrument/missing.css',
    ]) {
      const response = await server.inject(path);
      expect(response.statusCode, path).toBe(404);
    }
    const missing = await server.inject('/instrument/missing.css');
    expect(missing.headers['x-content-type-options']).toBe('nosniff');
  });

  it('warns and answers 404 when the directory is missing, rather than throwing', async () => {
    const logs: string[] = [];
    const server = await served(join(tmpdir(), 'instrument-does-not-exist'), logs);
    expect(logs.join('')).toContain('ODUDU_INSTRUMENT_DIR');
    expect((await server.inject('/instrument/instrument.css')).statusCode).toBe(404);
  });

  it('answers 304 to the forms If-None-Match takes: weak, listed, and *', async () => {
    const server = await served(await builtDir());
    const etag = String((await server.inject('/instrument/instrument.css')).headers.etag);
    for (const header of [`W/${etag}`, `"other", ${etag}`, `${etag},"other"`, '*']) {
      const response = await server.inject({
        url: '/instrument/instrument.css',
        headers: { 'if-none-match': header },
      });
      expect(response.statusCode, header).toBe(304);
      expect(response.headers['x-content-type-options']).toBe('nosniff');
    }
    const none = await server.inject({
      url: '/instrument/instrument.css',
      headers: { 'if-none-match': '"other", "another"' },
    });
    expect(none.statusCode).toBe(200);
  });

  it('says the directory is too large, not missing, when it holds more files than a build', async () => {
    const dir = await builtDir();
    for (let i = 0; i < 101; i++) await writeFile(join(dir, `extra${String(i)}.css`), 'x');
    const logs: string[] = [];
    const server = await served(dir, logs);

    expect((await server.inject('/instrument/instrument.css')).statusCode).toBe(404);
    const text = logs.join('');
    expect(text).toContain('ODUDU_INSTRUMENT_DIR');
    expect(text).toContain('more than');
    expect(text).not.toContain('no built stylesheet');
  });

  it('refuses a directory of many entries of no served type, long before a build is that big', async () => {
    const dir = await builtDir();
    for (let i = 0; i < 130; i++) await writeFile(join(dir, `note${String(i)}.txt`), 'x');
    const logs: string[] = [];
    const server = await served(dir, logs);

    expect((await server.inject('/instrument/instrument.css')).statusCode).toBe(404);
    expect(logs.join('')).toContain('more than 128 entries');
  });

  it('says the stylesheet is missing, not too large, when the directory is absent', async () => {
    const logs: string[] = [];
    await served(join(tmpdir(), 'instrument-absent'), logs);
    expect(logs.join('')).toContain('no built stylesheet');
    expect(logs.join('')).not.toContain('more than');
  });
});
