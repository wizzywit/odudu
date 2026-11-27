import {
  ASSISTANT_HEADING_ID,
  ASSISTANT_NAV_GROUP,
  ASSISTANT_SECTION,
  ASSISTANT_SECTION_ID,
} from '#/pages/settings/services/assistantSection';
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

// The assistant's settings are a section of their own, listed last and only
// while they are on the page: `assistant` is whether they are, and which of
// its edits are unsaved.
export function settingsNav(
  plans: readonly SectionPlan[],
  dirty: ReadonlySet<string>,
  assistant: { shown: boolean; dirty: ReadonlySet<string> } = { shown: false, dirty: new Set() },
): readonly NavGroup[] {
  const groups = SECTION_GROUPS.map((group) => ({
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
  return assistant.shown
    ? [
        ...groups,
        {
          title: ASSISTANT_NAV_GROUP,
          items: [
            {
              id: ASSISTANT_SECTION_ID,
              headingId: ASSISTANT_HEADING_ID,
              title: ASSISTANT_SECTION.title,
              dirty: assistant.dirty.has(ASSISTANT_SECTION_ID),
            },
          ],
        },
      ]
    : groups;
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

// The sections a list observes, as one string that changes only when they do.
export function bandKey(groups: readonly NavGroup[]): string {
  return groups
    .flatMap((group) => group.items.map((item) => `${item.id}=${item.headingId}`))
    .join(' ');
}

export function bandTargets(key: string): { id: string; headingId: string }[] {
  return key === ''
    ? []
    : key.split(' ').map((pair) => {
        const [id = '', headingId = ''] = pair.split('=');
        return { id, headingId };
      });
}

export interface BandChange {
  id: string;
  intersecting: boolean;
}

// The sections in the reading band once these have entered or left it.
export function bandAfter(
  inBand: ReadonlySet<string>,
  changes: readonly BandChange[],
): Set<string> {
  const next = new Set(inBand);
  for (const change of changes) {
    if (change.intersecting) next.add(change.id);
    else next.delete(change.id);
  }
  return next;
}
