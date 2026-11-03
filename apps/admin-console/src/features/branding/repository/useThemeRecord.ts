import type { ThemeView } from '@odudu/contracts/admin';
import { readTheme } from '#/features/branding/adapter/theme';
import { themeRecord, type ThemeScope } from '#/features/branding/services/themeScope';
import { useRecord, type RecordState } from '#/shared/repository/useRecord';

export function useThemeRecord(tenant: string, scope: ThemeScope): RecordState<ThemeView> {
  return useRecord({
    tenant,
    record: themeRecord(scope),
    read: (gateway) => readTheme(gateway, tenant, scope),
  });
}
