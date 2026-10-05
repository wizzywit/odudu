import type { Group } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session/index.ts';
import { useOwnRoles } from '#/features/subjects/index.ts';
import { useGo } from '#/features/groups/repository/useGo.ts';
import {
  useGroupDeletion,
  useGroupSaves,
  type DefaultValues,
  type DescriptionValues,
  type ParentValues,
} from '#/features/groups/repository/useGroupRecord.ts';
import {
  defaultBlock,
  DESCRIPTION_RULE,
  groupRecord,
  groupsHref,
  moveRefusal,
  moveUnavailable,
  selfLoss,
  type Change,
} from '#/features/groups/service.ts';
import type { Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { writeRefusal } from '#/shared/service/capabilities.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';

export type { SectionSave };

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export interface Asked {
  title: string;
  consequence: string;
}

export interface Place {
  save: SectionSave<ParentValues>;
  // Why a move is not offered, or null when it is.
  held: string | null;
  // What the move would take is still being read.
  checking: boolean;
  // Where the group sits as the section holds it.
  current: string;
  picker: PickerState<Group>;
  unavailableOf: (candidate: Group) => string | null;
  choose: (ids: readonly string[]) => void;
  // Asked before a move takes capabilities from yourself.
  asking: Asked | null;
  confirm: () => void;
  cancel: () => void;
}

export interface Defaults {
  save: SectionSave<DefaultValues>;
  // Why it cannot be made a default, said in place of the toggle.
  fixed: string | null;
  // Whatever it hands out is still being read, so nothing is offered yet.
  checking: boolean;
}

export interface Deletion {
  // Why it cannot be deleted, or null when it can; nothing is offered until known.
  held: string | null;
  checking: boolean;
  confirming: boolean;
  consequence: string;
  busy: boolean;
  problem: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export interface GroupGeneral {
  description: SectionSave<DescriptionValues>;
  descriptionRule: string;
  place: Place;
  defaults: Defaults;
  deletion: Deletion;
}

function failureText(path: string, result: GatewayFailure): string {
  switch (result.kind) {
    case 'network':
      return `Could not confirm whether ${path} was deleted. It has not been sent again; look at the groups before trying again.`;
    case 'schema':
      return `${path} may have been deleted, but the answer could not be read. Reload to check.`;
    case 'defect':
      return `The console could not finish, so ${path} was not deleted. This is a fault in the console, not something you did.`;
    case 'problem':
      return (
        writeRefusal(result.problem) ??
        `${path} was not deleted: ${result.problem.detail ?? result.problem.title}`
      );
  }
}

function lossText(lost: readonly string[]): string {
  return lost.length === 0
    ? ''
    : ` You hold ${AND.format(lost)} through these groups, so you may lose it with them, and this console with it, unless you hold it some other way.`;
}

export function useGroupGeneral({
  tenant,
  group,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  group: Group;
  etag: string;
  gone: boolean;
  ceiling: Ceiling;
}): GroupGeneral {
  const refusal = useRefusal(tenant);
  const reread = useRereadAuthority(tenant);
  const own = useOwnRoles(tenant);
  const saves = useGroupSaves(tenant, group.id);
  const deletion = useGroupDeletion(tenant, group.id);
  const picker = useGroupPicker(tenant);
  const push = useToasts((queue) => queue.push);
  const go = useGo();
  const [asking, setAsking] = useState<Asked | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const record = groupRecord(group.id);
  const lost = (change: Change): string[] =>
    own.status === 'ready' ? selfLoss(own.roles, change) : [];
  const onRefused = (failure: GatewayFailure): void => {
    refusal.report(failure, 'manage-tenant');
  };
  // A write that may take something from yourself is followed by whoami.
  const reading = <R>(result: GatewayResult<R>): GatewayResult<R> => {
    if (result.ok) reread();
    return result;
  };

  const description = useSectionSave({
    tenant,
    record,
    section: 'description',
    label: 'Description',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused,
    explain: writeRefusal,
    fields: {
      description: { value: group.description ?? '', label: 'Description', kind: 'plain' },
    },
    save: saves.description,
  });

  const known = new Map<string, Group>(picker.options.map((each) => [each.id, each]));
  // A path is its parent's with the name appended, so the parent read with
  // the group needs no read of its own.
  const readParent = group.path.slice(0, group.path.lastIndexOf('/'));
  const pathOf = (id: unknown): string => {
    if (typeof id !== 'string') return 'the top level';
    return known.get(id)?.path ?? (id === group.parent_id ? readParent : id);
  };
  const parent = useSectionSave({
    tenant,
    record,
    section: 'place',
    label: 'Place in the tree',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused,
    explain: moveRefusal,
    fields: {
      parent_id: {
        value: group.parent_id,
        label: 'Parent',
        kind: 'plain',
        describe: pathOf,
      },
    },
    save: async (gateway, input) => reading(await saves.parent(gateway, input)),
  });
  const parentPath = (): string => {
    const id = parent.values.parent_id;
    return id === null ? 'At the top level.' : `Under ${pathOf(id)}.`;
  };

  const defaults = useSectionSave({
    tenant,
    record,
    section: 'default',
    label: 'New subjects',
    etag,
    capability: 'manage-tenant',
    gone,
    onRefused,
    explain: writeRefusal,
    fields: {
      default_for_new_subjects: {
        value: group.default_for_new_subjects,
        label: 'Joined by every new subject',
        kind: 'plain',
        describe: (value) => (value === true ? 'on' : 'off'),
      },
    },
    save: saves.default,
  });

  const ready = ceiling.status === 'ready' ? ceiling : null;
  const moveLoss = lost({ kind: 'move', path: group.path });
  const deleteLoss = lost({ kind: 'delete', path: group.path });

  return {
    description,
    descriptionRule: DESCRIPTION_RULE,
    place: {
      save: {
        ...parent,
        submit: () => {
          if (moveLoss.length === 0) return parent.submit();
          setAsking({
            title: 'Move a group your own access runs through?',
            consequence: `${group.path} would no longer receive what the groups above it hand down.${lossText(moveLoss)}`,
          });
          return true;
        },
      },
      held: ready === null ? 'Checking what the groups above it hand down…' : ready.lines.move,
      checking: ready === null,
      current: parentPath(),
      picker,
      unavailableOf: (candidate) => moveUnavailable(group, candidate),
      choose: (ids) => {
        parent.edit('parent_id', ids[0] ?? null);
      },
      asking,
      confirm: () => {
        setAsking(null);
        parent.submit();
      },
      cancel: () => {
        setAsking(null);
      },
    },
    defaults: {
      save: defaults,
      fixed: ready === null ? null : defaultBlock(ready.reach, group.default_for_new_subjects),
      checking: ready === null,
    },
    deletion: {
      held: ready === null ? null : ready.lines.remove,
      checking: ready === null,
      confirming: deleting,
      consequence: `Deleting ${group.path} deletes every group beneath it too, with every membership and role mapping of each, so their members lose the roles these groups gave them. It cannot be undone.${lossText(deleteLoss)}`,
      busy: deletion.busy,
      problem,
      ask: () => {
        setProblem(null);
        setDeleting(true);
      },
      cancel: () => {
        setProblem(null);
        setDeleting(false);
      },
      confirm: () => {
        if (deletion.busy) return;
        setProblem(null);
        deletion
          .run()
          .then((result) => {
            if (result.ok) {
              setDeleting(false);
              if (deleteLoss.length > 0) reread();
              push({
                tone: 'success',
                message: `${group.path} and every group beneath it were deleted.`,
              });
              go(groupsHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, 'manage-tenant');
            setProblem(failureText(group.path, result));
          })
          .catch(() => {
            setProblem(failureText(group.path, { ok: false, kind: 'defect' }));
          });
      },
    },
  };
}
