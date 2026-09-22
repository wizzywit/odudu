import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenantAndClient(
  tx: TenantScopedDatabase,
  tenantId: string,
  clientId: string,
  enabled = true,
): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionTenant(tx, tenantId);
  await tx.insert(clients).values({
    id: clientId,
    tenantId,
    clientId: `oauth-client-${clientId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
    enabled,
  });
  await provisionClientDefaults(tx, clientId);
}

async function insertConfigWithWebOrigins(webOrigins: string[]): Promise<unknown> {
  const tenantId = newId();
  const clientId = newId();

  return withTenant(app.db, tenantId, async (tx) => {
    await seedTenantAndClient(tx, tenantId, clientId);
    return clientOidcConfigRepository(tx).create({
      clientId,
      tenantId,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      webOrigins,
    });
  });
}

async function seedClientWithOrigins(
  tenantId: string,
  webOrigins: string[],
  enabled = true,
  tenantAlreadyExists = false,
): Promise<void> {
  const clientId = newId();
  await withTenant(app.db, tenantId, async (tx) => {
    if (tenantAlreadyExists) {
      await tx.insert(clients).values({
        id: clientId,
        tenantId,
        clientId: `oauth-client-${clientId}`,
        name: 'A client',
        type: 'confidential',
        secretHash: 'hashed:secret',
        enabled,
      });
      await provisionClientDefaults(tx, clientId);
    } else {
      await seedTenantAndClient(tx, tenantId, clientId, enabled);
    }
    await clientOidcConfigRepository(tx).create({
      clientId,
      tenantId,
      redirectUris: ['https://app.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      webOrigins,
    });
  });
}

describe('client_oidc_config_web_origins_shape', () => {
  it.each([['*'], ['https://*.example'], ['https://app.example/'], ['app.example']])(
    'refuses %s',
    async (origin) => {
      let error: unknown;
      try {
        await insertConfigWithWebOrigins([origin]);
        expect.unreachable(`expected ${origin} to be rejected`);
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(Error);
      const cause = (error as Error).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toContain('client_oidc_config_web_origins_shape');
    },
  );

  it('accepts an explicit origin, a port, and the + placeholder together', async () => {
    await expect(
      insertConfigWithWebOrigins(['https://app.example', 'http://localhost:3000', '+']),
    ).resolves.toBeDefined();
  });

  it('accepts the empty default', async () => {
    await expect(insertConfigWithWebOrigins([])).resolves.toBeDefined();
  });
});

describe('clientOidcConfigRepository(tx).webOriginsForTenant', () => {
  it('returns no origins from another tenant', async () => {
    const tenantA = newId();
    const tenantB = newId();
    await seedClientWithOrigins(tenantA, ['https://a.example']);
    await seedClientWithOrigins(tenantB, ['https://b.example']);

    const inA = await withTenant(app.db, tenantA, (tx) =>
      clientOidcConfigRepository(tx).webOriginsForTenant(),
    );
    expect([...inA]).toEqual(['https://a.example']);
  });

  it('excludes a disabled client from the union', async () => {
    const tenantId = newId();
    await seedClientWithOrigins(tenantId, ['https://enabled.example']);
    await seedClientWithOrigins(tenantId, ['https://disabled.example'], false, true);

    const union = await withTenant(app.db, tenantId, (tx) =>
      clientOidcConfigRepository(tx).webOriginsForTenant(),
    );
    expect([...union]).toEqual(['https://enabled.example']);
  });
});
