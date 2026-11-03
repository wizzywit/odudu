import type { Settings } from '@odudu/contracts/admin';
import { passwordNote, type PasswordNote } from '#/pages/settings/services/passwordNote';
import { numberOf } from '#/pages/settings/services/values';
import type { SettingsSave } from '#/pages/settings/use-cases/useSettingsSection';

// What to say beside the minimum length, from the length as it is being
// edited and the second-factor setting as it was saved.
export function usePasswordNote(save: SettingsSave, data: Settings): PasswordNote | null {
  return passwordNote(numberOf(save.values.password_min_length), data.otp_required);
}
