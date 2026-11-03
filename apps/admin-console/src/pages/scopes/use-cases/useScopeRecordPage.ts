import type { Scope } from '#/entities/scope';
import { useScopeRecord } from '#/pages/scopes/repository/useScopeRecord';
import { SCOPE_TABS, type ScopeTab, TAB_RECORDS } from '#/pages/scopes/services/tabs';
import type { RecordView } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';

export interface ScopeRecordPage {
  record: RecordView;
  scope: Scope | undefined;
  etag: string | null;
  tab: ScopeTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<ScopeTab>;
}

export function useScopeRecordPage(tenant: string, id: string): ScopeRecordPage {
  const record = useScopeRecord(tenant, id);
  const tabs = useRecordTabs(SCOPE_TABS, TAB_RECORDS, tenant, id);
  return {
    record,
    scope: record.data,
    etag: record.etag,
    ...tabs,
  };
}
