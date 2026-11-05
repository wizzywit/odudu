import { provisionTenant } from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { clientRepository, clientScopeRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tenantCimdRepository } from '#/repository/tenant-cimd';
import { parseCimdDocument, type CimdClient } from '#/service/client-id-metadata';
import { CIMD_CLIENTS_PER_TENANT, persistCimdClient } from '#/usecase/persist-cimd-client';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

const NOW = new Date('2026-11-05T12:00:00.000Z');
const DAY = 86_400_000;
const URL_A = 'https://app.example.com/client.json';

let mine: string;
let theirs: string;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

beforeEach(async () => {
  mine = newId();
  theirs = newId();
  for (const id of [mine, theirs]) {
    await withTenant(app.db, id, async (tx) => {
      await tx.insert(tenants).values({ id, name: `t-${id}` });
      await provisionTenant(tx, id);
    });
  }
});

function documentClient(overrides: Record<string, unknown> = {}, url = URL_A): CimdClient {
  const outcome = parseCimdDocument(url, {
    client_id: url,
    client_name: 'Example app',
    redirect_uris: ['https://app.example.com/cb', 'http://127.0.0.1/callback'],
    ...overrides,
  });
  if (outcome.kind !== 'ok') throw new Error(`document refused: ${outcome.reason}`);
  return outcome.client;
}

function persist(tenantId: string, client: CimdClient, now = NOW) {
  return withTenant(app.db, tenantId, (tx) => persistCimdClient(tx, tenantId, client, now));
}

function rowsOf(tenantId: string, url = URL_A) {
  return withTenant(app.db, tenantId, async (tx) => {
    const client = await clientRepository(tx).byClientId(url);
    const config =
      client === null ? null : await clientOidcConfigRepository(tx).byClientId(client.id);
    const scopes =
      client === null ? [] : await clientScopeRepository(tx).forClientByAssignment(client.id);
    return { client, config, scopes };
  });
}

