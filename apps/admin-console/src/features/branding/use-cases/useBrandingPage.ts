import {
  OFFERED_TABS,
  selectOffered,
  showsPreview,
  TENANT_SCOPE,
  type OfferedTab,
} from '#/features/branding/services';
import { useScopeTabReads } from '#/features/branding/use-cases/useScopeTabReads';
import { useMailTab, type MailTab } from '#/features/branding/use-cases/useMailTab';
import {
  useScopeBranding,
  useTenantEdits,
  type ScopeBranding,
} from '#/features/branding/use-cases/useScopeBranding';
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
  useScopeTabReads(tenant, TENANT_SCOPE, tab);
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
