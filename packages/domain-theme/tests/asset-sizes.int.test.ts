import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetRepository } from '#/repository/assets';

let container: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  ownerHandle = createDatabase(container.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await container?.stop();
});

async function seedImage(
  tx: TenantScopedDatabase,
  tenantId: string,
  content: string,
): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  const stored = await assetRepository(tx).put({
    tenantId,
    sha256: Buffer.from(content).toString('hex').padEnd(64, '0'),
    mime: 'image/png',
    width: 2,
    height: 2,
    bytes: Buffer.from(content),
    tenantCapBytes: 4096,
  });
  if (stored === 'over_cap') throw new Error('refused');
  return stored.id;
}

describe('assetRepository.sizes and bytesOf', () => {
  it('weigh an image without reading it, and read it when asked', async () => {
    const tenantId = newId();
    const id = await withTenant(app.db, tenantId, (tx) => seedImage(tx, tenantId, 'twelve bytes'));
    await withTenant(app.db, tenantId, async (tx) => {
      const [weighed] = await assetRepository(tx).sizes(tenantId, [id, newId()]);
      expect(weighed).toMatchObject({ id, mime: 'image/png', size: 12 });
      expect(weighed).not.toHaveProperty('bytes');
      const [read] = await assetRepository(tx).bytesOf(tenantId, [id]);
      expect(read?.bytes.toString()).toBe('twelve bytes');
    });
  });

  it('answer an empty list with nothing and no query', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      expect(await assetRepository(tx).sizes(tenantId, [])).toEqual([]);
      expect(await assetRepository(tx).bytesOf(tenantId, [])).toEqual([]);
    });
  });

  it('find nothing for a foreign tenant id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => ({ tenantId, id: await seedImage(tx, tenantId, 'probe') }),
      verifySeeded: async (tx, seeded) => {
        expect(await assetRepository(tx).sizes(seeded.tenantId, [seeded.id])).toHaveLength(1);
      },
      attempt: async (tx, seeded) => ({
        sizes: await assetRepository(tx).sizes(seeded.tenantId, [seeded.id]),
        bytes: await assetRepository(tx).bytesOf(seeded.tenantId, [seeded.id]),
      }),
      expectBlocked: (result) => {
        expect(result).toEqual({ sizes: [], bytes: [] });
      },
    });
  });
});
