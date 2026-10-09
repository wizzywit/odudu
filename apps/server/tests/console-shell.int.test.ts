import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { consoleBaseUrl, loadConfig, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seedAdmin } from '#/cli/seed';
import { CONSOLE_CLIENT_KEY } from '#/testing/console-key';
import { createLogger } from '#/logger';
import { KEK, startConsoleApp } from '#/testing/console-harness';

// The gateway serves the built single-page app from its own view layer
// (packages/console-gateway/src/view/spa.ts), which sets the shell's CSP
// directly rather than through @odudu/kernel's pageHeaders. This is the one
// assertion, in the real composition, that the wiring from
// ODUDU_CONSOLE_DIR to that view actually reaches the response.

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'http://console.example.test';
const CONSOLE_DIR = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'packages',
  'console-gateway',
  'tests',
  'fixtures',
  'dist',
);
const SHELL_CSP =
  "default-src 'self'; script-src 'self'; " +
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' " +
  "'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='; " +
  "img-src 'self' data:; font-src 'self'; connect-src 'self'; " +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  appDb = appHandle;
  process.env.ODUDU_DATABASE_URL = containerHandle.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  process.env.ODUDU_CONSOLE_CLIENT_KEY = CONSOLE_CLIENT_KEY;
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  await seedAdmin({ username: `setup-${newId()}` });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  delete process.env.ODUDU_CONSOLE_CLIENT_KEY;
  delete process.env.ODUDU_PUBLIC_BASE_URL;
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('GET /console/*', () => {
  it('serves the built shell under its exact CSP', async () => {
    const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE, {
      consoleDir: CONSOLE_DIR,
    });

    const res = await stack.app.inject({
      url: '/console/tenants/acme',
      headers: { host: 'console.example.test' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-security-policy']).toBe(SHELL_CSP);
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toContain('<div id="root">');
  });
});

describe('ODUDU_CONSOLE=false', () => {
  it.each(['/console/auth/login?tenant=system', '/console/api/session', '/console/'])(
    'registers no console route, so %s is the root not-found answer',
    async (url) => {
      const config = loadConfig({ ...process.env, ODUDU_CONSOLE: 'false' });
      const app = buildApp({
        database: appDb,
        ownerDatabase: owner,
        kek: KEK,
        logger: createLogger(config),
        publicBaseUrl: BASE,
        consoleBaseUrl: consoleBaseUrl(config),
      });
      try {
        const res = await app.inject({ url, headers: { host: 'console.example.test' } });

        expect(res.statusCode).toBe(404);
        expect(res.headers['set-cookie']).toBeUndefined();
        const problem = res.json<{ status: number; detail: string }>();
        expect(problem.status).toBe(404);
        expect(problem.detail).toContain(url);
      } finally {
        await app.close();
      }
    },
  );
});
