import {
  BRANDING_PAGE_WORDS,
  OFFERED_TABS,
  type OfferedTab,
  type ScopeBranding,
  type TabView,
  selectOffered,
  showsPreview,
  tabViews,
  TENANT_SCOPE,
  useScopeBranding,
  useScopeTabReads,
  useTenantEdits,
} from '#/features/branding-editor';
import { useMailTab, type MailTab } from '#/pages/branding/use-cases/useMailTab';
import { useRecordTab } from '#/shared/repository/useRecordTab';

export interface BrandingPage {
  branding: ScopeBranding;
  tab: OfferedTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<OfferedTab>;
  mail: MailTab;
  // The tabs as listed, each with its dot and mark.
  tabs: TabView[];
  words: typeof BRANDING_PAGE_WORDS;
}

export function useBrandingPage(tenant: string): BrandingPage {
  const { tab, selectTab } = useRecordTab(OFFERED_TABS);
  useScopeTabReads(tenant, TENANT_SCOPE, tab);
  const branding = useScopeBranding(tenant, TENANT_SCOPE, showsPreview(tab));
  const dirty = useTenantEdits(tenant);
  return {
    branding,
    tab,
    selectTab: (next) => {
      selectOffered(next, selectTab);
    },
    dirty,
    tabs: tabViews(dirty, branding.changed),
    words: BRANDING_PAGE_WORDS,
    mail: useMailTab(tenant, branding.view, tab === 'mail'),
  };
}
