import type { Group, GroupRecord } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal, useRereadAuthority } from '#/entities/session';
import { useOwnRoles } from '#/features/subjects';
import { useGo } from '#/shared/repository/useGo';
import {
  useGroupDeletion,
  useGroupSaves,
  type ParentValues,
} from '#/features/groups/repository/useGroupRecord';
import { type Asked, groupsHref, type Loss } from '#/features/groups/services/address';
import { defaultBlock, moveRefusal, parentUnavailable } from '#/features/groups/services/blocks';
import {
  type Ceiling,
  ceilingLines,
  ceilingParentReach,
  parentPlace,
  groupReadiness,
  parentPathOf,
  placeText,
} from '#/features/groups/services/ceiling';
import {
  deleteConsequence,
  moveConfirmation,
  subtreeDeletedText,
} from '#/features/groups/services/confirm';
import { DEFAULT_LABEL, PLACE_LABEL } from '#/features/groups/services/labels';
import { lossOf, type Readiness } from '#/features/groups/services/loss';
import { groupRecord } from '#/features/groups/services/tabs';
import { useGroupPicker } from '#/shared/repository/useGroupPicker';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { useToast } from '#/shared/repository/useToasts';
import { useConfirmedRemoval, type Removal } from '#/shared/use-cases/useConfirmedChange';
import { asksFirst, writeRefusal } from '#/shared/services/capabilities';
import { writeFailureText } from '#/shared/services/failure';
import { firstChosen, type PickerState } from '#/shared/services/picker';
import type { GatewayResult } from '#/shared/transport/gateway';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/services/labels';
import type { DefaultValues, DescriptionValues } from '#/shared/services/sectionValues';
import { orBlank } from '#/shared/services/format';
import { ceilingCaller } from '#/shared/services/access';
import { indexById } from '#/shared/services/ids';

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

export interface Deletion extends Removal {
  // Why it cannot be deleted, or null when it can; nothing is offered until known.
  held: string | null;
  state: Readiness;
  consequence: string;
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
  const toast = useToast();
  const go = useGo();
  const [asking, setAsking] = useState<Asked | null>(null);
  const record = groupRecord(group.id);
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
    refusal,
    explain: writeRefusal,
    fields: {
      description: { value: orBlank(group.description), label: 'Description', kind: 'plain' },
    },
    save: saves.description,
  });

  const known = indexById<Group>(picker.options);
  const pathOf = (id: unknown): string => parentPathOf(group, id, known);
  const parent = useSectionSave({
    tenant,
    record,
    section: 'place',
    label: PLACE_LABEL,
    etag,
    capability: 'manage-tenant',
    gone,
    refusal,
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
    refusal,
    explain: writeRefusal,
    fields: {
      default_for_new_subjects: {
        value: group.default_for_new_subjects,
        label: DEFAULT_LABEL,
        kind: 'plain',
      },
    },
    save: saves.default,
  });

  const caller = ceilingCaller(ceiling);
  const lines = ceilingLines(ceiling);
  const destination = parentPlace(group, parentId, known);
  const moveLoss: Loss = lossOf(
    own,
    caller,
    { kind: 'move', path: group.path, to: destination },
    ceilingParentReach(ceiling),
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
  const removal = useConfirmedRemoval({
    refusal,
    capability: 'manage-tenant',
    change: deletion,
    failureText: (failure) => writeFailureText(failure, deleteCopy),
    done: () => {
      if (asksFirst(deleteLoss)) reread();
      toast.succeeded(subtreeDeletedText(group.path));
      go(groupsHref(tenant), { replace: true });
    },
  });

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
      held: lines.move,
      state: groupReadiness(ceiling.status, moveLoss),
      current: placeText(destination, 'is'),
      picker,
      unavailableOf: (candidate) => parentUnavailable(group, candidate, caller),
      choose: (ids) => {
        parent.edit('parent_id', firstChosen(ids));
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
      ...removal,
      held: lines.remove,
      state: groupReadiness(ceiling.status, deleteLoss),
      consequence: deleteConsequence(group.path, deleteLoss),
    },
  };
}
