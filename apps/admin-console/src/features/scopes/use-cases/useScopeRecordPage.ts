import type { ClientScope } from '@odudu/contracts/admin';
import { useScopeRecord } from '#/features/scopes/repository/useScopeRecord';
import { SCOPE_TABS, type ScopeTab, TAB_RECORDS } from '#/features/scopes/services';
import type { RecordView } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';

export interface ScopeRecordPage {
  record: RecordView;
  scope: ClientScope | undefined;
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
