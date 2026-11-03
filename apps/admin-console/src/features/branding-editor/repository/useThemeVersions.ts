import type { ThemeVersions } from '#/features/branding-editor/types/themeVersion';
import { readVersions } from '#/features/branding-editor/adapter/themeDraft';
import { scopeKeyPart, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import { themeVersionsKey } from '#/shared/repository/queryKeys';
import { useRead } from '#/shared/repository/useRead';
import type { Read } from '#/shared/services/read';
import { useTransport } from '#/shared/transport/useTransport';

export function useThemeVersions(
  tenant: string,
  scope: ThemeScope,
  asked: boolean,
): Read<ThemeVersions> {
  const { gateway } = useTransport();
  return useRead(
    themeVersionsKey(tenant, scopeKeyPart(scope)),
    asked,
    () => readVersions(gateway, tenant, scope),
    { recent: true },
  );
}
