import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { SYSTEM_TENANT_NAME } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedAdmin } from '#/cli/seed';
import { CONSOLE_CLIENT_KEY } from '#/testing/console-key';
import {
  browse,
  type ConsoleStack,
  Jar,
  KEK,
  seedTenantAdmin,
  signIn,
  signInToTenant,
  startConsoleApp,
} from '#/testing/console-harness';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const BASE = 'http://console.example.test';

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

async function withStack(run: (stack: ConsoleStack) => Promise<void>): Promise<void> {
  const stack = await startConsoleApp({ database: appDb, ownerDatabase: owner }, BASE);
  try {
    await run(stack);
  } finally {
    await stack.app.close();
  }
}

describe('GET /console/api/tenants/{tenant}/discovery', () => {
  it('answers the public-base issuer even when the browser sent another Host', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const res = await browse(
        stack,
        jar,
        `/console/api/tenants/${SYSTEM_TENANT_NAME}/discovery`,
        'evil.example',
      );

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.json<{ issuer: string }>().issuer).toBe(`${BASE}/tenants/${SYSTEM_TENANT_NAME}`);
    });
  });

  it('refuses a tenant admin reading another tenant’s discovery', async () => {
    await withStack(async (stack) => {
      const { tenant, username } = await seedTenantAdmin();
      const jar = new Jar();
      await signInToTenant(stack, jar, tenant, username);

      const res = await browse(stack, jar, `/console/api/tenants/${SYSTEM_TENANT_NAME}/discovery`);

      expect(res.statusCode).toBe(403);
      expect(res.headers['content-type']).toMatch(/^application\/problem\+json/u);
      expect(res.json()).toMatchObject({ type: 'about:blank', title: 'Forbidden', status: 403 });
    });
  });

  it('lets a tenant admin read their own tenant’s discovery', async () => {
    await withStack(async (stack) => {
      const { tenant, username } = await seedTenantAdmin();
      const jar = new Jar();
      await signInToTenant(stack, jar, tenant, username);

      const res = await browse(stack, jar, `/console/api/tenants/${tenant}/discovery`);

      expect(res.statusCode).toBe(200);
      expect(res.json<{ issuer: string }>().issuer).toBe(`${BASE}/tenants/${tenant}`);
    });
  });

  it('answers 404 for a tenant that does not exist', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const res = await browse(stack, jar, '/console/api/tenants/no-such-tenant/discovery');

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ type: 'about:blank#not-found', status: 404 });
    });
  });

  it('answers the session-ended problem with no session cookie', async () => {
    await withStack(async (stack) => {
      const res = await browse(
        stack,
        new Jar(),
        `/console/api/tenants/${SYSTEM_TENANT_NAME}/discovery`,
      );

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ type: 'about:blank#console-session-ended', status: 401 });
    });
  });
});

describe('GET /console/api/tenants/{tenant}/jwks', () => {
  it('answers the tenant’s published keys', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const res = await browse(stack, jar, `/console/api/tenants/${SYSTEM_TENANT_NAME}/jwks`);

      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(Array.isArray(res.json<{ keys: unknown[] }>().keys)).toBe(true);
    });
  });

  it('refuses a tenant admin reading another tenant’s keys', async () => {
    await withStack(async (stack) => {
      const { tenant, username } = await seedTenantAdmin();
      const jar = new Jar();
      await signInToTenant(stack, jar, tenant, username);

      const res = await browse(stack, jar, `/console/api/tenants/${SYSTEM_TENANT_NAME}/jwks`);

      expect(res.statusCode).toBe(403);
    });
  });

  it('answers 404 for a tenant that does not exist', async () => {
    await withStack(async (stack) => {
      const jar = new Jar();
      await signIn(stack, jar);

      const res = await browse(stack, jar, '/console/api/tenants/no-such-tenant/jwks');

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ type: 'about:blank#not-found', status: 404 });
    });
  });
});
