import { controlViews, editedValue, type ControlView } from '#/features/settings/services/controls';
import type { SettingsSection } from '#/features/settings/services/sections';
import type { SettingValue } from '#/features/settings/services/values';
import type { SettingsSave } from '#/features/settings/use-cases/useSettingsSection';

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
