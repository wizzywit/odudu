import type { Group } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useCreateGroup } from '#/features/groups/repository/useCreateGroup.ts';
import { useGo } from '#/shared/repository/useGo.ts';
import { useGroupNamed } from '#/features/groups/repository/useGroupRecord.ts';
import {
  createHeld,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  groupHref,
  groupsHref,
  parentUnavailable,
  NAME_TAKEN,
  newGroupPlace,
} from '#/features/groups/service';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import { requiredProblem, withoutField } from '#/shared/service/fieldErrors.ts';
import { createdText, createFailure, lookupText } from '#/shared/service/failure.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

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
  const push = useToasts((queue) => queue.push);
  const { params } = useUrlSearch();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parentId, setParentId] = useState<string | null>(params.get('parent'));
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const picker = useGroupPicker(tenant);
  const asked = useGroupNamed(tenant, parentId);
  const parent =
    picker.options.find((group) => group.id === parentId) ??
    (asked.status === 'ready' ? asked.group : undefined);
  const caller = useAuthority(tenant)?.capabilities;
  const held = createHeld(parentId, parent, caller);

  const land = (group: Group): void => {
    push({ tone: 'success', message: createdText(group.path) });
    go(groupHref(tenant, group.id), { replace: true });
  };

  const looked = lookupText('group', name, 'there');

  const failed = (failure: GatewayFailure): void => {
    const outcome = createFailure(failure, {
      noun: 'group',
      name,
      fields: ['name', 'description', 'parent_id'],
      taken: { field: 'name', fallback: NAME_TAKEN },
      capability: 'manage-tenant',
    });
    if (outcome.unconfirmed) setUnconfirmed(true);
    if (outcome.report) refusal.report(failure, 'manage-tenant');
    setErrors(outcome.errors);
    setMessage(outcome.message);
  };

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
    errors,
    message,
    unconfirmed,
    busy: creation.busy,
    editName: (next) => {
      setName(next);
      setErrors((was) => withoutField(was, 'name'));
    },
    editDescription: (next) => {
      setDescription(next);
      setErrors((was) => withoutField(was, 'description'));
    },
    chooseParent: (ids) => {
      setParentId(ids[0] ?? null);
      setErrors((was) => withoutField(was, 'parent_id'));
    },
    submit: () => {
      if (creation.busy || unconfirmed || held !== null) return;
      const required = requiredProblem(name, 'Enter a name.');
      if (required !== null) {
        setErrors({ name: required });
        return;
      }
      setErrors({});
      setMessage(null);
      creation
        .create({ name, description, parentId })
        .then((result) => {
          if (result.ok) land(result.data);
          else failed(result);
        })
        .catch(() => {
          failed({ ok: false, kind: 'defect' });
        });
    },
    check: () => {
      if (creation.busy) return;
      creation
        .find(name, parentId)
        .then((result) => {
          if (!result.ok) {
            setMessage(looked.failed);
            return;
          }
          if (result.data !== null) {
            land(result.data);
            return;
          }
          setUnconfirmed(false);
          setMessage(looked.missing);
        })
        .catch(() => {
          setMessage(looked.failed);
        });
    },
  };
}
