import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cimdCacheRepository } from '#/repository/client-metadata-cache';
import { clientMetadataCache } from '#/schema/client-metadata-cache';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date('2026-11-05T12:00:00.000Z');
const later = new Date(NOW.getTime() + 600_000);
const URL_A = 'https://app.example.com/client.json';

let mine: string;
let theirs: string;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;
  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
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
    await withTenant(app.db, id, (tx) => tx.insert(tenants).values({ id, name: `t-${id}` }));
  }
});

async function rows(tenantId: string): Promise<string[]> {
  return withTenant(app.db, tenantId, async (tx) => {
    const found = await tx.select({ url: clientMetadataCache.url }).from(clientMetadataCache);
    return found.map((row) => row.url).sort();
  });
}

describe('cimdCacheRepository', () => {
  it('returns what was stored until it expires', async () => {
    const repo = cimdCacheRepository(app);
    await repo.store(mine, URL_A, { client_name: 'App' }, NOW, later, 1000);

    expect(await repo.find(mine, URL_A, NOW)).toEqual({
      body: { client_name: 'App' },
      expiresAt: later,
    });
    expect(await repo.find(mine, URL_A, new Date(later.getTime() - 1))).not.toBeNull();
    expect(await repo.find(mine, URL_A, later)).toBeNull();
  });

  it('replaces a document stored again for the same URL', async () => {
    const repo = cimdCacheRepository(app);
    await repo.store(mine, URL_A, { v: 1 }, NOW, later, 1000);
    await repo.store(mine, URL_A, { v: 2 }, NOW, later, 1000);
    expect((await repo.find(mine, URL_A, NOW))?.body).toEqual({ v: 2 });
    expect(await rows(mine)).toEqual([URL_A]);
  });

  it('keeps at most the ceiling of rows per tenant, dropping the oldest fetched', async () => {
    const repo = cimdCacheRepository(app);
    for (let i = 0; i < 5; i += 1) {
      await repo.store(
        mine,
        `https://a.example.com/${String(i)}`,
        {},
        new Date(NOW.getTime() + i * 1000),
        later,
        3,
      );
    }
    expect(await rows(mine)).toEqual([
      'https://a.example.com/2',
      'https://a.example.com/3',
      'https://a.example.com/4',
    ]);
  });

  it('trims one tenant without touching another', async () => {
    const repo = cimdCacheRepository(app);
    await repo.store(theirs, URL_A, {}, NOW, later, 1);
    for (let i = 0; i < 3; i += 1) {
      await repo.store(
        mine,
        `https://a.example.com/${String(i)}`,
        {},
        new Date(NOW.getTime() + i),
        later,
        1,
      );
    }
    expect(await rows(mine)).toHaveLength(1);
    expect(await rows(theirs)).toEqual([URL_A]);
  });

  // Foreign-tenant probes: every method, with a tenant id that is not the
  // one the transaction is bound to, and with the table read directly.
  it("find under one tenant never reads another tenant's document", async () => {
    const repo = cimdCacheRepository(app);
    await repo.store(theirs, URL_A, { secret: true }, NOW, later, 1000);
    expect(await repo.find(mine, URL_A, NOW)).toBeNull();
    expect(await repo.find(theirs, URL_A, NOW)).not.toBeNull();
  });

  it("store for one tenant leaves another tenant's row for the same URL alone", async () => {
    const repo = cimdCacheRepository(app);
    await repo.store(theirs, URL_A, { owner: 'theirs' }, NOW, later, 1000);
    await repo.store(mine, URL_A, { owner: 'mine' }, NOW, later, 1000);
    expect((await repo.find(theirs, URL_A, NOW))?.body).toEqual({ owner: 'theirs' });
    expect((await repo.find(mine, URL_A, NOW))?.body).toEqual({ owner: 'mine' });
  });

  it('row-level security hides and refuses a foreign tenant_id on the table itself', async () => {
    await cimdCacheRepository(app).store(theirs, URL_A, {}, NOW, later, 1000);
    expect(await rows(mine)).toEqual([]);
    await expect(
      withTenant(app.db, mine, (tx) =>
        tx.insert(clientMetadataCache).values({
          tenantId: theirs,
          url: 'https://b.example.com/x',
          body: {},
          fetchedAt: NOW,
          expiresAt: later,
        }),
      ),
    ).rejects.toThrow();
    const deleted = await withTenant(app.db, mine, (tx) =>
      tx.execute(sql`delete from client_metadata_cache where url = ${URL_A} returning url`),
    );
    expect(deleted).toHaveLength(0);
    expect(await rows(theirs)).toEqual([URL_A]);
  });

  it('stores a 5 KiB array of small numbers, whose jsonb form is several times its text', async () => {
    const body = Array.from({ length: 2559 }, () => 1);
    expect(JSON.stringify(body).length).toBeLessThanOrEqual(5120);
    await cimdCacheRepository(app).store(mine, URL_A, body, NOW, later, 1000);
    expect((await cimdCacheRepository(app).find(mine, URL_A, NOW))?.body).toEqual(body);
  });

  it('never leaves more than the ceiling after concurrent stores', async () => {
    const repo = cimdCacheRepository(app);
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        repo.store(
          mine,
          `https://c.example.com/${String(i)}`,
          {},
          new Date(NOW.getTime() + i),
          later,
          4,
        ),
      ),
    );
    expect(await rows(mine)).toHaveLength(4);
  });

  it('refuses a body past the stored cap and a URL past 2048 characters', async () => {
    const repo = cimdCacheRepository(app);
    await expect(
      repo.store(mine, URL_A, { x: 'a'.repeat(9000) }, NOW, later, 1000),
    ).rejects.toThrow();
    await expect(
      repo.store(mine, `https://a.example.com/${'a'.repeat(2100)}`, {}, NOW, later, 1000),
    ).rejects.toThrow();
  });
});
