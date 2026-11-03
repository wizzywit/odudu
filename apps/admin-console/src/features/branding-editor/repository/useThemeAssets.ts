import type { SlotImage } from '#/features/branding-editor/types/slotImage';
import { deleteAsset, uploadAsset } from '#/features/branding-editor/adapter/themeAssets';
import { TENANT_WIDE_WRITES } from '#/features/branding-editor/services/themeScope';
import { themeWriteKey } from '#/shared/lib/repository/queryKeys';
import { useGatewayWrite, type Write } from '#/shared/lib/repository/useWrite';
import type { GatewayResult } from '#/shared/api/transport/gateway';

export interface Upload {
  kind: string;
  file: File;
}

// Neither is repeated if the answer is lost: an upload may have landed.
export function useAssetUpload(tenant: string): Write<Upload, GatewayResult<SlotImage>> {
  return useGatewayWrite({
    mutationKey: themeWriteKey(tenant, TENANT_WIDE_WRITES, 'upload'),
    send: (gateway, { kind, file }: Upload) => uploadAsset(gateway, tenant, kind, file),
  });
}

export function useAssetDelete(tenant: string): Write<string, GatewayResult<undefined>> {
  return useGatewayWrite({
    mutationKey: themeWriteKey(tenant, TENANT_WIDE_WRITES, 'delete-image'),
    send: (gateway, assetId: string) => deleteAsset(gateway, tenant, assetId),
  });
}
