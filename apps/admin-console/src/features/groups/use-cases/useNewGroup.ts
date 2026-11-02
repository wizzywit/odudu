import type { Group } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useCreateGroup } from '#/features/groups/repository/useCreateGroup';
import { useGo } from '#/shared/repository/useGo';
import { useGroupNamed } from '#/features/groups/repository/useGroupRecord';
import {
  createBlocked,
  createHeld,
  groupHref,
  groupsHref,
  parentUnavailable,
  NAME_TAKEN,
  newGroupPlace,
} from '#/features/groups/services';
import { useGroupPicker } from '#/shared/repository/useGroupPicker';
import { useToast } from '#/shared/repository/useToasts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import { problemAt, requiredProblem } from '#/shared/services/fieldErrors';
import { createdText, lookupText } from '#/shared/services/failure';
import { firstChosen, type PickerState } from '#/shared/services/picker';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/services/labels';
import { useCreationFlow } from '#/shared/use-cases/useCreationFlow';
import { loadedData } from '#/shared/services/read';

type Field = 'name' | 'description' | 'parent_id';
type Errors = Partial<Record<Field, string>>;

export interface NewGroup {
  listHref: string;
  descriptionRule: string;
  descriptionLimit: number;
  name: string;
  description: string;
  parentId: string | null;
  // Where it will sit, said in a sentence; null until the parent is read.
  place: string | null;
  picker: PickerState<Group>;
  errors: Errors;
  message: string | null;
  // The POST's answer was lost: offer to look for the group rather than send it again.
  unconfirmed: boolean;
  busy: boolean;
  editName: (name: string) => void;
  editDescription: (description: string) => void;
  chooseParent: (ids: readonly string[]) => void;
  // Why a parent cannot hold a group made by this caller.
  unavailableOf: (candidate: Group) => string | null;
  // Why Create is held: the parent chosen is beyond the caller, or what it
  // hands out is still being read.
  held: string | null;
  submit: () => void;
  check: () => void;
}

export function useNewGroup(tenant: string): NewGroup {
  const refusal = useRefusal(tenant);
  const creation = useCreateGroup(tenant);
  const go = useGo();
  const toast = useToast();
  const { params } = useUrlSearch();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string | null>(params.get('parent'));
  const flow = useCreationFlow<Field>(refusal);
  const picker = useGroupPicker(tenant);
  const asked = useGroupNamed(tenant, parentId);
  const parent = picker.options.find((group) => group.id === parentId) ?? loadedData(asked);
  const caller = useAuthority(tenant)?.capabilities;
  const held = createHeld(parentId, parent, caller);

  const land = (group: Group): void => {
    toast.succeeded(createdText(group.path));
    go(groupHref(tenant, group.id), { replace: true });
  };

  const looked = lookupText('group', name, 'there');

  return {
    listHref: groupsHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    name,
    description,
    parentId,
    place: newGroupPlace(parentId, parent),
    picker,
    unavailableOf: (candidate) => parentUnavailable(null, candidate, caller ?? []),
    held,
    errors: flow.errors,
    message: flow.message,
    unconfirmed: flow.unconfirmed,
    busy: creation.busy,
    editName: (next) => {
      setName(next);
      flow.edited('name');
    },
    editDescription: (next) => {
      setDescription(next);
      flow.edited('description');
    },
    chooseParent: (ids) => {
      setParentId(firstChosen(ids));
      flow.edited('parent_id');
    },
    submit: () => {
      flow.submit({
        blocked: createBlocked(creation.busy, held),
        problem: problemAt('name', requiredProblem(name, 'Enter a name.')),
        spec: {
          noun: 'group',
          name,
          fields: ['name', 'description', 'parent_id'],
          taken: { field: 'name', fallback: NAME_TAKEN },
          capability: 'manage-tenant',
        },
        create: () => creation.create({ name, description, parentId }),
        made: land,
      });
    },
    check: () => {
      flow.check({
        busy: creation.busy,
        find: () => creation.find(name, parentId),
        made: land,
        looked,
      });
    },
  };
}
