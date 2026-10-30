import {
  OFFERED_TABS,
  selectOffered,
  showsPreview,
  tabReads,
  TENANT_SCOPE,
  type OfferedTab,
} from '#/features/branding/service';
import { useTabReads } from '#/features/branding/repository/useTabReads';
import { useMailTab, type MailTab } from '#/features/branding/usecase/useMailTab';
import {
  useScopeBranding,
  useTenantEdits,
  type ScopeBranding,
} from '#/features/branding/usecase/useScopeBranding';
import { useRecordTab } from '#/shared/repository/useRecordTab';

export interface BrandingPage {
  branding: ScopeBranding;
  tab: OfferedTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<OfferedTab>;
  mail: MailTab;
}

export function useBrandingPage(tenant: string): BrandingPage {
  const { tab, selectTab } = useRecordTab(OFFERED_TABS);
  useTabReads(tenant, TENANT_SCOPE, tabReads(tab));
  const branding = useScopeBranding(tenant, TENANT_SCOPE, showsPreview(tab));
  return {
    branding,
    tab,
    selectTab: (next) => {
      selectOffered(next, selectTab);
    },
    dirty: useTenantEdits(tenant),
    mail: useMailTab(tenant, branding.view, tab === 'mail'),
  };
}
