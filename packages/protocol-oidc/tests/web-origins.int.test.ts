import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { expandWebOrigins } from '#/service/web-origin';

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

async function seedOne(
  tenantId: string,
  input: { webOrigins: string[]; redirectUris?: string[]; enabled?: boolean },
  tenantAlreadyExists = false,
): Promise<string> {
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
        enabled: input.enabled ?? true,
      });
      await provisionClientDefaults(tx, clientId);
    } else {
      await seedTenantAndClient(tx, tenantId, clientId, input.enabled ?? true);
    }
    await clientOidcConfigRepository(tx).create({
      clientId,
      tenantId,
      redirectUris: input.redirectUris ?? ['https://app.example/callback'],
      grantTypes: ['authorization_code'],
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: [],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 1_209_600,
      webOrigins: input.webOrigins,
    });
  });
  return clientId;
}

function allowed(tenantId: string, origin: string): Promise<boolean> {
  return withTenant(app.db, tenantId, (tx) =>
    clientOidcConfigRepository(tx).webOriginAllowed(origin),
  );
}

describe('clientOidcConfigRepository(tx).webOriginAllowed', () => {
  it('allows an origin a client lists, in the form it is compared in', async () => {
    const tenantId = newId();
    await seedOne(tenantId, {
      webOrigins: ['https://Listed.example:443', 'http://localhost:3000'],
    });

    expect(await allowed(tenantId, 'https://listed.example')).toBe(true);
    expect(await allowed(tenantId, 'http://localhost:3000')).toBe(true);
    expect(await allowed(tenantId, 'https://other.example')).toBe(false);
  });

  it('allows what + derives from the redirect URIs of the client itself', async () => {
    const tenantId = newId();
    await seedOne(tenantId, {
      webOrigins: ['+'],
      redirectUris: ['https://app.example/callback', 'com.example.app:/cb'],
    });

    expect(await allowed(tenantId, 'https://app.example')).toBe(true);
    expect(await allowed(tenantId, 'https://com.example.app')).toBe(false);
  });

  it('does not derive origins from redirect URIs unless + asks for them', async () => {
    const tenantId = newId();
    await seedOne(tenantId, {
      webOrigins: ['https://listed.example'],
      redirectUris: ['https://app.example/callback'],
    });

    expect(await allowed(tenantId, 'https://app.example')).toBe(false);
  });

  it('refuses an origin only a disabled client lists', async () => {
    const tenantId = newId();
    await seedOne(tenantId, { webOrigins: ['https://enabled.example'] });
    await seedOne(tenantId, { webOrigins: ['https://disabled.example'], enabled: false }, true);

    expect(await allowed(tenantId, 'https://enabled.example')).toBe(true);
    expect(await allowed(tenantId, 'https://disabled.example')).toBe(false);
  });

  it('follows an amendment of the lists, and a deleted client', async () => {
    const tenantId = newId();
    const clientId = await seedOne(tenantId, { webOrigins: ['https://before.example'] });

    await withTenant(app.db, tenantId, (tx) =>
      clientOidcConfigRepository(tx).update(clientId, { webOrigins: ['https://after.example'] }),
    );
    expect(await allowed(tenantId, 'https://before.example')).toBe(false);
    expect(await allowed(tenantId, 'https://after.example')).toBe(true);

    await withTenant(app.db, tenantId, (tx) => tx.delete(clients).where(eq(clients.id, clientId)));
    expect(await allowed(tenantId, 'https://after.example')).toBe(false);
  });

  it('follows a change made in SQL, whoever makes it', async () => {
    const tenantId = newId();
    const clientId = await seedOne(tenantId, { webOrigins: ['https://before.example'] });

    await owner.sql`
      update client_oidc_config set web_origins = '{https://sql.example}' where client_id = ${clientId}`;

    expect(await allowed(tenantId, 'https://before.example')).toBe(false);
    expect(await allowed(tenantId, 'https://sql.example')).toBe(true);
  });

  it('allows nothing another tenant lists', async () => {
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
          webOrigins: ['https://probe.example'],
        });
        return 'https://probe.example';
      },
      verifySeeded: async (tx, origin) => {
        expect(await clientOidcConfigRepository(tx).webOriginAllowed(origin)).toBe(true);
      },
      attempt: (tx, origin) => clientOidcConfigRepository(tx).webOriginAllowed(origin),
      expectBlocked: (result) => {
        expect(result).toBe(false);
      },
    });
  });
});

describe('the origins the database derives from a client’s lists', () => {
  const URIS = [
    'https://App.Example:443/callback',
    'http://a.example:80',
    'http://a.example:8080/x?y=z#f',
    'https://user:secret@h.example/p',
    'HTTPS://UPPER.example/cb',
    'https://[::1]:3000/cb',
    'com.example.app:/oauth2redirect',
    'urn:ietf:wg:oauth:2.0:oob',
    'https://sub.domain.example:8443',
  ];

  it('are the ones the server compares: what expandWebOrigins gives for the same lists', async () => {
    const [derived] = await owner.sql<{ origins: string[] }[]>`
      select coalesce(array_agg(o order by o), '{}') as origins
        from client_origins_of(${['+', 'https://Listed.example:443']}::text[], ${URIS}::text[]) o`;

    const expected = [...expandWebOrigins(['+', 'https://Listed.example:443'], URIS)].sort();
    expect(derived?.origins).toEqual(expected);
  });
});
