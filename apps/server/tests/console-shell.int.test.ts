import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
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
  "style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='; " +
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
  process.env.ODUDU_PUBLIC_BASE_URL = BASE;
  await seedAdmin({ username: `setup-${newId()}` });
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
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
