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
import { cimdClientRepository } from '#/repository/cimd-clients';
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

  // `n` metadata document clients of `tenant`, the first used longest ago.
  async function fill(tenant: string, n: number): Promise<void> {
    await ownerHandle?.db.execute(sql`
      insert into clients (id, tenant_id, client_id, name, type, registration_origin, metadata_used_at)
      select gen_random_uuid(), ${tenant}, 'https://filler.example/' || g, 'filler', 'public', 'cimd',
             ${NOW.toISOString()}::timestamptz - (${n + 1}::int - g) * interval '1 second'
        from generate_series(1, ${n}) g`);
  }

  async function idOf(tenant: string, url: string): Promise<string> {
    const found = await ownerHandle?.db.execute<{ id: string }>(
      sql`select id from clients where tenant_id = ${tenant} and client_id = ${url}`,
    );
    return found?.[0]?.id ?? '';
  }

  async function urlsOf(tenant: string): Promise<Set<string>> {
    const found = await ownerHandle?.db.execute<{ client_id: string }>(
      sql`select client_id from clients where tenant_id = ${tenant} and registration_origin = 'cimd'`,
    );
    return new Set((found ?? []).map((row) => row.client_id));
  }

  async function protect(
    tenant: string,
    url: string,
    how: 'consent' | 'refresh' | 'code',
  ): Promise<void> {
    const client = await idOf(tenant, url);
    const subject = newId();
    const db = ownerHandle?.db;
    if (db === undefined) throw new Error('no database');
    await db.execute(
      sql`insert into subjects (id, tenant_id, type) values (${subject}, ${tenant}, 'user')`,
    );
    if (how === 'consent') {
      await db.execute(sql`insert into consents (id, tenant_id, subject_id, client_id)
        values (gen_random_uuid(), ${tenant}, ${subject}, ${client})`);
    } else if (how === 'refresh') {
      const grant = newId();
      await db.execute(sql`insert into token_grants (id, tenant_id, client_id, subject_id, scope)
        values (${grant}, ${tenant}, ${client}, ${subject}, 'openid')`);
      await db.execute(sql`insert into refresh_tokens (token_hash, tenant_id, grant_id, expires_at)
        values (${`rt-${client}`}, ${tenant}, ${grant}, now() + interval '5 days')`);
    } else {
      await db.execute(sql`insert into authorization_codes (code_hash, tenant_id, client_id, subject_id,
          redirect_uri, scope, code_challenge, code_challenge_method, auth_time, expires_at)
        values (${`code-${client}`}, ${tenant}, ${client}, ${subject}, 'https://a.example/cb', 'openid',
          'c', 'S256', ${NOW.toISOString()}::timestamptz, now() + interval '1 minute')`);
    }
  }

  it('[ODUDU-CIMD-CEILING-01] makes room at the ceiling by evicting the oldest row that never completed anything', async () => {
    await fill(mine, CIMD_CLIENTS_PER_TENANT);

    expect(await persist(mine, documentClient())).toBe('ok');

    const urls = await urlsOf(mine);
    expect(urls.size).toBe(CIMD_CLIENTS_PER_TENANT);
    expect(urls.has(URL_A)).toBe(true);
    expect(urls.has('https://filler.example/1')).toBe(false);
    expect(urls.has('https://filler.example/2')).toBe(true);
  }, 60_000);

  it('never evicts a client with a consent, a live refresh token or an unexpired code', async () => {
    await fill(mine, CIMD_CLIENTS_PER_TENANT);
    await protect(mine, 'https://filler.example/1', 'refresh');
    await protect(mine, 'https://filler.example/2', 'consent');
    await protect(mine, 'https://filler.example/3', 'code');

    expect(await persist(mine, documentClient())).toBe('ok');

    const urls = await urlsOf(mine);
    for (const kept of [1, 2, 3])
      expect(urls.has(`https://filler.example/${String(kept)}`)).toBe(true);
    expect(urls.has('https://filler.example/4')).toBe(false);
  }, 60_000);

  it('never evicts a client an administrator disabled, so the decision survives a full tenant', async () => {
    await fill(mine, CIMD_CLIENTS_PER_TENANT);
    await ownerHandle?.db.execute(
      sql`update clients set enabled = false where tenant_id = ${mine} and client_id = 'https://filler.example/1'`,
    );

    expect(await persist(mine, documentClient())).toBe('ok');

    const urls = await urlsOf(mine);
    expect(urls.has('https://filler.example/1')).toBe(true);
    expect(urls.has('https://filler.example/2')).toBe(false);
  }, 60_000);

  it('does not count a refresh token of a revoked grant, and counts one that lapsed within an access token’s life', async () => {
    await fill(mine, CIMD_CLIENTS_PER_TENANT);
    await protect(mine, 'https://filler.example/1', 'refresh');
    await ownerHandle?.db.execute(
      sql`update token_grants set revoked_at = now() where tenant_id = ${mine}`,
    );
    await protect(mine, 'https://filler.example/2', 'refresh');
    await ownerHandle?.db
      .execute(sql`update refresh_tokens set expires_at = now() - interval '30 minutes'
       where tenant_id = ${mine} and token_hash like ${`rt-%`} and grant_id in
       (select id from token_grants where tenant_id = ${mine} and revoked_at is null)`);

    expect(await persist(mine, documentClient(), new Date())).toBe('ok');

    const urls = await urlsOf(mine);
    expect(urls.has('https://filler.example/1')).toBe(false);
    expect(urls.has('https://filler.example/2')).toBe(true);
  }, 60_000);

  it('refuses a new client at the ceiling when every row is protected, and still refreshes a held one', async () => {
    await fill(mine, 3);
    await ownerHandle?.db.execute(
      sql`update clients set metadata_used_at = ${NOW.toISOString()}::timestamptz where tenant_id = ${mine}`,
    );
    for (const n of [1, 2, 3])
      await protect(mine, `https://filler.example/${String(n)}`, 'consent');
    const ceiling = await withTenant(app.db, mine, (tx) =>
      persistCimdClient(tx, mine, documentClient(), NOW, 3),
    );
    expect(ceiling).toBe('at_capacity');
    const held = await withTenant(app.db, mine, (tx) =>
      persistCimdClient(tx, mine, documentClient({}, 'https://filler.example/2'), NOW, 3),
    );
    expect(held).toBe('ok');
  });

  it('evicts nothing of another tenant, and finds nothing evictable through a foreign tenant context', async () => {
    await fill(mine, 5);
    await fill(theirs, 5);
    const asTheirs = await withTenant(app.db, theirs, (tx) =>
      cimdClientRepository(tx).evictable(NOW),
    );
    const mineId = await idOf(mine, 'https://filler.example/1');
    expect(asTheirs).not.toBe(mineId);
    const other = await withTenant(app.db, mine, (tx) =>
      persistCimdClient(tx, mine, documentClient(), NOW, 5),
    );
    expect(other).toBe('ok');
    expect((await urlsOf(theirs)).size).toBe(5);
  });

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
