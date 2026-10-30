import { createHash } from 'node:crypto';
import { type NewAsset } from '#/repository/assets';
import {
  inspectLimitsFor,
  TENANT_ASSET_CAP_BYTES,
  withinByteLimit,
  withinOutputLimit,
  type AssetKind,
} from '#/service/asset-limits';
import { inspectImage, isImageRefusal, type ImageRefusalCode } from '#/service/image';
import { type AssetRef } from '#/service/record';

export type UploadRefusalCode = ImageRefusalCode | 'too_large' | 'over_cap';

export interface UploadRefusal {
  kind: 'refused';
  code: UploadRefusalCode;
}

export interface UploadAssetDeps {
  // The image inspector; the default is the bounded one in service/image.
  inspect?: typeof inspectImage;
  // Runs in the tenant's transaction; the repository holds the tenant lock
  // that makes the cap check race-safe.
  store(asset: NewAsset): Promise<AssetRef | 'over_cap'>;
}

export interface UploadAssetInput {
  tenantId: string;
  bytes: Uint8Array;
  kind: AssetKind;
}

function refuse(code: UploadRefusalCode): UploadRefusal {
  return { kind: 'refused', code };
}

// What is stored is the re-encoded image, never the upload, and it is
// addressed by its own hash, so the same picture uploaded twice is one row.
export function uploadAsset(
  deps: UploadAssetDeps,
): (input: UploadAssetInput) => Promise<AssetRef | UploadRefusal> {
  const inspect = deps.inspect ?? inspectImage;
  return async ({ tenantId, bytes, kind }) => {
    if (!withinByteLimit(kind, bytes.length)) return refuse('too_large');
    const image = await inspect(bytes, inspectLimitsFor(kind));
    if (isImageRefusal(image)) return refuse(image.code);
    if (!withinOutputLimit(kind, image.bytes.length)) return refuse('too_large');
    const stored = await deps.store({
      tenantId,
      sha256: createHash('sha256').update(image.bytes).digest('hex'),
      mime: image.mime,
      width: image.width,
      height: image.height,
      bytes: Buffer.from(image.bytes),
      tenantCapBytes: TENANT_ASSET_CAP_BYTES,
    });
    return stored === 'over_cap' ? refuse('over_cap') : stored;
  };
}
