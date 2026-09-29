import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  type DatabaseHandle,
} from '@odudu/db';
import { roles } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clients, MANAGE_TENANTS, SYSTEM_TENANT_ID } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { ADMIN_CLIENT_REDIRECT_URI, clientOidcConfig } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { consoleCommand, provisionConsole } from '#/cli/console';
import { seed, seedAdmin } from '#/cli/seed';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const OLD_BASE = 'http://localhost:3000';
const NEW_BASE = 'https://idp.example.test';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');
}, 120_000);

afterAll(async () => {
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await app.close();
  await owner.close();
  await container.stop();
});

async function withEnv<T>(env: Record<string, string>, run: () => Promise<T>): Promise<T> {
  Object.assign(process.env, env);
  try {
    return await run();
  } finally {
    for (const key of Object.keys(env)) Reflect.deleteProperty(process.env, key);
  }
}

// Scoped by tenant id: the owner is a superuser and escapes row-level
// security, so a lookup by client_id alone would find any tenant's.
async function adminClientUris(
  tenantId: string,
): Promise<{ redirectUris: string[]; postLogoutRedirectUris: string[] } | undefined> {
  const rows = await owner.db
    .select({
      redirectUris: clientOidcConfig.redirectUris,
      postLogoutRedirectUris: clientOidcConfig.postLogoutRedirectUris,
    })
    .from(clientOidcConfig)
    .innerJoin(clients, eq(clients.id, clientOidcConfig.clientId))
    .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, ADMIN_CLIENT_ID)));
  return rows[0];
}

async function holdsManageTenants(tenantId: string): Promise<boolean> {
  const rows = await owner.db
    .select({ id: roles.id })
    .from(roles)
    .innerJoin(clients, eq(clients.id, roles.clientId))
    .where(
      and(
        eq(clients.tenantId, tenantId),
        eq(clients.clientId, ADMIN_CLIENT_ID),
        eq(roles.name, MANAGE_TENANTS),
      ),
    );
  return rows.length > 0;
}

function registeredUnder(base: string): {
  redirectUris: string[];
  postLogoutRedirectUris: string[];
} {
  return {
    redirectUris: [ADMIN_CLIENT_REDIRECT_URI, `${base}/console/auth/callback`],
    postLogoutRedirectUris: [`${base}/console/`],
  };
}

async function seedTenantUnder(base: string): Promise<string> {
  const result = await withEnv({ ODUDU_PUBLIC_BASE_URL: base }, () =>
    seed(['tenant', '--name', `console-${newId()}`]),
  );
  if (result.command !== 'tenant') throw new Error('expected the tenant command');
  return result.tenantId;
}

describe('provisionConsole', () => {
  it('corrects two tenants seeded under an old base URL', async () => {
    const first = await seedTenantUnder(OLD_BASE);
    const second = await seedTenantUnder(OLD_BASE);
    expect(await adminClientUris(first)).toEqual(registeredUnder(OLD_BASE));

    const provisioned = await provisionConsole({ database: app, ownerDatabase: owner }, NEW_BASE);

    expect(provisioned).toBe(2);
    expect(await adminClientUris(first)).toEqual(registeredUnder(NEW_BASE));
    expect(await adminClientUris(second)).toEqual(registeredUnder(NEW_BASE));
  });
});

describe('odudu console provision', () => {
  it('re-registers every tenant, the system tenant included, and says how many', async () => {
    const admin = await withEnv({ ODUDU_PUBLIC_BASE_URL: OLD_BASE }, () =>
      seedAdmin({ username: `root-${newId()}` }),
    );
    expect(admin.tenantId).toBe(SYSTEM_TENANT_ID);
    const tenant = await seedTenantUnder(OLD_BASE);
    const everyTenant = await owner.db.select({ id: tenants.id }).from(tenants);

    const message = await withEnv(
      { ODUDU_PUBLIC_BASE_URL: NEW_BASE, ODUDU_TRUST_PROXY: 'true' },
      () => consoleCommand(['provision']),
    );

    expect(message).toBe(`provisioned ${String(everyTenant.length)} tenants`);
    expect(await adminClientUris(SYSTEM_TENANT_ID)).toEqual(registeredUnder(NEW_BASE));
    expect(await adminClientUris(tenant)).toEqual(registeredUnder(NEW_BASE));
    expect(await holdsManageTenants(SYSTEM_TENANT_ID)).toBe(true);
    expect(await holdsManageTenants(tenant)).toBe(false);
  });

  it('refuses with no base URL, naming the base and the switch', async () => {
    await expect(consoleCommand(['provision'])).rejects.toThrow(
      /ODUDU_PUBLIC_BASE_URL.*ODUDU_CONSOLE=false/su,
    );
  });

  it('refuses with the console off, having nothing to register', async () => {
    await expect(
      withEnv({ ODUDU_PUBLIC_BASE_URL: NEW_BASE, ODUDU_CONSOLE: 'false' }, () =>
        consoleCommand(['provision']),
      ),
    ).rejects.toThrow(/ODUDU_CONSOLE=false/u);
  });

  it('refuses a subcommand it does not know', async () => {
    await expect(
      withEnv({ ODUDU_PUBLIC_BASE_URL: NEW_BASE }, () => consoleCommand(['provison'])),
    ).rejects.toMatchObject({ code: 'console_unknown_command' });
  });
});
