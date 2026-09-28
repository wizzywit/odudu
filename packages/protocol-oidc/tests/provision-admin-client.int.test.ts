import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import {
  ADMIN_CLIENT_REDIRECT_URI,
  provisionAdminClient,
  type ProvisionAdminClientOptions,
} from '#/usecase/provision-admin-client';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
  });
  return tenantId;
}

async function provision(tenantId: string, options: ProvisionAdminClientOptions): Promise<void> {
  await withTenant(app.db, tenantId, (tx) => provisionAdminClient(tx, tenantId, options));
}

async function registeredUris(
  tenantId: string,
): Promise<{ redirectUris: string[]; postLogoutRedirectUris: string[] }> {
  return withTenant(app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (client === null) throw new Error('the admin client was not provisioned');
    const config = await clientOidcConfigRepository(tx).byClientId(client.id);
    if (config === null) throw new Error('the admin client has no OIDC configuration');
    return {
      redirectUris: config.redirectUris,
      postLogoutRedirectUris: config.postLogoutRedirectUris,
    };
  });
}

describe("provisionAdminClient: the console's URIs", () => {
  it('registers the loopback alone when no console base is given', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, {});

    expect(await registeredUris(tenantId)).toEqual({
      redirectUris: [ADMIN_CLIENT_REDIRECT_URI],
      postLogoutRedirectUris: [],
    });
  });

  it('writes both console URIs onto a new tenant, beside the loopback', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });

    expect(await registeredUris(tenantId)).toEqual({
      redirectUris: [ADMIN_CLIENT_REDIRECT_URI, 'https://idp.example.test/console/auth/callback'],
      postLogoutRedirectUris: ['https://idp.example.test/console/'],
    });
  });

  it('replaces the URIs of a changed base on a re-run, keeping the loopback', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleBaseUrl: 'http://localhost:3000' });
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });

    expect(await registeredUris(tenantId)).toEqual({
      redirectUris: [ADMIN_CLIENT_REDIRECT_URI, 'https://idp.example.test/console/auth/callback'],
      postLogoutRedirectUris: ['https://idp.example.test/console/'],
    });
  });

  it('adds the console URIs to a tenant provisioned before the console existed', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, {});
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });

    expect(await registeredUris(tenantId)).toEqual({
      redirectUris: [ADMIN_CLIENT_REDIRECT_URI, 'https://idp.example.test/console/auth/callback'],
      postLogoutRedirectUris: ['https://idp.example.test/console/'],
    });
  });

  it('leaves the registered URIs untouched with the console off', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });
    await provision(tenantId, {});

    expect(await registeredUris(tenantId)).toEqual({
      redirectUris: [ADMIN_CLIENT_REDIRECT_URI, 'https://idp.example.test/console/auth/callback'],
      postLogoutRedirectUris: ['https://idp.example.test/console/'],
    });
  });

  it('keeps every entry that is not a console path, and registers each console URI once', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });
    await withTenant(app.db, tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error('the admin client was not provisioned');
      await clientOidcConfigRepository(tx).update(client.id, {
        redirectUris: [
          ADMIN_CLIENT_REDIRECT_URI,
          'https://idp.example.test/console/auth/callback',
          'https://tools.example.test/callback',
        ],
        postLogoutRedirectUris: [
          'https://idp.example.test/console/',
          'https://tools.example.test/',
        ],
      });
    });

    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });

    expect(await registeredUris(tenantId)).toEqual({
      redirectUris: [
        ADMIN_CLIENT_REDIRECT_URI,
        'https://tools.example.test/callback',
        'https://idp.example.test/console/auth/callback',
      ],
      postLogoutRedirectUris: ['https://tools.example.test/', 'https://idp.example.test/console/'],
    });
  });
});
