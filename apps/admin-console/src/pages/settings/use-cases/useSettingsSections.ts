import type { Settings } from '#/entities/tenant';
import { TENANT_SETTINGS_RECORD, useTenantSettingsRead } from '#/entities/tenant';
import { ASSISTANT_RECORD } from '#/pages/settings/services/assistantSection';
import { assistantShown } from '#/pages/settings/services/assistantPresence';
import {
  settingsNav,
  settingsSections,
  type NavGroup,
  type SectionPlan,
} from '#/pages/settings/services/sectionPlan';
import type { SettingsPageWords } from '#/pages/settings/services/settingsPageWords';
import {
  useAssistantAvailability,
  type AssistantAvailability,
} from '#/pages/settings/use-cases/useAssistantSection';
import { useDirtySections } from '#/shared/lib/repository/useDirtySections';
import type { RecordState } from '#/shared/lib/repository/useRecord';

export function useSettingsSections(tenant: string): {
  read: RecordState<Settings>;
  plans: readonly SectionPlan[];
  nav: readonly NavGroup[];
  words: SettingsPageWords;
  assistant: AssistantAvailability;
} {
  const { plans, words } = settingsSections();
  const dirty = useDirtySections(tenant, TENANT_SETTINGS_RECORD);
  const assistantDirty = useDirtySections(tenant, ASSISTANT_RECORD);
  const assistant = useAssistantAvailability(tenant);
  return {
    read: useTenantSettingsRead(tenant),
    plans,
    nav: settingsNav(plans, dirty, {
      shown: assistantShown(assistant.presence),
      dirty: assistantDirty,
    }),
    words,
    assistant,
  };
}
