import { type DatabaseHandle } from '@odudu/db';
import { forbiddenDatabase } from '@odudu/db/testing';
import { loadConfig } from '@odudu/kernel';
import { docsPolicy } from '@odudu/web-assets';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { createLogger } from '#/logger';

const config = loadConfig({
  ODUDU_DATABASE_URL: 'postgres://u:p@localhost:5432/odudu',
  ODUDU_KEK: Buffer.alloc(32, 9).toString('base64'),
  ODUDU_LOG_LEVEL: 'silent',
});

const SCRIPT = `sha256-${'A'.repeat(43)}=`;
const STYLE = `sha256-${'b'.repeat(43)}=`;
const POLICY = docsPolicy({ scriptHashes: [SCRIPT], styleAttributeHashes: [STYLE] });

const noTenants: DatabaseHandle = {
  db: {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
  } as unknown as DatabaseHandle['db'],
  sql: (() => Promise.resolve([{ ok: 1 }])) as unknown as DatabaseHandle['sql'],
  close: () => Promise.resolve(),
};

// Any use of the database at all is a failure of the test: the documentation
// is the same for everybody and has no business asking who is calling.
const forbidden: DatabaseHandle = {
  db: forbiddenDatabase('the documentation touched the database'),
  sql: new Proxy(() => undefined, {
    get() {
      throw new Error('the documentation touched the database');
    },
    apply() {
      throw new Error('the documentation touched the database');
    },
  }) as unknown as DatabaseHandle['sql'],
  close: () => Promise.resolve(),
};

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function docsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'server-docs-'));
  dirs.push(dir);
  await mkdir(join(dir, 'tenants', 'acme'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>Documentation home</title>');
  await writeFile(join(dir, 'tenants', 'acme', 'index.html'), '<!doctype html><title>Acme</title>');
  await writeFile(
    join(dir, 'csp.json'),
    JSON.stringify({ scriptHashes: [SCRIPT], styleAttributeHashes: [STYLE] }),
  );
  return dir;
}

function app(database: DatabaseHandle, extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    tls: false,
    database,
    ownerDatabase: database,
    kek: config.ODUDU_KEK,
    logger: createLogger(config),
    ...extra,
  });
}

// What one response says about itself, less what differs by request.
function fingerprint(headers: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !['date', 'x-request-id', 'content-length'].includes(name),
    ),
  );
}

describe('the documentation route', () => {
  it('is served under its policy when the app is given a directory', async () => {
    const server = app(noTenants, { docsDir: await docsDir() });
    const response = await server.inject('/docs/');
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-security-policy']).toBe(POLICY);
    expect((await server.inject('/docs')).statusCode).toBe(308);
  });

  it('is not registered without a directory, which is what ODUDU_DOCS=false means', async () => {
    const server = app(noTenants);
    expect((await server.inject('/docs/')).statusCode).toBe(404);
    expect((await server.inject('/docs')).statusCode).toBe(404);
    expect((await server.inject('/docs/index.html')).statusCode).toBe(404);
  });

  it('leaves every other route’s headers exactly as they were', async () => {
    const without = app(noTenants);
    const withDocs = app(noTenants, { docsDir: await docsDir() });
    for (const url of [
      '/tenants/acme/login-actions/registration',
      '/tenants/acme/.well-known/openid-configuration',
      '/health/live',
      '/nowhere',
    ]) {
      const before = await without.inject(url);
      const after = await withDocs.inject(url);
      expect(after.statusCode, url).toBe(before.statusCode);
      expect(fingerprint(after.headers), url).toEqual(fingerprint(before.headers));
      expect(JSON.stringify(after.headers['content-security-policy'] ?? ''), url).not.toContain(
        'sha256-',
      );
      expect(after.headers['x-robots-tag'], url).toBeUndefined();
    }
  });

  it('answers without touching the database, so it can say nothing about a tenant', async () => {
    const server = app(forbidden, { docsDir: await docsDir() });
    for (const url of [
      '/docs/',
      '/docs',
      '/docs/tenants/acme/',
      '/docs/tenants/other/',
      '/docs/x',
    ]) {
      const response = await server.inject(url);
      expect([200, 308, 404], url).toContain(response.statusCode);
    }
  });

  it('answers a tenant name the same as any other name, since it knows no tenants', async () => {
    const server = app(noTenants, { docsDir: await docsDir() });
    const known = await server.inject('/docs/tenants/acme/');
    const unknown = await server.inject('/docs/tenants/nobody/');
    expect(known.statusCode).toBe(200);
    expect(unknown.statusCode).toBe(404);
    const missing = await server.inject('/docs/tenants/another/');
    expect(missing.body).toBe(unknown.body);
    expect(fingerprint(missing.headers)).toEqual(fingerprint(unknown.headers));
  });

  it('does not take a tenant’s place: /tenants/docs/ is a tenant, /docs/ is the documentation', async () => {
    const server = app(noTenants, { docsDir: await docsDir() });
    const tenant = await server.inject('/tenants/docs/login-actions/registration');
    expect(tenant.body).not.toContain('Documentation home');
    expect(tenant.headers['x-robots-tag']).toBeUndefined();
  });

  it('writes no address of its own, whatever Host or forwarded headers name', async () => {
    const server = app(noTenants, {
      docsDir: await docsDir(),
      trustProxy: true,
      publicBaseUrl: 'https://idp.example.com',
    });
    const headers = {
      host: 'evil.example',
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
      'x-forwarded-prefix': '/sub',
    };
    for (const url of ['/docs', '/docs/', '/docs/tenants/acme', '/docs/missing']) {
      const response = await server.inject({ url, headers });
      const everything = `${JSON.stringify(response.headers)}${response.body}`;
      expect(everything, url).not.toContain('evil.example');
      expect(everything, url).not.toContain('idp.example.com');
      expect(everything, url).not.toContain('/sub');
      const location = response.headers.location;
      if (location !== undefined) expect(location, url).toMatch(/^\/docs\//u);
    }
  });
});
