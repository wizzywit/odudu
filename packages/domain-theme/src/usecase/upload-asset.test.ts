import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { type NewAsset } from '#/repository/assets';
import {
  ASSET_LIMITS,
  OUTPUT_GROWTH,
  TENANT_ASSET_CAP_BYTES,
  type AssetKind,
} from '#/service/asset-limits';
import { type AssetRef } from '#/service/record';
import { uploadAsset, type UploadRefusal } from '#/usecase/upload-asset';

const KINDS: AssetKind[] = ['logo', 'darkLogo', 'favicon', 'background'];

function recorder() {
  const stored: NewAsset[] = [];
  const upload = uploadAsset({
    store: (asset) => {
      stored.push(asset);
      return Promise.resolve<AssetRef | 'over_cap'>({
        id: 'a',
        sha256: asset.sha256,
        mime: asset.mime,
        width: asset.width,
        height: asset.height,
      });
    },
  });
  return { stored, upload };
}

async function paddedTo(length: number): Promise<Buffer> {
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  return Buffer.concat([png, Buffer.alloc(length - png.length, 0x20)]);
}

function code(result: AssetRef | UploadRefusal): string {
  return 'kind' in result ? result.code : 'accepted';
}

describe('uploadAsset byte limits', () => {
  it.each(KINDS)('accepts a %s of exactly its limit and refuses one byte more', async (kind) => {
    const { upload, stored } = recorder();
    const max = ASSET_LIMITS[kind].maxBytes;
    expect(code(await upload({ tenantId: 't', bytes: await paddedTo(max), kind }))).toBe(
      'accepted',
    );
    expect(code(await upload({ tenantId: 't', bytes: await paddedTo(max + 1), kind }))).toBe(
      'too_large',
    );
    expect(stored).toHaveLength(1);
  });

  it('judges the re-encoded file by the output ceiling, not the upload limit', async () => {
    const kind: AssetKind = 'logo';
    const max = ASSET_LIMITS[kind].maxBytes;
    const ceiling = Math.floor(max * OUTPUT_GROWTH);
    const grown = (length: number) => ({
      inspect: () =>
        Promise.resolve({
          mime: 'image/png' as const,
          width: 1,
          height: 1,
          bytes: new Uint8Array(length),
        }),
      store: (asset: NewAsset) =>
        Promise.resolve<AssetRef | 'over_cap'>({ id: 'a', ...asset, sha256: asset.sha256 }),
    });
    const input = new Uint8Array(max);
    expect(code(await uploadAsset(grown(max + 10))({ tenantId: 't', bytes: input, kind }))).toBe(
      'accepted',
    );
    expect(code(await uploadAsset(grown(ceiling))({ tenantId: 't', bytes: input, kind }))).toBe(
      'accepted',
    );
    expect(code(await uploadAsset(grown(ceiling + 1))({ tenantId: 't', bytes: input, kind }))).toBe(
      'too_large',
    );
  });

  it('passes the tenant cap to the store', async () => {
    const { upload, stored } = recorder();
    await upload({ tenantId: 't', bytes: await paddedTo(1000), kind: 'logo' });
    expect(stored[0]?.tenantCapBytes).toBe(TENANT_ASSET_CAP_BYTES);
  });
});
