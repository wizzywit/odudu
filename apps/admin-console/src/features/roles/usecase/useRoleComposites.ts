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
  childUnavailable,
  compositeRefusal,
  compositesRecord,
  isBuiltin,
  removalBlock,
  roleSelfLoss,
} from '#/features/roles/service.ts';
import type { Ceiling } from '#/features/roles/usecase/useRoleRecordPage.ts';
import type { RecordState } from '#/shared/repository/useRecord.ts';
import { useRolePicker } from '#/shared/repository/useRolePicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { judgedLoss, lossText, type Loss } from '#/shared/service/capabilities.ts';
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

export interface Asked {
  title: string;
  consequence: string;
}

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
    label: 'Add a composite',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused: (failure) => {
      refusal.report(failure, 'manage-tenant');
    },
    explain: (problem) => compositeRefusal('the role chosen', problem),
    fields: {
      child_role_id: {
        value: null,
        label: 'Role to nest',
        kind: 'plain',
        describe: (value) =>
          typeof value === 'string' ? (known.get(value)?.name ?? value) : 'none',
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
        push({ tone: 'success', message: `${child.name} is no longer nested in ${role.name}.` });
        if (lossOf(child).kind !== 'none') reread();
        return true;
      }
      refusal.report(result, 'manage-tenant');
      if (result.kind === 'problem' && result.problem.status === 412) {
        setMessage(
          `${role.name}'s composites changed since you opened them, so ${child.name} was not taken out. They have been read again; look before trying again.`,
        );
      } else if (result.kind === 'problem') {
        setMessage(
          compositeRefusal(child.name, result.problem) ??
            `${child.name} was not taken out: ${result.problem.detail ?? result.problem.title}`,
        );
      } else {
        setMessage(
          `Could not confirm whether ${child.name} was taken out. Look at the list before trying again.`,
        );
      }
      return false;
    } finally {
      setRemoving(null);
    }
  };

  return {
    fixed: isBuiltin(role)
      ? `${role.name} is a capability of the built-in admin client: it keeps the roles it was provisioned with, and nothing is nested in it or taken out of it here.`
      : null,
    children: data.items.map((child) => ({
      role: child,
      held: removalBlock(child, caller, tenant),
    })),
    // Each removal asks first where it takes from yourself, so none is
    // offered while that is still being read.
    offered: ceiling.status === 'ready' && own.status !== 'loading',
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
      if (lost.kind === 'none') return run(child);
      setAsking({
        child,
        asked: {
          title: 'Take out a role your own access runs through?',
          consequence: `Whoever holds ${role.name} no longer holds ${child.name} through it.${lossText(lost, `${child.name} nested in ${role.name}`)}`,
        },
      });
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
