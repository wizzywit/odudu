import { controlViews, editedValue, type ControlView } from '#/pages/settings/services/controls';
import type { SettingsSection } from '#/pages/settings/services/sections';
import type { SettingValue } from '#/pages/settings/services/values';
import type { SettingsSave } from '#/pages/settings/use-cases/useSettingsSection';

export function useSettingsFields(
  section: SettingsSection,
  save: SettingsSave,
  fixed: Readonly<Record<string, string>>,
): { controls: readonly ControlView[]; change: (name: string, next: SettingValue) => void } {
  return {
    controls: controlViews(section, save, fixed),
    change: (name, next) => {
      save.edit(name, editedValue(save.values[name], next));
    },
  };
}
