import type { ListRoleCompositesResponse, Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/entities/session';
import { useOwnRoles } from '#/features/own-roles';
import {
  useAddComposite,
  useCompositeRemoval,
  useCompositesRecord,
  type AddValues,
} from '#/features/roles/repository/useRoleRecord';
import {
  addRefusal,
  type Child,
  childRows,
  childUnavailable,
  compositesFixed,
} from '#/features/roles/services/blocks';
import {
  type Asked,
  type Ceiling,
  compositesOffered,
  roleSelfLoss,
} from '#/features/roles/services/ceiling';
import { ADD_LABEL, NEST_LABEL } from '#/features/roles/services/labels';
import {
  compositeRemovalConfirmation,
  compositeRemovalFailureText,
  removalAction,
  unnestedText,
} from '#/features/roles/services/removal';
import { compositesRecord } from '#/features/roles/services/tabs';
import type { RecordState } from '#/shared/repository/useRecord';
import { useRolePicker } from '#/shared/repository/useRolePicker';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { useToast } from '#/shared/repository/useToasts';
import { judgedLoss, type Loss } from '#/shared/services/capabilities';
import { describeId } from '#/shared/services/format';
import { roleNameOf } from '#/shared/services/mappedRoles';
import { firstChosen, type PickerState } from '#/shared/services/picker';
import { ceilingCaller } from '#/shared/services/access';
import { indexById } from '#/shared/services/ids';

export function useCompositesRead(
  tenant: string,
  id: string,
): RecordState<ListRoleCompositesResponse> {
  return useCompositesRecord(tenant, id);
}

export type { Asked, Child };

export interface RoleComposites {
  // A capability role keeps what it was provisioned with, as fixed text.
  fixed: string | null;
  children: readonly Child[];
  // Whether what the ceiling needs has been read.
  offered: boolean;
  add: SectionSave<AddValues>;
  picker: PickerState<Role>;
  unavailableOf: (role: Role) => string | null;
  choose: (ids: readonly string[]) => void;
  // The child whose removal is in flight.
  removing: string | null;
  // What the last removal came to, in one line.
  message: string | null;
  // Answers whether the edge went, so focus can follow.
  remove: (child: Role) => Promise<boolean>;
  asking: Asked | null;
  confirm: () => void;
  cancel: () => void;
}

export function useRoleComposites({
  tenant,
  role,
  data,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  role: Role;
  data: ListRoleCompositesResponse;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}): RoleComposites {
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const picker = useRolePicker(tenant);
  const save = useAddComposite(tenant, role.id);
  const removal = useCompositeRemoval(tenant, role.id);
  const toast = useToast();
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ asked: Asked; child: Role } | null>(null);
  const caller = ceilingCaller(ceiling);
  const known = indexById<Role>(data.items, picker.options);
  const add = useSectionSave({
    tenant,
    record: compositesRecord(role.id),
    section: 'add',
    label: ADD_LABEL,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
    explain: addRefusal,
    fields: {
      child_role_id: {
        value: null,
        label: NEST_LABEL,
        kind: 'plain',
        describe: (value) => describeId(value, roleNameOf(known)),
      },
    },
    save,
  });

  const lossOf = (child: Role): Loss =>
    judgedLoss(
      own,
      (access) => roleSelfLoss(access.roles, { kind: 'remove', id: role.id, child: child.id }),
      caller,
      child.admin_reach,
    );

  const run = async (child: Role): Promise<boolean> => {
    setRemoving(child.id);
    setMessage(null);
    const attempt = async (): Promise<boolean> => {
      const result = await removal.remove({ child: child.id, ifMatch: etag });
      if (result.ok) {
        toast.succeeded(unnestedText(child.name, role.name));
        if (removalAction(lossOf(child)) !== 'run') reread();
        return true;
      }
      refusal.report(result, 'manage-tenant');
      setMessage(compositeRemovalFailureText(role.name, child.name, result));
      return false;
    };
    return attempt().finally(() => {
      setRemoving(null);
    });
  };

  return {
    fixed: compositesFixed(role),
    children: childRows(data.items, caller, tenant),
    offered: compositesOffered(ceiling, own),
    add,
    picker,
    unavailableOf: (candidate) => childUnavailable(role, candidate, data.items, caller, tenant),
    choose: (ids) => {
      add.edit('child_role_id', firstChosen(ids));
    },
    removing,
    message,
    remove: (child) => {
      const lost = lossOf(child);
      const action = removalAction(lost);
      if (action === 'wait') return Promise.resolve(false);
      if (action === 'run') return run(child);
      setAsking({ child, asked: compositeRemovalConfirmation(role.name, child.name, lost) });
      return Promise.resolve(false);
    },
    asking: asking?.asked ?? null,
    confirm: () => {
      const child = asking?.child;
      setAsking(null);
      if (child !== undefined) run(child).catch(() => undefined);
    },
    cancel: () => {
      setAsking(null);
    },
  };
}
