import type { GroupRecord } from '#/entities/group';
import type { GroupRoleList } from '#/pages/groups/types/groupRoles';
import { useState } from 'react';
import { useRereadAuthority } from '#/entities/session';
import { useOwnRoles } from '#/features/own-roles';
import { useGroupRolesRecord, useGroupSaves } from '#/pages/groups/repository/useGroupRecord';
import { defaultingOf } from '#/pages/groups/services/groupReach';
import { roleUnavailable, reachOfRoles } from '#/pages/groups/services/groupRoles';
import { type GroupCeiling } from '#/pages/groups/services/groupCeiling';
import { rolesConfirmation } from '#/pages/groups/services/groupConfirmation';
import { lossOf } from '#/pages/groups/services/groupLoss';
import { groupRolesRecord } from '#/pages/groups/services/tabs';
import type { RecordState } from '#/shared/lib/repository/useRecord';
import { type MappedRole, type Role } from '#/entities/role';
import { useRoleMapping, type RoleMappingModel } from '#/features/role-mapping';
import { type Asked, lossAction, lossBlocked } from '#/shared/lib/services/capabilities';
import { removedFrom } from '#/shared/lib/services/ids';
import { ceilingCaller } from '#/shared/lib/services/access';

export function useGroupRolesRead(tenant: string, id: string): RecordState<GroupRoleList> {
  return useGroupRolesRecord(tenant, id);
}

export type { MappedRole };

export interface GroupRoles extends RoleMappingModel {
  asking: Asked | null;
  confirm: () => void;
  cancel: () => void;
}

export function useGroupRoles({
  tenant,
  group,
  data,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  group: GroupRecord;
  data: GroupRoleList;
  etag: string;
  gone: boolean;
  ceiling: GroupCeiling;
}): GroupRoles {
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const saves = useGroupSaves(tenant, group.id);
  const [asking, setAsking] = useState<Asked | null>(null);
  const caller = ceilingCaller(ceiling);
  const mapping = useRoleMapping({
    tenant,
    record: groupRolesRecord(group.id),
    etag,
    gone,
    items: data.items,
    caller,
    offered: ceiling.status === 'ready',
    unavailableOf: (role: Role) => roleUnavailable(role, caller, defaultingOf(group), tenant),
    reachFrom: 'entry',
    saveRoles: async (gateway, input) => {
      const result = await saves.roles(gateway, input);
      if (result.ok) reread();
      return result;
    },
  });
  const save = mapping.save;
  const removed = removedFrom(
    data.items.map((role) => role.id),
    save.values.role_ids,
  );
  const loss = lossOf(
    own,
    caller,
    { kind: 'roles', path: group.path, removed },
    reachOfRoles(data.items, removed),
  );
  return {
    save: {
      ...save,
      blocked: lossBlocked(loss) ?? save.blocked,
      submit: () => {
        const action = lossAction(loss);
        if (action === 'wait') return false;
        if (action === 'run') return save.submit();
        setAsking(rolesConfirmation(group.path, loss));
        return true;
      },
    },
    offered: mapping.offered,
    picker: mapping.picker,
    unavailableOf: mapping.unavailableOf,
    choose: mapping.choose,
    mapped: mapping.mapped,
    kept: mapping.kept,
    asking,
    confirm: () => {
      setAsking(null);
      save.submit();
    },
    cancel: () => {
      setAsking(null);
    },
  };
}
