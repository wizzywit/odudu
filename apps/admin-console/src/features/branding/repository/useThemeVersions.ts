import type { ListThemeVersionsResponse } from '@odudu/contracts/admin';
import { readVersions } from '#/features/branding/adapter/theme';
import { scopeKeyPart, type ThemeScope } from '#/features/branding/service';
import { themeVersionsKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/service/read';
import { useTransport } from '#/shared/transport/useTransport';

export function useThemeVersions(
  tenant: string,
  scope: ThemeScope,
  asked: boolean,
): Read<ListThemeVersionsResponse> {
  const { gateway } = useTransport();
  return useRead(
    themeVersionsKey(tenant, scopeKeyPart(scope)),
    asked,
    () => readVersions(gateway, tenant, scope),
    { recent: true },
  );
}
