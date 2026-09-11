import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectRealmIsolation } from '@odudu/db/testing';
import { clients } from '@odudu/domain-realm';
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

async function seedRealmAndClient(
  tx: RealmScopedDatabase,
  realmId: string,
  clientId: string,
): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  await tx.insert(clients).values({
    id: clientId,
    realmId,
    clientId: `oauth-client-${clientId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
}

describe('clientOidcConfigRepository', () => {
  it('creates and finds a config by the client id', async () => {
    const realmId = newId();
    const clientId = newId();

    const created = await withRealm(app.db, realmId, async (tx) => {
      await seedRealmAndClient(tx, realmId, clientId);
      return clientOidcConfigRepository(tx).create({
        clientId,
        realmId,
        redirectUris: ['https://app.example/callback'],
        grantTypes: ['authorization_code', 'refresh_token'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
      });
    });

    expect(created.clientId).toBe(clientId);

    const found = await withRealm(app.db, realmId, async (tx) =>
      clientOidcConfigRepository(tx).byClientId(clientId),
    );

    expect(found).not.toBeNull();
    expect(found?.redirectUris).toEqual(['https://app.example/callback']);
    expect(found?.tokenEndpointAuthMethod).toBe('client_secret_basic');
  });

  it('returns null when no config matches', async () => {
    const realmId = newId();

    await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
    });

    const found = await withRealm(app.db, realmId, async (tx) =>
      clientOidcConfigRepository(tx).byClientId(newId()),
    );

    expect(found).toBeNull();
  });

  it('allows a client_credentials-only client to have no redirect URIs', async () => {
    const realmId = newId();
    const clientId = newId();

    const created = await withRealm(app.db, realmId, async (tx) => {
      await seedRealmAndClient(tx, realmId, clientId);
      return clientOidcConfigRepository(tx).create({
        clientId,
        realmId,
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
    const realmId = newId();
    const clientId = newId();

    let error: unknown;
    try {
      await withRealm(app.db, realmId, async (tx) => {
        await seedRealmAndClient(tx, realmId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          realmId,
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

  it('isolates configs by realm', async () => {
    await expectRealmIsolation(app.db, {
      table: 'client_oidc_config',
      seed: async (tx, realmId) => {
        const clientId = newId();
        await seedRealmAndClient(tx, realmId, clientId);
        await clientOidcConfigRepository(tx).create({
          clientId,
          realmId,
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
});
