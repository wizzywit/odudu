import type { Role } from '@odudu/contracts/admin';
import { useAuthority } from '#/features/session/index.ts';
import { useRoleRecord } from '#/features/roles/repository/useRoleRecord.ts';
import {
  compositesRecord,
  copyHref,
  deleteBlock,
  isBuiltin,
  ROLE_TABS,
  roleRecord,
  type RoleTab,
} from '#/features/roles/service.ts';
import { useDirtySections } from '#/shared/repository/useDirtySections.ts';
import { useRecordTab } from '#/shared/repository/useRecordTab.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { RecordView } from '#/shared/service/record.ts';

// What the role reaches, which its record carries, and the caller's own
// capabilities: every ceiling on its writes is judged by both, so nothing is
// offered until whoami has answered.
export type Ceiling =
  | { status: 'checking' }
  | {
      status: 'ready';
      caller: readonly AdminCapability[];
      // Why it cannot be deleted, by the ceiling, or null.
      deleteHeld: string | null;
    };

export interface RoleRecordPage {
  record: RecordView;
  role: Role | undefined;
  etag: string | null;
  // A copy is a tenant role, so only a tenant role offers one.
  copyHref: string | null;
  tab: RoleTab;
  selectTab: (tab: string) => void;
  dirty: ReadonlySet<RoleTab>;
  ceiling: Ceiling;
}

export function useRoleRecordPage(tenant: string, id: string): RoleRecordPage {
  const record = useRoleRecord(tenant, id);
  const authority = useAuthority(tenant);
  const { tab, selectTab } = useRecordTab(ROLE_TABS);
  const general = useDirtySections(tenant, roleRecord(id));
  const nested = useDirtySections(tenant, compositesRecord(id));
  const role = record.data;
  let ceiling: Ceiling = { status: 'checking' };
  if (authority !== undefined && role !== undefined) {
    ceiling = {
      status: 'ready',
      caller: authority.capabilities,
      deleteHeld: isBuiltin(role) ? null : deleteBlock(role, authority.capabilities),
    };
  }
  return {
    record,
    role,
    etag: record.etag,
    copyHref: role?.client_id === null ? copyHref(tenant, id) : null,
    tab,
    selectTab: (next) => {
      const chosen = ROLE_TABS.find((candidate) => candidate === next);
      if (chosen !== undefined) selectTab(chosen);
    },
    dirty: new Set<RoleTab>([
      ...(general.size > 0 ? (['general'] as const) : []),
      ...(nested.size > 0 ? (['composites'] as const) : []),
    ]),
    ceiling,
  };
}
