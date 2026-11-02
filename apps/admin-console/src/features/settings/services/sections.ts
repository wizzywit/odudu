import { PLATFORM_SECTIONS } from '#/features/settings/services/platformSections';
import { ACCESS_SECTIONS } from '#/features/settings/services/accessSections';
import type { SettingsSection } from '#/features/settings/services/sectionTypes';

export {
  GENERAL_SECTION,
  LOCKOUT_SECTION,
  PASSWORD_SECTION,
} from '#/features/settings/services/accessSections';
export type {
  SettingControl,
  SettingField,
  SettingOption,
  SettingsSection,
} from '#/features/settings/services/sectionTypes';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  ...ACCESS_SECTIONS,
  ...PLATFORM_SECTIONS,
];

// Settings with a home of their own, which this page names rather than repeats.
export const PLACED_ELSEWHERE: Readonly<Record<string, string>> = {
  otp_required: 'Sign-in flow',
  supported_locales: 'Branding, Languages',
  default_locale: 'Branding, Languages',
};

export function sectionHeadingId(id: string): string {
  return `settings-${id}`;
}