describe('persistCimdClient', () => {
  it('writes a public client from the document, with the default scopes and consent required', async () => {
    expect(await persist(mine, documentClient())).toBe('ok');

    const { client, config, scopes } = await rowsOf(mine);
    expect(client).toMatchObject({
      clientId: URL_A,
      name: 'Example app',
      type: 'public',
      secretHash: null,
      enabled: true,
      registrationOrigin: 'cimd',
      metadataUsedAt: NOW,
    });
    expect(config).toMatchObject({
      redirectUris: ['https://app.example.com/cb', 'http://127.0.0.1/callback'],
      grantTypes: ['authorization_code', 'refresh_token'],
      tokenEndpointAuthMethod: 'none',
      audiences: [],
      consentRequired: true,
    });
    expect(scopes.map((row) => row.scope.name)).toContain('openid');
    expect(scopes.map((row) => row.scope.name)).not.toContain('mcp:read');
  });

  it('rewrites the name and redirect addresses from a changed document and keeps one row', async () => {
    await persist(mine, documentClient());
    const first = (await rowsOf(mine)).client;

    await persist(
      mine,
      documentClient({ client_name: 'Renamed', redirect_uris: ['https://app.example.com/new'] }),
      new Date(NOW.getTime() + 2 * DAY),
    );

    const { client, config } = await rowsOf(mine);
    expect(client?.id).toBe(first?.id);
    expect(client).toMatchObject({
      name: 'Renamed',
      metadataUsedAt: new Date(NOW.getTime() + 2 * DAY),
    });
    expect(config?.redirectUris).toEqual(['https://app.example.com/new']);
  });

  it('writes the last-used instant at most once a day', async () => {
    await persist(mine, documentClient());
    await persist(mine, documentClient(), new Date(NOW.getTime() + 3_600_000));
    expect((await rowsOf(mine)).client?.metadataUsedAt).toEqual(NOW);
  });

  it('moves a client between public and confidential with its document', async () => {
    await persist(mine, documentClient());
    await persist(
      mine,
      documentClient({
        token_endpoint_auth_method: 'private_key_jwt',
        jwks_uri: 'https://app.example.com/jwks.json',
      }),
    );
    const { client, config } = await rowsOf(mine);
    expect(client?.type).toBe('confidential');
    expect(client?.secretHash).toBeNull();
    expect(config).toMatchObject({
      tokenEndpointAuthMethod: 'private_key_jwt',
      jwksUri: 'https://app.example.com/jwks.json',
    });
  });

  it('never re-enables a client an administrator disabled', async () => {
    await persist(mine, documentClient());
    await withTenant(app.db, mine, async (tx) => {
      const found = await clientRepository(tx).byClientId(URL_A);
      if (found === null) throw new Error('expected the client');
      await clientRepository(tx).update(found.id, { enabled: false });
    });
    await persist(mine, documentClient({ client_name: 'Again' }));
    expect((await rowsOf(mine)).client).toMatchObject({ enabled: false, name: 'Again' });
  });

  it('leaves a client of another origin holding the same client_id untouched', async () => {
    await withTenant(app.db, mine, async (tx) => {
      await clientRepository(tx).create({
        tenantId: mine,
        clientId: URL_A,
        name: 'Pre-registered',
        type: 'public',
        secretHash: null,
      });
    });
    expect(await persist(mine, documentClient())).toBe('foreign');
    expect((await rowsOf(mine)).client).toMatchObject({
      name: 'Pre-registered',
      registrationOrigin: 'seeded',
    });
  });

  it('refuses a name that carries a bidirectional control', async () => {
    expect(await persist(mine, documentClient({ client_name: 'Evil ‮app' }))).toBe('refused');
    expect((await rowsOf(mine)).client).toBeNull();
  });

  it('keeps one tenant’s client out of another’s', async () => {
    await persist(mine, documentClient());
    expect((await rowsOf(theirs)).client).toBeNull();
    expect(await persist(theirs, documentClient())).toBe('ok');
    expect((await rowsOf(theirs)).client?.tenantId).toBe(theirs);
  });

  it('stops creating clients at the per-tenant ceiling but still refreshes one it holds', async () => {
    await withTenant(app.db, mine, async (tx) => {
      const repository = clientRepository(tx);
      for (let index = 0; index < CIMD_CLIENTS_PER_TENANT; index += 1) {
        await repository.create({
          tenantId: mine,
          clientId: `https://filler.example/${String(index)}`,
          name: 'filler',
          type: 'public',
          secretHash: null,
          registrationOrigin: 'cimd',
          metadataUsedAt: NOW,
        });
      }
    });
    expect(await persist(mine, documentClient())).toBe('at_capacity');
    const filler = documentClient({}, 'https://filler.example/7');
    expect(await persist(mine, filler)).toBe('ok');
    expect(await persist(theirs, documentClient())).toBe('ok');
  }, 60_000);

  it('counts only its own tenant’s cimd clients', async () => {
    await persist(mine, documentClient());
    const counted = await withTenant(app.db, theirs, (tx) =>
      clientRepository(tx).countCimdAtMost(10),
    );
    expect(counted).toBe(0);
  });

  it('reads the setting of its own tenant only', async () => {
    await ownerHandle?.db.execute(sql`update tenants set cimd_enabled = true where id = ${mine}`);
    const read = (inTenant: string, asked: string) =>
      withTenant(app.db, inTenant, (tx) => tenantCimdRepository(tx).enabled(asked));
    expect(await read(mine, mine)).toBe(true);
    expect(await read(theirs, theirs)).toBe(false);
    expect(await read(theirs, mine)).toBe(false);
  });

  it('cannot mark a foreign tenant’s client used', async () => {
    await persist(mine, documentClient());
    const id = (await rowsOf(mine)).client?.id ?? '';
    await withTenant(app.db, theirs, (tx) =>
      clientRepository(tx).markMetadataUsed(id, new Date(NOW.getTime() + 9 * DAY)),
    );
    expect((await rowsOf(mine)).client?.metadataUsedAt).toEqual(NOW);
  });
});
