import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe, expectTenantIsolation } from '@odudu/db/testing';
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
  });
  await provisionClientDefaults(tx, clientId);
}

describe('clientOidcConfigRepository', () => {
  it('creates and finds a config by the client id', async () => {
    const tenantId = newId();
    const clientId = newId();

    const created = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenantAndClient(tx, tenantId, clientId);
      return clientOidcConfigRepository(tx).create({
        clientId,
        tenantId,
        redirectUris: ['https://app.example/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
    });

    expect(created.clientId).toBe(clientId);
    // A config created without deciding on it must behave as it always did:
    // no consent screen, no key material, no logout URIs.
    expect(created.consentRequired).toBe(false);

    const found = await withTenant(app.db, tenantId, async (tx) =>
      clientOidcConfigRepository(tx).byClientId(clientId),
    );

    expect(found).not.toBeNull();
    expect(found?.redirectUris).toEqual(['https://app.example/callback']);
    expect(found?.tokenEndpointAuthMethod).toBe('client_secret_basic');
    expect(found?.consentRequired).toBe(false);
  });

  it('defaults token exchange impersonation to refused', async () => {
    const tenantId = newId();
    const clientId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await seedTenantAndClient(tx, tenantId, clientId);
      return clientOidcConfigRepository(tx).create({
        clientId,
        tenantId,
        redirectUris: ['https://app.example/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
    });

    const config = await withTenant(app.db, tenantId, (tx) =>
      clientOidcConfigRepository(tx).byClientId(clientId),
    );

    expect(config?.tokenExchangeImpersonationAllowed).toBe(false);
  });

  it('returns null when no config matches', async () => {
    const tenantId = newId();

    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
      await provisionTenant(tx, tenantId);
    });

    const found = await withTenant(app.db, tenantId, async (tx) =>
      clientOidcConfigRepository(tx).byClientId(newId()),
    );

    expect(found).toBeNull();
  });

  it('allows a client_credentials-only client to have no redirect URIs', async () => {
    const tenantId = newId();
    const clientId = newId();

    const created = await withTenant(app.db, tenantId, async (tx) => {
      await seedTenantAndClient(tx, tenantId, clientId);
      return clientOidcConfigRepository(tx).create({
        clientId,
        tenantId,
        redirectUris: [],
        grantTypes: ['client_credentials'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
    });

    expect(created.redirectUris).toEqual([]);
  });

  it('rejects a redirect-capable client with no redirect URIs', async () => {
    const tenantId = newId();
    const clientId = newId();

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        await seedTenantAndClient(tx, tenantId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          tenantId,
          redirectUris: [],
          grantTypes: ['authorization_code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          audiences: [],
          accessTokenTtlSeconds: 300,
          refreshTokenTtlSeconds: 1_209_600,
        });
      });
      expect.unreachable('expected the empty-redirect-uris insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('client_oidc_config_redirect_uris_present');
  });

  it('rejects a client_credentials-plus-refresh_token client with no redirect URIs', async () => {
    // Pins the exact-array-equality reading of client_oidc_config_redirect_uris_present:
    // grant_types = ARRAY['client_credentials'] is false once refresh_token joins the
    // array, so this combination still requires at least one redirect URI.
    const tenantId = newId();
    const clientId = newId();

    let error: unknown;
    try {
      await withTenant(app.db, tenantId, async (tx) => {
        await seedTenantAndClient(tx, tenantId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          tenantId,
          redirectUris: [],
          grantTypes: ['client_credentials', 'refresh_token'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          audiences: [],
          accessTokenTtlSeconds: 300,
          refreshTokenTtlSeconds: 1_209_600,
        });
      });
      expect.unreachable('expected the empty-redirect-uris insert to be rejected');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const cause = (error as Error).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toContain('client_oidc_config_redirect_uris_present');
  });

  it('isolates configs by tenant', async () => {
    await expectTenantIsolation(app.db, {
      table: 'client_oidc_config',
      seed: async (tx, tenantId) => {
        const clientId = newId();
        await seedTenantAndClient(tx, tenantId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          tenantId,
          redirectUris: ['https://app.example/callback'],
          grantTypes: ['authorization_code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          audiences: [],
          accessTokenTtlSeconds: 300,
          refreshTokenTtlSeconds: 1_209_600,
        });
      },
    });
  });

  it('cannot find a config by client id under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const clientId = newId();
        await seedTenantAndClient(tx, tenantId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          tenantId,
          redirectUris: ['https://app.example/callback'],
          grantTypes: ['authorization_code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          audiences: [],
          accessTokenTtlSeconds: 300,
          refreshTokenTtlSeconds: 1_209_600,
        });
        return clientId;
      },
      verifySeeded: async (tx, clientId) => {
        const found = await clientOidcConfigRepository(tx).byClientId(clientId);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, clientId) => clientOidcConfigRepository(tx).byClientId(clientId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot read post_logout_redirect_uris for a client under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const clientId = newId();
        await seedTenantAndClient(tx, tenantId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          tenantId,
          redirectUris: ['https://app.example/callback'],
          grantTypes: ['authorization_code'],
          tokenEndpointAuthMethod: 'client_secret_basic',
          audiences: [],
          accessTokenTtlSeconds: 300,
          refreshTokenTtlSeconds: 1_209_600,
          postLogoutRedirectUris: ['https://app.example/after-logout'],
        });
        return clientId;
      },
      verifySeeded: async (tx, clientId) => {
        const found = await clientOidcConfigRepository(tx).postLogoutRedirectUris(clientId);
        expect(found).toEqual(['https://app.example/after-logout']);
      },
      attempt: async (tx, clientId) =>
        clientOidcConfigRepository(tx).postLogoutRedirectUris(clientId),
      expectBlocked: (result) => {
        expect(result).toEqual([]);
      },
    });
  });
});
