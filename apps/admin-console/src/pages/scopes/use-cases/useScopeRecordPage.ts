import { newScopeHref, type Scope } from '#/entities/scope';
import { useScopeRecord } from '#/pages/scopes/repository/useScopeRecord';
import { scopeCopyHref } from '#/pages/scopes/services/scopeCopy';
import { SCOPE_TITLE } from '#/pages/scopes/services/scopeDetails';
import {
  SCOPE_TAB_LABELS,
  SCOPE_TABS,
  type ScopeTab,
  TAB_RECORDS,
} from '#/pages/scopes/services/tabs';
import { type RecordView, tabEntries, type TabEntry } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';

export interface ScopeRecordPage {
  record: RecordView;
  scope: Scope | undefined;
  etag: string | null;
  tab: ScopeTab;
  selectTab: (tab: string) => void;
  title: string;
  // The address of the page that makes a copy of the scope, once it is read.
  copyHref: string | null;
  // The tabs in order, each with whether a section holds unsaved edits.
  tabList: readonly TabEntry<ScopeTab>[];
}

export function useScopeRecordPage(tenant: string, id: string): ScopeRecordPage {
  const record = useScopeRecord(tenant, id);
  const tabs = useRecordTabs(SCOPE_TABS, TAB_RECORDS, tenant, id);
  return {
    record,
    scope: record.data,
    etag: record.etag,
    tab: tabs.tab,
    selectTab: tabs.selectTab,
    title: record.data?.name ?? SCOPE_TITLE,
    copyHref: scopeCopyHref(newScopeHref(tenant), record.data),
    tabList: tabEntries(SCOPE_TABS, SCOPE_TAB_LABELS, tabs.dirty),
  };
}
