import { themeAssetSchema } from '@odudu/contracts/admin';
import { adminCall, nothing, segment } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { imageDataUrl } from '#/features/branding-editor/services/imageThumbnails';
import type { SlotImage } from '#/features/branding-editor/types/slotImage';

// The image is the request body, and `kind` says which slot it is for.
export function uploadAsset(
  gateway: Gateway,
  tenant: string,
  kind: string,
  file: Blob,
): Promise<GatewayResult<SlotImage>> {
  return adminCall(gateway, 'POST', tenant, ['theme', 'assets'], {
    query: new URLSearchParams({ kind }),
    file,
    schema: themeAssetSchema,
  });
}

// What the admin sees of an uploaded image before any public address serves
// it: its bytes, as a data address a page under this console's policy may show.
export async function readAssetImage(
  gateway: Gateway,
  tenant: string,
  assetId: string,
): Promise<GatewayResult<string>> {
  const result = await gateway.bytes(
    'GET',
    `admin/tenants/${segment(tenant)}/theme/assets/${segment(assetId)}/content`,
  );
  if (!result.ok) return result;
  const url = imageDataUrl(result.data.bytes, result.data.contentType);
  return url === null ? { ok: false, kind: 'schema' } : { ...result, data: url };
}

export function deleteAsset(
  gateway: Gateway,
  tenant: string,
  assetId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['theme', 'assets', assetId], { schema: nothing });
}
