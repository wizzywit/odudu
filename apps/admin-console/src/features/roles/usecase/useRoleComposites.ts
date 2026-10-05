import type { ListRoleCompositesResponse, Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session';
import { useOwnRoles } from '#/features/subjects';
import {
  useAddComposite,
  useCompositeRemoval,
  useCompositesRecord,
  type AddValues,
} from '#/features/roles/repository/useRoleRecord.ts';
import {
  ADD_LABEL,
  addRefusal,
  type Asked,
  type Ceiling,
  childUnavailable,
  compositeRemovalConfirmation,
  compositeRemovalFailureText,
  compositesFixed,
  compositesOffered,
  compositesRecord,
  NEST_LABEL,
  removalAction,
  removalBlock,
  roleSelfLoss,
  unnestedText,
} from '#/features/roles/service';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { judgedLoss, type Loss } from '#/shared/service/capabilities.ts';
import { describeId } from '#/shared/service/format.ts';
import type { PickerState } from '#/shared/service/picker.ts';

export function useCompositesRead(
  tenant: string,
  id: string,
): RecordState<ListRoleCompositesResponse> {
  return useCompositesRecord(tenant, id);
}

export interface Child {
  role: Role;
  // Why it cannot be taken out here, or null when it can.
  held: string | null;
}

export type { Asked };

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
  const push = useToasts((queue) => queue.push);
  const [removing, setRemoving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ asked: Asked; child: Role } | null>(null);
  const caller = ceiling.status === 'ready' ? ceiling.caller : [];
  const known = new Map<string, Role>(
    [...data.items, ...picker.options].map((each) => [each.id, each]),
  );
  const add = useSectionSave({
    tenant,
    record: compositesRecord(role.id),
    section: 'add',
    label: ADD_LABEL,
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-tenant');
    },
    explain: addRefusal,
    fields: {
      child_role_id: {
        value: null,
        label: NEST_LABEL,
        kind: 'plain',
        describe: (value) => describeId(value, (id) => known.get(id)?.name ?? id),
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
    try {
      const result = await removal.remove({ child: child.id, ifMatch: etag });
      if (result.ok) {
        push({ tone: 'success', message: unnestedText(child.name, role.name) });
        if (removalAction(lossOf(child)) !== 'run') reread();
        return true;
      }
      refusal.report(result, 'manage-tenant');
      setMessage(compositeRemovalFailureText(role.name, child.name, result));
      return false;
    } finally {
      setRemoving(null);
    }
  };

  return {
    fixed: compositesFixed(role),
    children: data.items.map((child) => ({
      role: child,
      held: removalBlock(child, caller, tenant),
    })),
    offered: compositesOffered(ceiling, own),
    add,
    picker,
    unavailableOf: (candidate) => childUnavailable(role, candidate, data.items, caller, tenant),
    choose: (ids) => {
      add.edit('child_role_id', ids[0] ?? null);
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
