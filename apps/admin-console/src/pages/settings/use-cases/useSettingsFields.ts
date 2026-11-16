import {
  controlGroups,
  controlViews,
  editedValue,
  type ControlGroup,
} from '#/pages/settings/services/controls';
import { SETTINGS_PAGE_WORDS } from '#/pages/settings/services/settingsPageWords';
import type { SettingsSection } from '#/pages/settings/services/sections';
import type { SettingValue } from '#/pages/settings/services/values';
import type { SettingsSave } from '#/pages/settings/use-cases/useSettingsSection';

export function useSettingsFields(
  section: SettingsSection,
  save: SettingsSave,
  fixed: Readonly<Record<string, string>>,
): {
  groups: readonly ControlGroup[];
  moreLabel: string;
  change: (name: string, next: SettingValue) => void;
} {
  return {
    groups: controlGroups(controlViews(section, save, fixed)),
    moreLabel: SETTINGS_PAGE_WORDS.more,
    change: (name, next) => {
      save.edit(name, editedValue(save.values[name], next));
    },
  };
}
