import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  type DatabaseHandle,
} from '@odudu/db';
import { roles } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clients, MANAGE_TENANTS, SYSTEM_TENANT_ID } from '@odudu/domain-tenant';
import { generateClientKey, loadClientKey } from '@odudu/crypto';
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

let KEY_A: string;
let KEY_B: string;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });

  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = Buffer.alloc(32, 7).toString('base64');
  KEY_A = await generateClientKey();
  KEY_B = await generateClientKey();
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
  const result = await withEnv(
    { ODUDU_PUBLIC_BASE_URL: base, ODUDU_CONSOLE_CLIENT_KEY: KEY_A },
    () => seed(['tenant', '--name', `console-${newId()}`]),
  );
  if (result.command !== 'tenant') throw new Error('expected the tenant command');
  return result.tenantId;
}

describe('provisionConsole', () => {
  it('corrects two tenants seeded under an old base URL', async () => {
    const first = await seedTenantUnder(OLD_BASE);
    const second = await seedTenantUnder(OLD_BASE);
    expect(await adminClientUris(first)).toEqual(registeredUnder(OLD_BASE));

    const provisioned = await provisionConsole(
      { database: app, ownerDatabase: owner },
      { consoleBaseUrl: NEW_BASE, consoleClientJwks: await jwksOf(KEY_A) },
    );

    expect(provisioned).toBe(2);
    expect(await adminClientUris(first)).toEqual(registeredUnder(NEW_BASE));
    expect(await adminClientUris(second)).toEqual(registeredUnder(NEW_BASE));
  });
});

describe('odudu console provision', () => {
  it('re-registers every tenant, the system tenant included, and says how many', async () => {
    const admin = await withEnv(
      { ODUDU_PUBLIC_BASE_URL: OLD_BASE, ODUDU_CONSOLE_CLIENT_KEY: KEY_A },
      () => seedAdmin({ username: `root-${newId()}` }),
    );
    expect(admin.tenantId).toBe(SYSTEM_TENANT_ID);
    const tenant = await seedTenantUnder(OLD_BASE);
    const everyTenant = await owner.db.select({ id: tenants.id }).from(tenants);

    const message = await withEnv(
      {
        ODUDU_PUBLIC_BASE_URL: NEW_BASE,
        ODUDU_TRUST_PROXY: 'true',
        ODUDU_CONSOLE_CLIENT_KEY: KEY_A,
      },
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

  it('refuses with no client key, naming the variable and the switch', async () => {
    await expect(
      withEnv({ ODUDU_PUBLIC_BASE_URL: NEW_BASE, ODUDU_TRUST_PROXY: 'true' }, () =>
        consoleCommand(['provision']),
      ),
    ).rejects.toThrow(/ODUDU_CONSOLE_CLIENT_KEY.*ODUDU_CONSOLE=false/su);
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

async function jwksOf(serialized: string): Promise<{ keys: Record<string, unknown>[] }> {
  return { keys: [(await loadClientKey(serialized)).publicJwk] };
}

async function adminClientAuthentication(
  tenantId: string,
): Promise<{ type: string; method: string; kids: string[] }> {
  const rows = await owner.db
    .select({
      type: clients.type,
      method: clientOidcConfig.tokenEndpointAuthMethod,
      jwks: clientOidcConfig.jwks,
    })
    .from(clientOidcConfig)
    .innerJoin(clients, eq(clients.id, clientOidcConfig.clientId))
    .where(and(eq(clients.tenantId, tenantId), eq(clients.clientId, ADMIN_CLIENT_ID)));
  const row = rows[0];
  if (row === undefined) throw new Error('no admin client');
  const keys = (row.jwks as { keys: { kid: string }[] } | null)?.keys ?? [];
  return { type: row.type, method: row.method, kids: keys.map((key) => key.kid) };
}

async function rowVersions(tenantId: string): Promise<string> {
  const rows = await owner.sql<{ versions: string }[]>`
    select k.xmin::text || '/' || c.xmin::text as versions
    from clients k join client_oidc_config c on c.client_id = k.id
    where k.tenant_id = ${tenantId} and k.client_id = ${ADMIN_CLIENT_ID}`;
  return rows[0]?.versions ?? '';
}

describe('odudu console provision: the console key', () => {
  const env = (extra: Record<string, string> = {}): Record<string, string> => ({
    ODUDU_PUBLIC_BASE_URL: NEW_BASE,
    ODUDU_TRUST_PROXY: 'true',
    ...extra,
  });

  it('converts a public admin client to private_key_jwt, and a second run writes nothing', async () => {
    const seeded = await seed(['tenant', '--name', `public-${newId()}`]);
    if (seeded.command !== 'tenant') throw new Error('expected the tenant command');
    expect(await adminClientAuthentication(seeded.tenantId)).toMatchObject({
      type: 'public',
      method: 'none',
    });

    await withEnv(env({ ODUDU_CONSOLE_CLIENT_KEY: KEY_A }), () => consoleCommand(['provision']));
    const kid = (await loadClientKey(KEY_A)).kid;
    expect(await adminClientAuthentication(seeded.tenantId)).toEqual({
      type: 'confidential',
      method: 'private_key_jwt',
      kids: [kid],
    });

    const before = await rowVersions(seeded.tenantId);
    await withEnv(env({ ODUDU_CONSOLE_CLIENT_KEY: KEY_A }), () => consoleCommand(['provision']));
    expect(await rowVersions(seeded.tenantId)).toBe(before);
  });

  it('registers a key beside the one it replaces, then drops the old one', async () => {
    const seeded = await seed(['tenant', '--name', `rotate-${newId()}`]);
    if (seeded.command !== 'tenant') throw new Error('expected the tenant command');
    const [a, b] = [(await loadClientKey(KEY_A)).kid, (await loadClientKey(KEY_B)).kid];
    await withEnv(env({ ODUDU_CONSOLE_CLIENT_KEY: KEY_A }), () => consoleCommand(['provision']));

    await withEnv(
      env({ ODUDU_CONSOLE_CLIENT_KEY: KEY_B, ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS: KEY_A }),
      () => consoleCommand(['provision']),
    );
    expect((await adminClientAuthentication(seeded.tenantId)).kids).toEqual([b, a]);

    await withEnv(env({ ODUDU_CONSOLE_CLIENT_KEY: KEY_B }), () => consoleCommand(['provision']));
    expect((await adminClientAuthentication(seeded.tenantId)).kids).toEqual([b]);
  });
});

describe('odudu console keygen', () => {
  it('prints a line of configuration holding a key that loads', async () => {
    const line = await consoleCommand(['keygen']);
    expect(line.startsWith('ODUDU_CONSOLE_CLIENT_KEY=')).toBe(true);
    const key = await loadClientKey(line.slice('ODUDU_CONSOLE_CLIENT_KEY='.length));
    expect(key.kid).toMatch(/\S+/u);
  });
});

describe('seeding under a console base', () => {
  it('refuses with no client key, naming the variable, rather than leave the client public', async () => {
    await expect(
      withEnv({ ODUDU_PUBLIC_BASE_URL: NEW_BASE, ODUDU_TRUST_PROXY: 'true' }, () =>
        seed(['tenant', '--name', `refused-${newId()}`]),
      ),
    ).rejects.toThrow(/ODUDU_CONSOLE_CLIENT_KEY/u);
  });
});
