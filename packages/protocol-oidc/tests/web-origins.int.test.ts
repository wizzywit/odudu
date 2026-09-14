import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { clients, provisionClientDefaults, provisionRealmDefaults } from '@odudu/domain-realm';
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
  enabled = true,
): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  await provisionRealmDefaults(tx, realmId);
  await tx.insert(clients).values({
    id: clientId,
    realmId,
    clientId: `oauth-client-${clientId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
    enabled,
  });
  await provisionClientDefaults(tx, clientId);
}

async function insertConfigWithWebOrigins(webOrigins: string[]): Promise<unknown> {
  const realmId = newId();
  const clientId = newId();

  return withRealm(app.db, realmId, async (tx) => {
    await seedRealmAndClient(tx, realmId, clientId);
    return clientOidcConfigRepository(tx).create({
      clientId,
      realmId,
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
  realmId: string,
  webOrigins: string[],
  enabled = true,
  realmAlreadyExists = false,
): Promise<void> {
  const clientId = newId();
  await withRealm(app.db, realmId, async (tx) => {
    if (realmAlreadyExists) {
      await tx.insert(clients).values({
        id: clientId,
        realmId,
        clientId: `oauth-client-${clientId}`,
        name: 'A client',
        type: 'confidential',
        secretHash: 'hashed:secret',
        enabled,
      });
      await provisionClientDefaults(tx, clientId);
    } else {
      await seedRealmAndClient(tx, realmId, clientId, enabled);
    }
    await clientOidcConfigRepository(tx).create({
      clientId,
      realmId,
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

describe('clientOidcConfigRepository(tx).webOriginsForRealm', () => {
  it('returns no origins from another realm', async () => {
    const realmA = newId();
    const realmB = newId();
    await seedClientWithOrigins(realmA, ['https://a.example']);
    await seedClientWithOrigins(realmB, ['https://b.example']);

    const inA = await withRealm(app.db, realmA, (tx) =>
      clientOidcConfigRepository(tx).webOriginsForRealm(),
    );
    expect([...inA]).toEqual(['https://a.example']);
  });

  it('excludes a disabled client from the union', async () => {
    const realmId = newId();
    await seedClientWithOrigins(realmId, ['https://enabled.example']);
    await seedClientWithOrigins(realmId, ['https://disabled.example'], false, true);

    const union = await withRealm(app.db, realmId, (tx) =>
      clientOidcConfigRepository(tx).webOriginsForRealm(),
    );
    expect([...union]).toEqual(['https://enabled.example']);
  });
});
