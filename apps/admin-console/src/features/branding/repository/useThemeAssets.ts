import type { ThemeAsset } from '@odudu/contracts/admin';
import { deleteAsset, uploadAsset } from '#/features/branding/adapter/theme';
import { themeWriteKey } from '#/shared/repository/queryKeys';
import { useGatewayWrite, type Write } from '#/shared/repository/useWrite';
import type { GatewayResult } from '#/shared/transport/gateway';

export interface Upload {
  kind: string;
  file: File;
}

// Neither is repeated if the answer is lost: an upload may have landed.
export function useAssetUpload(tenant: string): Write<Upload, GatewayResult<ThemeAsset>> {
  return useGatewayWrite({
    mutationKey: themeWriteKey(tenant, 'tenant-wide', 'upload'),
    send: (gateway, { kind, file }: Upload) => uploadAsset(gateway, tenant, kind, file),
  });
}

export function useAssetDelete(tenant: string): Write<string, GatewayResult<undefined>> {
  return useGatewayWrite({
    mutationKey: themeWriteKey(tenant, 'tenant-wide', 'delete-image'),
    send: (gateway, assetId: string) => deleteAsset(gateway, tenant, assetId),
  });
}
