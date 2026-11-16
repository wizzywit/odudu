import {
  GENERAL_SECTION,
  LOCKOUT_SECTION,
  PASSWORD_SECTION,
  SECTION_GROUPS,
  sectionHeadingId,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from '#/pages/settings/services/sections';
import {
  SETTINGS_PAGE_WORDS,
  type SettingsPageWords,
} from '#/pages/settings/services/settingsPageWords';

// What a section needs beside its fields: the general one asks before it
// disables the tenant, the password one carries a hint and the brute-force
// one is followed by the clear of every lockout.
type SectionKind = 'general' | 'password' | 'lockouts' | 'plain';

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

export interface NavItem {
  id: string;
  headingId: string;
  title: string;
  // Unsaved edits in its section, which a person scrolled elsewhere cannot see.
  dirty: boolean;
}

export interface NavGroup {
  title: string;
  items: readonly NavItem[];
}

export function settingsNav(
  plans: readonly SectionPlan[],
  dirty: ReadonlySet<string>,
): readonly NavGroup[] {
  return SECTION_GROUPS.map((group) => ({
    title: group.title,
    items: group.ids.flatMap((id) =>
      plans
        .filter((plan) => plan.section.id === id)
        .map((plan) => ({
          id,
          headingId: plan.headingId,
          title: plan.title,
          dirty: dirty.has(id),
        })),
    ),
  }));
}

// The first of the sections, in page order, that is in the reading band; the
// last one stays current while none is, as between two short sections.
export function currentSection(
  order: readonly string[],
  inBand: ReadonlySet<string>,
  last: string | null,
): string | null {
  return order.find((id) => inBand.has(id)) ?? last;
}
