import type { Group, GroupRecord } from '@odudu/contracts/admin';
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
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  groupRecord,
  groupsHref,
  lossOf,
  lossText,
  moveRefusal,
  parentUnavailable,
  type Loss,
} from '#/features/groups/service.ts';
import type { Ceiling } from '#/features/groups/usecase/useGroupRecordPage.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { writeRefusal } from '#/shared/service/capabilities.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';

export type { SectionSave };

// Whether what a write is judged by has been read: until it has, the write
// waits; if it could not be, the page's one line says so.
export type Readiness = 'checking' | 'failed' | 'ready';

export interface Asked {
  title: string;
  consequence: string;
}

export interface Place {
  save: SectionSave<ParentValues>;
  // Why a move is not offered, or null when it is.
  held: string | null;
  state: Readiness;
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
  state: Readiness;
}

export interface Deletion {
  // Why it cannot be deleted, or null when it can; nothing is offered until known.
  held: string | null;
  state: Readiness;
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
  descriptionLimit: number;
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

export function useGroupGeneral({
  tenant,
  group,
  etag,
  gone,
  ceiling,
}: {
  tenant: string;
  group: GroupRecord;
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
  const caller = ready?.caller ?? [];
  const destination = parent.values.parent_id;
  const moveLoss: Loss = lossOf(
    own,
    caller,
    {
      kind: 'move',
      path: group.path,
      to: destination === null ? null : pathOf(destination),
    },
    ready?.parentReach ?? [],
  );
  const deleteLoss: Loss = lossOf(
    own,
    caller,
    { kind: 'delete', path: group.path },
    group.subtree_admin_reach,
  );
  const readiness = (loss: Loss): Readiness =>
    ceiling.status === 'failed'
      ? 'failed'
      : ready === null || loss.kind === 'checking'
        ? 'checking'
        : 'ready';
  const asks = (loss: Loss): boolean => loss.kind === 'certain' || loss.kind === 'possible';

  return {
    description,
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    place: {
      save: {
        ...parent,
        submit: () => {
          if (!asks(moveLoss)) return parent.submit();
          setAsking({
            title: 'Move a group your own access runs through?',
            consequence: `${group.path} would no longer receive what the groups above it hand down.${lossText(moveLoss, 'the groups above it')}`,
          });
          return true;
        },
      },
      held: ready === null ? null : ready.lines.move,
      state: readiness(moveLoss),
      current: parentPath(),
      picker,
      unavailableOf: (candidate) => parentUnavailable(group, candidate, caller),
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
      fixed: defaultBlock(group),
      state: readiness({ kind: 'none' }),
    },
    deletion: {
      held: ready === null ? null : ready.lines.remove,
      state: readiness(deleteLoss),
      confirming: deleting,
      consequence: `Deleting ${group.path} deletes every group beneath it too, with every membership and role mapping of each, so their members lose the roles these groups gave them. It cannot be undone.${lossText(deleteLoss, 'these groups')}`,
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
              if (asks(deleteLoss)) reread();
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
