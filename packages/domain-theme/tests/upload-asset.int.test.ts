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
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assetRepository, type NewAsset } from '#/repository/assets';
import { ASSET_LIMITS, TENANT_ASSET_CAP_BYTES, type AssetKind } from '#/service/asset-limits';
import { inspectImage, isImageRefusal } from '#/service/image';
import { type AssetRef } from '#/service/record';
import { uploadAsset, type UploadRefusal } from '#/usecase/upload-asset';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 8 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function freshTenant(): Promise<string> {
  const tenantId = newId();
  await withTenant(app.db, tenantId, (tx) =>
    tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` }),
  );
  return tenantId;
}

function upload(asTenant: string) {
  return uploadAsset({
    store: (asset: NewAsset) =>
      withTenant(app.db, asTenant, (tx) => assetRepository(tx).put(asset)),
  });
}

function noise(side: number) {
  return sharp({
    create: {
      width: side,
      height: side,
      channels: 3,
      background: 'black',
      noise: { type: 'gaussian', mean: 128, sigma: 60 },
    },
  })
    .png()
    .toBuffer();
}

function refusal(result: AssetRef | UploadRefusal): string {
  return 'kind' in result ? result.code : 'accepted';
}

function stored(result: AssetRef | UploadRefusal): AssetRef {
  if ('kind' in result) throw new Error(`refused: ${result.code}`);
  return result;
}

async function rowCount(tenantId: string): Promise<number> {
  const [row] = await owner.sql<{ n: number }[]>`
    select count(*)::int as n from theme_assets where tenant_id = ${tenantId}`;
  return row?.n ?? 0;
}

describe('uploadAsset', () => {
  it('stores the re-encoded image, not the upload', async () => {
    const tenantId = await freshTenant();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    const polyglot = Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]);
    const ref = stored(await upload(tenantId)({ tenantId, bytes: polyglot, kind: 'logo' }));
    const row = await withTenant(app.db, tenantId, (tx) =>
      assetRepository(tx).get(tenantId, ref.sha256),
    );
    expect(row?.bytes.includes('<script>')).toBe(false);
    expect([ref.mime, ref.width, ref.height]).toEqual(['image/png', 8, 8]);
  });

  it('the same bytes upload to the same hash and one row', async () => {
    const tenantId = await freshTenant();
    const bytes = await noise(64);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => upload(tenantId)({ tenantId, bytes, kind: 'logo' })),
    );
    const refs = results.map(stored);
    expect(new Set(refs.map((ref) => ref.sha256)).size).toBe(1);
    expect(new Set(refs.map((ref) => ref.id)).size).toBe(1);
    expect(await rowCount(tenantId)).toBe(1);
    const used = await withTenant(app.db, tenantId, (tx) =>
      assetRepository(tx).bytesUsed(tenantId),
    );
    const image = await inspectImage(bytes);
    if (isImageRefusal(image)) throw new Error('refused');
    expect(used).toBe(image.bytes.length);
  });

  it('refuses over the tenant cap', async () => {
    const tenantId = await freshTenant();
    await owner.sql`
      insert into theme_assets (id, tenant_id, sha256, mime, width, height, bytes)
      values (gen_random_uuid(), ${tenantId}, repeat('a', 64), 'image/png', 1, 1,
              decode(repeat('00', ${TENANT_ASSET_CAP_BYTES - 10}), 'hex'))`;
    const result = await upload(tenantId)({ tenantId, bytes: await noise(32), kind: 'logo' });
    expect(refusal(result)).toBe('over_cap');
    expect(await rowCount(tenantId)).toBe(1);
  });

  it('accepts exactly up to the tenant cap, refuses one byte more, and still takes a re-upload', async () => {
    const bytes = await noise(40);
    const image = await inspectImage(bytes);
    if (isImageRefusal(image)) throw new Error('refused');
    const size = image.bytes.length;
    const fill = async (tenantId: string, filler: number) => {
      await owner.sql`
        insert into theme_assets (id, tenant_id, sha256, mime, width, height, bytes)
        values (gen_random_uuid(), ${tenantId}, repeat('c', 64), 'image/png', 1, 1,
                decode(repeat('00', ${filler}), 'hex'))`;
    };
    const exact = await freshTenant();
    await fill(exact, TENANT_ASSET_CAP_BYTES - size);
    const first = stored(await upload(exact)({ tenantId: exact, bytes, kind: 'logo' }));
    const again = stored(await upload(exact)({ tenantId: exact, bytes, kind: 'logo' }));
    expect(again.id).toBe(first.id);
    expect(await rowCount(exact)).toBe(2);

    const over = await freshTenant();
    await fill(over, TENANT_ASSET_CAP_BYTES - size + 1);
    expect(refusal(await upload(over)({ tenantId: over, bytes, kind: 'logo' }))).toBe('over_cap');
  });

  it('a polyglot and the clean copy of one picture are one hash and one row', async () => {
    const tenantId = await freshTenant();
    const clean = await sharp({
      create: { width: 16, height: 16, channels: 3, background: 'teal' },
    })
      .png()
      .toBuffer();
    const polyglot = Buffer.concat([clean, Buffer.from('<script>alert(1)</script>')]);
    const a = stored(await upload(tenantId)({ tenantId, bytes: clean, kind: 'logo' }));
    const b = stored(await upload(tenantId)({ tenantId, bytes: polyglot, kind: 'logo' }));
    expect(b.sha256).toBe(a.sha256);
    expect(b.id).toBe(a.id);
    expect(await rowCount(tenantId)).toBe(1);
  });

  it('two uploads racing for the last room cannot both pass the cap', async () => {
    const tenantId = await freshTenant();
    const images = await Promise.all(Array.from({ length: 6 }, () => noise(100)));
    const sizes = await Promise.all(
      images.map(async (bytes) => {
        const image = await inspectImage(bytes);
        if (isImageRefusal(image)) throw new Error('refused');
        return image.bytes.length;
      }),
    );
    const largest = Math.max(...sizes);
    const smallest = Math.min(...sizes);
    const room = 2 * largest + Math.floor(smallest / 2);
    expect(room).toBeLessThan(3 * smallest);
    await owner.sql`
      insert into theme_assets (id, tenant_id, sha256, mime, width, height, bytes)
      values (gen_random_uuid(), ${tenantId}, repeat('b', 64), 'image/png', 1, 1,
              decode(repeat('00', ${TENANT_ASSET_CAP_BYTES - room}), 'hex'))`;
    const results = await Promise.all(
      images.map((bytes) => upload(tenantId)({ tenantId, bytes, kind: 'logo' })),
    );
    const codes = results.map(refusal);
    expect(codes.filter((code) => code === 'accepted')).toHaveLength(2);
    expect(codes.filter((code) => code === 'over_cap')).toHaveLength(4);
    const used = await withTenant(app.db, tenantId, (tx) =>
      assetRepository(tx).bytesUsed(tenantId),
    );
    expect(used).toBeLessThanOrEqual(TENANT_ASSET_CAP_BYTES);
  });

  it.each<[AssetKind, number]>([
    ['logo', ASSET_LIMITS.logo.maxBytes],
    ['favicon', ASSET_LIMITS.favicon.maxBytes],
    ['darkLogo', ASSET_LIMITS.darkLogo.maxBytes],
    ['background', ASSET_LIMITS.background.maxBytes],
  ])('refuses a %s upload larger than %i bytes without decoding it', async (kind, max) => {
    const tenantId = await freshTenant();
    const body = Buffer.concat([await noise(8), Buffer.alloc(max)]);
    expect(refusal(await upload(tenantId)({ tenantId, bytes: body, kind }))).toBe('too_large');
    expect(await rowCount(tenantId)).toBe(0);
  });

  it('refuses a logo past 1024 px and accepts a background of 2560 px', async () => {
    const tenantId = await freshTenant();
    const flat = (side: number) =>
      sharp({ create: { width: side, height: 8, channels: 3, background: 'blue' } })
        .png()
        .toBuffer();
    expect(
      refusal(await upload(tenantId)({ tenantId, bytes: await flat(1025), kind: 'logo' })),
    ).toBe('too_wide');
    expect(
      refusal(await upload(tenantId)({ tenantId, bytes: await flat(1024), kind: 'favicon' })),
    ).toBe('accepted');
    expect(
      refusal(await upload(tenantId)({ tenantId, bytes: await flat(2560), kind: 'background' })),
    ).toBe('accepted');
    expect(
      refusal(await upload(tenantId)({ tenantId, bytes: await flat(2561), kind: 'background' })),
    ).toBe('too_wide');
  });

  it('refuses SVG and stores nothing', async () => {
    const tenantId = await freshTenant();
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>');
    expect(refusal(await upload(tenantId)({ tenantId, bytes: svg, kind: 'logo' }))).toBe(
      'unsupported_type',
    );
    expect(await rowCount(tenantId)).toBe(0);
  });

  describe('across tenants', () => {
    it('gives each tenant its own row and cap for the same picture', async () => {
      const tenantA = await freshTenant();
      const tenantB = await freshTenant();
      const bytes = await noise(48);
      const a = stored(await upload(tenantA)({ tenantId: tenantA, bytes, kind: 'logo' }));
      const b = stored(await upload(tenantB)({ tenantId: tenantB, bytes, kind: 'logo' }));
      expect(b.sha256).toBe(a.sha256);
      expect(b.id).not.toBe(a.id);
      expect(await rowCount(tenantA)).toBe(1);
      expect(await rowCount(tenantB)).toBe(1);
    });

    it('does not let tenant B read tenant A’s image', async () => {
      const tenantA = await freshTenant();
      const tenantB = await freshTenant();
      const a = stored(
        await upload(tenantA)({ tenantId: tenantA, bytes: await noise(40), kind: 'logo' }),
      );
      const seenByB = await withTenant(app.db, tenantB, async (tx) => {
        const assets = assetRepository(tx);
        return {
          byHash: await assets.get(tenantA, a.sha256),
          ownHash: await assets.get(tenantB, a.sha256),
          used: await assets.bytesUsed(tenantA),
        };
      });
      expect(seenByB).toEqual({ byHash: null, ownHash: null, used: 0 });
    });

    it('refuses an upload that names another tenant', async () => {
      const tenantA = await freshTenant();
      const tenantB = await freshTenant();
      const asB = uploadAsset({
        store: (asset) => withTenant(app.db, tenantB, (tx) => assetRepository(tx).put(asset)),
      });
      await expect(
        asB({ tenantId: tenantA, bytes: await noise(40), kind: 'logo' }),
      ).rejects.toSatisfy((error: unknown) => {
        const cause = error instanceof Error ? (error.cause ?? error) : error;
        return cause instanceof Error && /row-level security/iu.test(cause.message);
      });
      expect(await rowCount(tenantA)).toBe(0);
    });
  });
});
