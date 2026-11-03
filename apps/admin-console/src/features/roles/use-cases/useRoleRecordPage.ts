import type { Role } from '@odudu/contracts/admin';
import { useAuthority } from '#/entities/session';
import { useRoleRecord } from '#/features/roles/repository/useRoleRecord';
import { copyHrefOf } from '#/features/roles/services/roleCopy';
import { type RoleCeiling, roleCeiling } from '#/features/roles/services/roleCeiling';
import { ROLE_TABS, type RoleTab, TAB_RECORDS } from '#/features/roles/services/tabs';
import type { RecordView } from '#/shared/services/record';
import { useRecordTabs } from '#/shared/use-cases/useRecordTabs';

export type { RoleCeiling };

export interface RoleRecordPage {
  record: RecordView;
  role: Role | undefined;
  etag: string | null;
  // A copy is a tenant role, so only a tenant role offers one.
  copyHref: string | null;
  tab: RoleTab;
  selectTab: (tab: string) => void;
  dirty: ReadonlySet<RoleTab>;
  ceiling: RoleCeiling;
}

export function useRoleRecordPage(tenant: string, id: string): RoleRecordPage {
  const record = useRoleRecord(tenant, id);
  const authority = useAuthority(tenant);
  const tabs = useRecordTabs(ROLE_TABS, TAB_RECORDS, tenant, id);
  const role = record.data;

  return {
    record,
    role,
    etag: record.etag,
    copyHref: copyHrefOf(tenant, role),
    ...tabs,
    ceiling: roleCeiling(role, authority),
  };
}
