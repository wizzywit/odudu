import type { Client } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session';
import { useClientRecord } from '#/features/clients/repository/useClientRecord.ts';
import {
  canChange,
  CLIENT_TABS,
  chosenTab,
  clientRecord,
  clientReach,
  reachLine,
  serviceRolesRecordOf,
  tabsWithEdits,
  type ClientTab,
  type Reach,
} from '#/features/clients/service';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import { lacking } from '#/shared/service/access.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';

export interface ClientRecordPage {
  record: RecordView;
  client: Client | undefined;
  etag: string | null;
  tab: ClientTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<ClientTab>;
  reach: Reach;
  // What a write needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // Whether any write is offered: the ceiling on the client's service
  // account has been judged from the record and holds nothing back.
  writable: boolean;
  // Why none is, in one line, once that is known.
  line: string | null;
}

export function useClientRecordPage(tenant: string, id: string): ClientRecordPage {
  const record = useClientRecord(tenant, id);
  const authority = useAuthority(tenant);
  const { tab, selectTab } = useRecordTab(CLIENT_TABS);
  const dirty = useDirtySections(tenant, clientRecord(id));
  const serviceDirty = useDirtySections(tenant, serviceRolesRecordOf(record.data));
  const reach = clientReach(record.data, authority?.capabilities);
  const changeNeeds = lacking(authority, ['manage-clients']);
  return {
    record,
    client: record.data,
    etag: record.etag,
    tab,
    selectTab: (next) => {
      const chosen = chosenTab(next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty: tabsWithEdits(dirty, serviceDirty),
    reach,
    changeNeeds,
    writable: canChange(reach, changeNeeds),
    line: reachLine(reach, record.data?.name),
  };
}
