import type { Settings } from '@odudu/contracts/admin';
import { useTenantSettingsRead } from '#/entities/tenant';
import { settingsSections, type SectionPlan } from '#/features/settings/services/sectionPlan';
import type { SettingsPageWords } from '#/features/settings/services/settingsPageWords';
import type { RecordState } from '#/shared/repository/useRecord';

export function useSettingsSections(tenant: string): {
  read: RecordState<Settings>;
  plans: readonly SectionPlan[];
  words: SettingsPageWords;
} {
  const { plans, words } = settingsSections();
  return { read: useTenantSettingsRead(tenant), plans, words };
}
