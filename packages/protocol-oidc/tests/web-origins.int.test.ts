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

  it('allows nothing for a client whose lists were edited in SQL, until the server rewrites them', async () => {
    const tenantId = newId();
    const clientId = await seedOne(tenantId, { webOrigins: ['https://before.example'] });

    await owner.sql`
      update client_oidc_config set web_origins = '{https://sql.example}' where client_id = ${clientId}`;

    expect(await allowed(tenantId, 'https://before.example')).toBe(false);
    expect(await allowed(tenantId, 'https://sql.example')).toBe(false);

    await withTenant(app.db, tenantId, (tx) =>
      clientOidcConfigRepository(tx).update(clientId, { webOrigins: ['https://sql.example'] }),
    );
    expect(await allowed(tenantId, 'https://sql.example')).toBe(true);
  });

  it('drops a client’s origins with its config row, whether or not the client stays', async () => {
    const tenantId = newId();
    const clientId = await seedOne(tenantId, { webOrigins: ['https://orphan.example'] });

    await owner.sql`delete from client_oidc_config where client_id = ${clientId}`;

    const [left] = await owner.sql<{ n: number }[]>`
      select count(*)::int as n from client_origins where client_id = ${clientId}`;
    expect(left?.n).toBe(0);
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

// Strings the URL parser rewrites or rejects and a regular expression would
// read differently: what the backfill declines, and what the server writes.
const CORPUS = [
  'https://app.example',
  'https://App.Example:443',
  'http://a.example:80',
  'http://a.example:8080/x?y=z#f',
  'HTTPS://UPPER.example/cb',
  'https://sub.domain.example:8443',
  'http://localhost:3000',
  'https://127.0.0.1:8443/cb',
  'https://münchen.example',
  'https://a.example:0443',
  'https://a.example:0080',
  'https://a.example:65535',
  'https://a.example:65536',
  'https://a.example:99999',
  'https://a.example:0',
  'http://127.1',
  'http://0x7f.1',
  'http://2130706433',
  'https://1.2.3',
  'https://example.123',
  'https://%61.example',
  'https://[0:0:0:0:0:0:0:1]',
  'https://[::1]:3000/cb',
  'ftp://files.example/cb',
  'com.example.app:/oauth2redirect',
  'urn:ietf:wg:oauth:2.0:oob',
  'https://evil.com\\@good.com/cb',
  'https://user:secret@h.example/p',
  'https://a.example.',
  'https://a..example',
  'https://-a.example',
  ' https://a.example',
  'https://a.example\n',
  'https://a b.example',
];

describe('the origins of the backfill and of the server', () => {
  it.each(CORPUS)('agree on %j, or the backfill declines it', async (value) => {
    const [row] = await owner.sql<{ origin: string | null }[]>`
      select client_origin_if_canonical(${value}) as origin`;
    const server = [...expandWebOrigins([value], [])][0] ?? null;
    const viaRedirect = [...expandWebOrigins(['+'], [value])][0] ?? null;
    expect(viaRedirect).toBe(server);
    if (row?.origin !== null && row?.origin !== undefined) expect(row.origin).toBe(server);
  });

  it.each([
    'https://app.example',
    'https://App.Example:443',
    'http://a.example:80',
    'http://a.example:8080/x?y=z#f',
    'http://localhost:3000',
    'https://127.0.0.1:8443/cb',
  ])('reads %j as the server does', async (value) => {
    const [row] = await owner.sql<{ origin: string | null }[]>`
      select client_origin_if_canonical(${value}) as origin`;
    expect(row?.origin).toBe([...expandWebOrigins([value], [])][0]);
  });

  it.each(CORPUS)('are written as the server compares them for %j', async (value) => {
    const tenantId = newId();
    let clientId: string;
    try {
      clientId = await seedOne(tenantId, { webOrigins: [value] });
    } catch {
      return;
    }
    const rows = await owner.sql<{ origin: string }[]>`
      select origin from client_origins where client_id = ${clientId} order by origin`;
    expect(rows.map((row) => row.origin)).toEqual([...expandWebOrigins([value], [])].sort());
  });
});
