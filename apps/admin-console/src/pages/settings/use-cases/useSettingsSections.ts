import type { Settings } from '#/entities/tenant';
import { TENANT_SETTINGS_RECORD, useTenantSettingsRead } from '#/entities/tenant';
import {
  settingsNav,
  settingsSections,
  type NavGroup,
  type SectionPlan,
} from '#/pages/settings/services/sectionPlan';
import type { SettingsPageWords } from '#/pages/settings/services/settingsPageWords';
import { useDirtySections } from '#/shared/lib/repository/useDirtySections';
import type { RecordState } from '#/shared/lib/repository/useRecord';

export function useSettingsSections(tenant: string): {
  read: RecordState<Settings>;
  plans: readonly SectionPlan[];
  nav: readonly NavGroup[];
  words: SettingsPageWords;
} {
  const { plans, words } = settingsSections();
  const dirty = useDirtySections(tenant, TENANT_SETTINGS_RECORD);
  return { read: useTenantSettingsRead(tenant), plans, nav: settingsNav(plans, dirty), words };
}
