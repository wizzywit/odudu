import { useState } from 'react';
import {
  BRANDING_FAILED,
  BRANDING_LEAD,
  BRANDING_LOADING,
} from '#/pages/clients/services/branding';
import {
  clientScope,
  selectScopedTab,
  showsPreview,
  useScopeBranding,
  useScopeEdits,
  useScopeTabReads,
  type ScopeBranding,
  type ScopedTab,
} from '#/features/branding-editor';

export interface ClientBranding {
  lead: string;
  loading: string;
  failed: string;
  branding: ScopeBranding;
  tab: ScopedTab;
  selectTab: (tab: string) => void;
  // Tabs of the client's theme with a section holding unsaved edits.
  edited: ReadonlySet<string>;
}

// The client's own theme: the same editors as the tenant's, over its record.
export function useClientBranding(tenant: string, id: string): ClientBranding {
  const [tab, setTab] = useState<ScopedTab>('theme');
  const scope = clientScope(id);
  useScopeTabReads(tenant, scope, tab);
  const branding = useScopeBranding(tenant, scope, showsPreview(tab));
  return {
    lead: BRANDING_LEAD,
    loading: BRANDING_LOADING,
    failed: BRANDING_FAILED,
    branding,
    tab,
    selectTab: (next) => {
      selectScopedTab(next, setTab);
    },
    edited: useScopeEdits(tenant, scope),
  };
}
