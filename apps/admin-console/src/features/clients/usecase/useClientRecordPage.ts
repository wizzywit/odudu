import type { ClientRecord } from '@odudu/contracts/admin';
import { clientScope, useScopeEdits } from '#/features/branding';
import { useAuthority } from '#/features/session';
import { useClientRecord } from '#/features/clients/repository/useClientRecord';
import {
  brandingOffer,
  canChange,
  CLIENT_TABS,
  chosenTab,
  clientRecord,
  clientReach,
  reachLine,
  serviceRolesRecordOf,
  tabsWithEdits,
  type BrandingOffer,
  type ClientTab,
  type Reach,
} from '#/features/clients/service';
import { useDirtySections } from '#/shared/repository/useDirtySections';
import { useRecordTab } from '#/shared/repository/useRecordTab';
import { lacking } from '#/shared/service/access';
import type { AdminCapability } from '#/shared/service/principal';
import type { RecordView } from '#/shared/service/record';

export interface ClientRecordPage {
  record: RecordView;
  client: ClientRecord | undefined;
  etag: string | null;
  tab: ClientTab;
  selectTab: (tab: string) => void;
  // Tabs with a section holding unsaved edits, for their dots.
  dirty: ReadonlySet<ClientTab>;
  reach: Reach;
  // What a write needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // Whether the Branding tab shows its editor, a refusal or neither yet.
  branding: BrandingOffer;
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
  const brandingEdits = useScopeEdits(tenant, clientScope(id));
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
    dirty: tabsWithEdits(dirty, serviceDirty, brandingEdits),
    reach,
    changeNeeds,
    branding: brandingOffer(authority?.capabilities, changeNeeds),
    writable: canChange(reach, changeNeeds),
    line: reachLine(reach, record.data?.name),
  };
}
