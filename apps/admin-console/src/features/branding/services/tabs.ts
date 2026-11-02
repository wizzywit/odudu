import { recordTabs, tabNamed } from '#/shared/services/record';

// Every tab of the Branding area, in the order they join it.
const TABS = ['theme', 'pages', 'mail', 'languages'] as const;

export type BrandingTab = (typeof TABS)[number];

// The sections each tab saves, which carry its unsaved-changes dot.
export const BRANDING_TAB_SECTIONS: Readonly<Record<BrandingTab, readonly string[]>> = {
  theme: ['colours', 'images', 'stylesheet'],
  pages: ['templates'],
  mail: [],
  languages: ['languages'],
};

const model = recordTabs({
  tabs: TABS,
  labels: { theme: 'Theme', pages: 'Pages', mail: 'Mail', languages: 'Languages' },
  sections: BRANDING_TAB_SECTIONS,
});

export const BRANDING_TABS = model.tabs;
export const BRANDING_TAB_LABELS = model.labels;

// The tabs the area shows, each with a view.
export const OFFERED_TABS = BRANDING_TABS;

export type OfferedTab = (typeof OFFERED_TABS)[number];

// The record each tab's sections are saved to: the theme's, or the tenant's
// settings, which the languages go to.
export type TabRecord = 'theme' | 'settings';

const TAB_RECORD: Readonly<Record<BrandingTab, TabRecord>> = {
  theme: 'theme',
  pages: 'theme',
  mail: 'theme',
  languages: 'settings',
};

// Takes the dirty sections of each record the tabs save to, kept apart: a
// section of one record is not a section of another that happens to share its name.
export function tabsWithEdits(
  dirty: Readonly<Partial<Record<TabRecord, ReadonlySet<string>>>>,
): ReadonlySet<OfferedTab> {
  return model.edited((tab) => model.holds(tab, dirty[TAB_RECORD[tab]]));
}

// The tabs that frame a preview of a page.
export function showsPreview(tab: BrandingTab): boolean {
  return tab === 'theme' || tab === 'pages';
}

// A client's Branding holds the two tabs that are about the client's own
// pages; mail and languages belong to the tenant.
export const SCOPED_TABS = ['theme', 'pages'] as const;

export type ScopedTab = (typeof SCOPED_TABS)[number];

// What a revert from the bar takes back on the tab being shown: that tab's
// parts where it has any. On a tab with none the theme's stand in, because a
// revert is a hook that runs on every tab, and the bar does not offer it.
export function revertTarget(name: string): { tab: ScopedTab; offered: boolean } {
  const tab = tabNamed(SCOPED_TABS, name);
  return { tab: tab ?? 'theme', offered: tab !== undefined };
}

// Runs `select` for a tab a scope has, and for no other name.
export function selectScopedTab(name: string, select: (tab: ScopedTab) => void): void {
  const tab = tabNamed(SCOPED_TABS, name);
  if (tab !== undefined) select(tab);
}

// The reads a tab shows that do not wait for the theme: started with the
// page's own, so that each is under way while the theme is still arriving.
export interface TabReads {
  settings: boolean;
  catalogue: boolean;
  hooks: boolean;
  versions: boolean;
}

const NO_READS: TabReads = { settings: false, catalogue: false, hooks: false, versions: false };

const TAB_READS: Readonly<Record<BrandingTab, TabReads>> = {
  theme: { ...NO_READS, hooks: true, versions: true },
  pages: { ...NO_READS, catalogue: true },
  mail: NO_READS,
  languages: { ...NO_READS, settings: true, catalogue: true },
};

export function tabReads(tab: BrandingTab): TabReads {
  return TAB_READS[tab];
}
