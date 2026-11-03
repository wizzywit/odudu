import type { Settings } from '@odudu/contracts/admin';
import { useTenantSettingsRead } from '#/entities/tenant';
import { settingsSections, type SectionPlan } from '#/pages/settings/services/sectionPlan';
import type { SettingsPageWords } from '#/pages/settings/services/settingsPageWords';
import type { RecordState } from '#/shared/lib/repository/useRecord';

export function useSettingsSections(tenant: string): {
  read: RecordState<Settings>;
  plans: readonly SectionPlan[];
  words: SettingsPageWords;
} {
  const { plans, words } = settingsSections();
  return { read: useTenantSettingsRead(tenant), plans, words };
}
