import type { Group, GroupRecord } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/features/session';
import { useOwnRoles } from '#/features/subjects';
import { useGo } from '#/features/groups/repository/useGo.ts';
import {
  useGroupDeletion,
  useGroupSaves,
  type DefaultValues,
  type DescriptionValues,
  type ParentValues,
} from '#/features/groups/repository/useGroupRecord.ts';
import {
  type Asked,
  type Ceiling,
  deleteConsequence,
  defaultBlock,
  DEFAULT_LABEL,
  PLACE_LABEL,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  groupReadiness,
  groupRecord,
  groupsHref,
  lossOf,
  moveConfirmation,
  moveRefusal,
  parentPathOf,
  parentUnavailable,
  placeText,
  type Loss,
  type Readiness,
  subtreeDeletedText,
} from '#/features/groups/service.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { asksFirst, writeRefusal } from '#/shared/service/capabilities.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import { flagText } from '#/shared/service/format.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayFailure, GatewayResult } from '#/shared/transport/gateway.ts';

export type { SectionSave };

export type { Asked, Readiness };

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
  const pathOf = (id: unknown): string => parentPathOf(group, id, known);
  const parent = useSectionSave({
    tenant,
    record,
    section: 'place',
    label: PLACE_LABEL,
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
  const parentId = parent.values.parent_id;

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
        label: DEFAULT_LABEL,
        kind: 'plain',
        describe: (value) => flagText(value, 'on', 'off'),
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
  const deleteCopy = {
    name: group.path,
    verb: 'deleted',
    lookAt: 'the groups',
    refused: writeRefusal,
  };

  return {
    description,
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    place: {
      save: {
        ...parent,
        submit: () => {
          if (!asksFirst(moveLoss)) return parent.submit();
          setAsking(moveConfirmation(group.path, moveLoss));
          return true;
        },
      },
      held: ready === null ? null : ready.lines.move,
      state: groupReadiness(ceiling.status, moveLoss),
      current: placeText(parentId === null ? null : pathOf(parentId), 'is'),
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
      state: groupReadiness(ceiling.status, { kind: 'none' }),
    },
    deletion: {
      held: ready === null ? null : ready.lines.remove,
      state: groupReadiness(ceiling.status, deleteLoss),
      confirming: deleting,
      consequence: deleteConsequence(group.path, deleteLoss),
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
              if (asksFirst(deleteLoss)) reread();
              push({ tone: 'success', message: subtreeDeletedText(group.path) });
              go(groupsHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, 'manage-tenant');
            setProblem(writeFailureText(result, deleteCopy));
          })
          .catch(() => {
            setProblem(writeFailureText({ ok: false, kind: 'defect' }, deleteCopy));
          });
      },
    },
  };
}
