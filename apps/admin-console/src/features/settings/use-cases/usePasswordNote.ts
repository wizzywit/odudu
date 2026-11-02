import type { Settings } from '@odudu/contracts/admin';
import { numberOf, passwordNote, type PasswordNote } from '#/features/settings/services';
import type { SettingsSave } from '#/features/settings/use-cases/useSettingsSection';

// What to say beside the minimum length, from the length as it is being
// edited and the second-factor setting as it was saved.
export function usePasswordNote(save: SettingsSave, data: Settings): PasswordNote | null {
  return passwordNote(numberOf(save.values.password_min_length), data.otp_required);
}
