import { PLATFORM_SECTIONS } from '#/pages/settings/services/platformSections';
import { ACCESS_SECTIONS } from '#/pages/settings/services/accessSections';
import type { SettingsSection } from '#/pages/settings/services/sectionTypes';

export {
  GENERAL_SECTION,
  LOCKOUT_SECTION,
  PASSWORD_SECTION,
} from '#/pages/settings/services/accessSections';
export type {
  SettingControl,
  SettingField,
  SettingOption,
  SettingsSection,
} from '#/pages/settings/services/sectionTypes';

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  ...ACCESS_SECTIONS,
  ...PLATFORM_SECTIONS,
];

// Settings with a home of their own, which this page names rather than repeats.
export const PLACED_ELSEWHERE: Readonly<Record<string, string>> = {
  otp_required: 'Sign-in flow',
  supported_locales: 'Branding, Languages',
  default_locale: 'Branding, Languages',
  cimd_enabled: 'The admin API alone, until the console has a client registration control',
};

export function sectionHeadingId(id: string): string {
  return `settings-${id}`;
}
