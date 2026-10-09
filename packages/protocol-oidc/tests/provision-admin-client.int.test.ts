import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { CLIENT_LIST_LIMIT } from '@odudu/contracts/admin';
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

  it('drops a console path under any origin or query, leaving one entry for the current base', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, {});
    await withTenant(app.db, tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error('the admin client was not provisioned');
      await clientOidcConfigRepository(tx).update(client.id, {
        redirectUris: [
          ADMIN_CLIENT_REDIRECT_URI,
          'https://evil.example/console/auth/callback',
          'https://idp.example.test/console/auth/callback?x=1',
        ],
      });
    });

    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });

    expect((await registeredUris(tenantId)).redirectUris).toEqual([
      ADMIN_CLIENT_REDIRECT_URI,
      'https://idp.example.test/console/auth/callback',
    ]);
  });

  async function fill(
    tenantId: string,
    list: 'redirectUris' | 'postLogoutRedirectUris',
    count: number,
  ): Promise<void> {
    await withTenant(app.db, tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error('the admin client was not provisioned');
      await clientOidcConfigRepository(tx).update(client.id, {
        [list]: Array.from({ length: count }, (_, i) => `https://other.example/${String(i)}`),
      });
    });
  }

  it.each(['redirectUris', 'postLogoutRedirectUris'] as const)(
    'refuses, by name, to push %s past the limit, and writes nothing',
    async (list) => {
      const tenantId = await freshTenant();
      await provision(tenantId, {});
      await fill(tenantId, list, CLIENT_LIST_LIMIT);
      const before = await registeredUris(tenantId);

      await expect(
        provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' }),
      ).rejects.toMatchObject({ code: 'admin_client_list_full' });
      expect(await registeredUris(tenantId)).toEqual(before);
    },
  );

  it('replaces a registered console URI when the list is full, since that adds none', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleBaseUrl: 'https://old.example.test' });
    await fill(tenantId, 'redirectUris', CLIENT_LIST_LIMIT - 1);
    await withTenant(app.db, tenantId, async (tx) => {
      const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (client === null) throw new Error('the admin client was not provisioned');
      const config = await clientOidcConfigRepository(tx).byClientId(client.id);
      await clientOidcConfigRepository(tx).update(client.id, {
        redirectUris: [
          ...(config?.redirectUris ?? []),
          'https://old.example.test/console/auth/callback',
        ],
      });
    });

    await provision(tenantId, { consoleBaseUrl: 'https://new.example.test' });

    const { redirectUris } = await registeredUris(tenantId);
    expect(redirectUris).toHaveLength(CLIENT_LIST_LIMIT);
    expect(redirectUris.at(-1)).toBe('https://new.example.test/console/auth/callback');
  });
});

const KEY_A = {
  keys: [{ kty: 'EC', crv: 'P-256', x: 'a', y: 'a', kid: 'a', alg: 'ES256', use: 'sig' }],
};
const KEY_B = {
  keys: [
    { kty: 'EC', crv: 'P-256', x: 'b', y: 'b', kid: 'b', alg: 'ES256', use: 'sig' },
    ...KEY_A.keys,
  ],
};

async function authentication(tenantId: string): Promise<{
  type: string;
  secretHash: string | null;
  method: string;
  jwks: unknown;
}> {
  return withTenant(app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (client === null) throw new Error('the admin client was not provisioned');
    const config = await clientOidcConfigRepository(tx).byClientId(client.id);
    if (config === null) throw new Error('the admin client has no OIDC configuration');
    return {
      type: client.type,
      secretHash: client.secretHash,
      method: config.tokenEndpointAuthMethod,
      jwks: config.jwks,
    };
  });
}

async function rowVersions(tenantId: string): Promise<string> {
  const rows = await owner.sql<{ xmin: string }[]>`
    select c.xmin::text as xmin from clients k
    join client_oidc_config c on c.client_id = k.id
    where k.tenant_id = ${tenantId} and k.client_id = ${ADMIN_CLIENT_ID}`;
  const clientRows = await owner.sql<{ xmin: string }[]>`
    select xmin::text as xmin from clients
    where tenant_id = ${tenantId} and client_id = ${ADMIN_CLIENT_ID}`;
  return `${rows[0]?.xmin ?? ''}/${clientRows[0]?.xmin ?? ''}`;
}

describe('provisionAdminClient: the console key', () => {
  it('creates a client that authenticates with private_key_jwt under the given key', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleClientJwks: KEY_A });

    expect(await authentication(tenantId)).toEqual({
      type: 'confidential',
      secretHash: null,
      method: 'private_key_jwt',
      jwks: KEY_A,
    });
  });

  it('creates a public client with method none when given no key', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, {});

    expect(await authentication(tenantId)).toEqual({
      type: 'public',
      secretHash: null,
      method: 'none',
      jwks: null,
    });
  });

  it('converts a public client provisioned before the key existed', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleBaseUrl: 'https://idp.example.test' });
    await provision(tenantId, {
      consoleBaseUrl: 'https://idp.example.test',
      consoleClientJwks: KEY_A,
    });

    expect(await authentication(tenantId)).toEqual({
      type: 'confidential',
      secretHash: null,
      method: 'private_key_jwt',
      jwks: KEY_A,
    });
    expect((await registeredUris(tenantId)).redirectUris).toContain(
      'https://idp.example.test/console/auth/callback',
    );
  });

  it('writes nothing on a second pass with the same key', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleClientJwks: KEY_A });
    const before = await rowVersions(tenantId);

    await provision(tenantId, { consoleClientJwks: KEY_A });

    expect(await rowVersions(tenantId)).toBe(before);
  });

  it('replaces the registered keys when the key set changes', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleClientJwks: KEY_A });
    await provision(tenantId, { consoleClientJwks: KEY_B });

    expect((await authentication(tenantId)).jwks).toEqual(KEY_B);
  });

  it('leaves the key alone on a pass given none', async () => {
    const tenantId = await freshTenant();
    await provision(tenantId, { consoleClientJwks: KEY_A });
    await provision(tenantId, {});

    expect(await authentication(tenantId)).toMatchObject({
      type: 'confidential',
      method: 'private_key_jwt',
      jwks: KEY_A,
    });
  });
});
