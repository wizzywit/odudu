import {
  GENERAL_SECTION,
  LOCKOUT_SECTION,
  PASSWORD_SECTION,
  sectionHeadingId,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '#/features/settings/services/sections';
import {
  SETTINGS_PAGE_WORDS,
  type SettingsPageWords,
} from '#/features/settings/services/settingsPageWords';

// What a section needs beside its fields: the general one asks before it
// disables the tenant, the password one carries a hint and the brute-force
// one is followed by the clear of every lockout.
export type SectionKind = 'general' | 'password' | 'lockouts' | 'plain';

export interface SectionPlan {
  section: SettingsSection;
  kind: SectionKind;
  title: string;
  description: string;
  headingId: string;
}

export function sectionKind(id: string): SectionKind {
  switch (id) {
    case GENERAL_SECTION:
      return 'general';
    case PASSWORD_SECTION:
      return 'password';
    case LOCKOUT_SECTION:
      return 'lockouts';
    default:
      return 'plain';
  }
}

export function settingsSections(): { plans: readonly SectionPlan[]; words: SettingsPageWords } {
  return {
    plans: SETTINGS_SECTIONS.map((section) => ({
      section,
      kind: sectionKind(section.id),
      title: section.title,
      description: section.description,
      headingId: sectionHeadingId(section.id),
    })),
    words: SETTINGS_PAGE_WORDS,
  };
}
