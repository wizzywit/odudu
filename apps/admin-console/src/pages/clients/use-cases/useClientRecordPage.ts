import type { ClientRecord } from '#/pages/clients/types/clientRecord';
import { clientScope, useScopeEdits } from '#/features/branding-editor';
import { useAuthority } from '#/entities/session';
import { useClientRecord } from '#/pages/clients/repository/useClientRecord';
import { serviceRolesRecordOf } from '#/pages/clients/services/serviceAccess';
import {
  BRANDING_HELD,
  brandingOffer,
  type BrandingOffer,
} from '#/pages/clients/services/branding';
import {
  canChange,
  clientReach,
  reachLine,
  type ServiceAccountReach,
} from '#/pages/clients/services/ceiling';
import { ACTIVITY_NOTE, CLIENT_TITLE } from '#/pages/clients/services/clientDetails';
import {
  CLIENT_TAB_LABELS,
  CLIENT_TABS,
  chosenTab,
  clientRecord,
  tabsWithEdits,
  type ClientTab,
} from '#/pages/clients/services/tabs';
import { useDirtySections } from '#/shared/repository/useDirtySections';
import { useRecordTab } from '#/shared/repository/useRecordTab';
import { lacking } from '#/shared/services/access';
import { andList } from '#/shared/services/format';
import type { AdminCapability } from '#/shared/services/principal';
import { type RecordView, tabEntries, type TabEntry } from '#/shared/services/record';

export interface ClientRecordPage {
  record: RecordView;
  client: ClientRecord | undefined;
  etag: string | null;
  tab: ClientTab;
  selectTab: (tab: string) => void;
  // The tabs in order, each with whether a section holds unsaved edits.
  tabList: readonly TabEntry<ClientTab>[];
  title: string;
  // What the Activity tab says before its list.
  activityNote: string;
  reach: ServiceAccountReach;
  // What a write needs that whoami says is missing.
  changeNeeds: readonly AdminCapability[];
  // Whether the Branding tab shows its editor, a refusal or neither yet.
  branding: BrandingOffer;
  // What the Branding tab says while it is held back, and for what.
  brandingHeld: { lead: string; needs: string };
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
    tabList: tabEntries(
      CLIENT_TABS,
      CLIENT_TAB_LABELS,
      tabsWithEdits(dirty, serviceDirty, brandingEdits),
    ),
    title: record.data?.name ?? CLIENT_TITLE,
    activityNote: ACTIVITY_NOTE,
    reach,
    changeNeeds,
    branding: brandingOffer(authority?.capabilities, changeNeeds),
    brandingHeld: { lead: BRANDING_HELD, needs: andList(changeNeeds) },
    writable: canChange(reach, changeNeeds),
    line: reachLine(reach, record.data?.name),
  };
}
