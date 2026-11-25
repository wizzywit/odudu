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

// How the page lists its sections: by what a person comes to change.
export const SECTION_GROUPS: readonly { title: string; ids: readonly string[] }[] = [
  { title: 'Tenant', ids: ['general', 'terms', 'profile'] },
  {
    title: 'Sign-in',
    ids: [
      'usernames',
      'registration',
      'authenticators',
      'passkey-requirement',
      'password',
      'brute-force',
    ],
  },
  { title: 'Sessions and tokens', ids: ['sessions', 'remember-me', 'tokens'] },
  { title: 'Applications', ids: ['client-registration', 'agents'] },
  { title: 'Records', ids: ['retention'] },
];

const DEFINED: readonly SettingsSection[] = [...ACCESS_SECTIONS, ...PLATFORM_SECTIONS];

export const SETTINGS_SECTIONS: readonly SettingsSection[] = SECTION_GROUPS.flatMap((group) =>
  group.ids.flatMap((id) => DEFINED.filter((section) => section.id === id)),
);

// Settings with a home of their own, which this page names rather than repeats.
export const PLACED_ELSEWHERE: Readonly<Record<string, string>> = {
  otp_required: 'Sign-in flow',
  supported_locales: 'Branding, Languages',
  default_locale: 'Branding, Languages',
};

export function sectionHeadingId(id: string): string {
  return `settings-${id}`;
}
