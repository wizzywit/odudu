import type { ThemeView } from '#/features/branding-editor/types/theme';
import { readTheme } from '#/features/branding-editor/adapter/themeDraft';
import { themeRecord, type ThemeScope } from '#/features/branding-editor/services/themeScope';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';

export function useThemeRecord(tenant: string, scope: ThemeScope): RecordState<ThemeView> {
  return useRecord({
    tenant,
    record: themeRecord(scope),
    read: (gateway) => readTheme(gateway, tenant, scope),
  });
}
