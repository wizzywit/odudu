import {
  controlGroups,
  controlViews,
  editedValue,
  type ControlGroup,
} from '#/pages/settings/services/controls';
import type { SettingsSection } from '#/pages/settings/services/sections';
import type { SettingValue } from '#/pages/settings/services/values';
import type { SettingsSave } from '#/pages/settings/use-cases/useSettingsSection';

export function useSettingsFields(
  section: SettingsSection,
  save: SettingsSave,
  fixed: Readonly<Record<string, string>>,
): { groups: readonly ControlGroup[]; change: (name: string, next: SettingValue) => void } {
  return {
    groups: controlGroups(controlViews(section, save, fixed)),
    change: (name, next) => {
      save.edit(name, editedValue(save.values[name], next));
    },
  };
}
