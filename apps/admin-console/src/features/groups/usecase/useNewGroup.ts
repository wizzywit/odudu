import type { Group } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import { useCreateGroup } from '#/features/groups/repository/useCreateGroup.ts';
import { useGo } from '#/features/groups/repository/useGo.ts';
import { useGroupNamed } from '#/features/groups/repository/useGroupRecord.ts';
import {
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  groupHref,
  groupsHref,
  parentUnavailable,
} from '#/features/groups/service.ts';
import { useGroupPicker } from '#/shared/repository/useGroupPicker.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import { beyondCaller, writeRefusal } from '#/shared/service/capabilities.ts';

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import type { PickerState } from '#/shared/service/picker.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

type Field = 'name' | 'description' | 'parent_id';
type Errors = Partial<Record<Field, string>>;

function without(errors: Errors, field: Field): Errors {
  return Object.fromEntries(Object.entries(errors).filter(([name]) => name !== field));
}

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

function sentence(text: string): string {
  const said = text.charAt(0).toUpperCase() + text.slice(1);
  return said.endsWith('.') ? said : `${said}.`;
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
  let held: string | null = null;
  if (caller === undefined || (parentId !== null && parent === undefined)) {
    held = 'Checking what the parent hands out first.';
  } else if (parent !== undefined && parentId !== null) {
    const beyond = beyondCaller(parent.admin_reach, caller);
    held =
      beyond.length === 0
        ? null
        : `A group made under ${parent.path} hands its members ${AND.format(beyond)}, which you do not hold, so you cannot make one there.`;
  }

  const land = (group: Group): void => {
    push({ tone: 'success', message: `${group.path} was created.` });
    go(groupHref(tenant, group.id), { replace: true });
  };

  const failed = (failure: GatewayFailure): void => {
    switch (failure.kind) {
      case 'network':
      case 'schema':
        setUnconfirmed(true);
        setMessage(
          `Could not confirm whether ${name} was created. It has not been sent again; look for it before trying again.`,
        );
        return;
      case 'defect':
        setMessage(
          'The console could not create the group. This is a fault in the console, not something you did.',
        );
        return;
      case 'problem': {
        const { problem } = failure;
        if (problem.status === 409) {
          setErrors({ name: sentence(problem.detail ?? 'That name is taken there') });
          return;
        }
        const refused = writeRefusal(problem);
        if (refused !== null) {
          refusal.report(failure, 'manage-tenant');
          setMessage(refused);
          return;
        }
        const placed = fieldErrorsOf(problem, ['name', 'description', 'parent_id']);
        setErrors(placed.fields);
        setMessage(placed.other.length === 0 ? null : placed.other.join(' '));
      }
    }
  };

  return {
    listHref: groupsHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    name,
    description,
    parentId,
    place:
      parentId === null
        ? 'It will sit at the top level.'
        : parent === undefined
          ? null
          : `It will sit under ${parent.path}.`,
    picker,
    unavailableOf: (candidate) => parentUnavailable(null, candidate, caller ?? []),
    held,
    errors,
    message,
    unconfirmed,
    busy: creation.busy,
    editName: (next) => {
      setName(next);
      setErrors((was) => without(was, 'name'));
    },
    editDescription: (next) => {
      setDescription(next);
      setErrors((was) => without(was, 'description'));
    },
    chooseParent: (ids) => {
      setParentId(ids[0] ?? null);
      setErrors((was) => without(was, 'parent_id'));
    },
    submit: () => {
      if (creation.busy || unconfirmed || held !== null) return;
      if (name.trim() === '') {
        setErrors({ name: 'Enter a name.' });
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
            setMessage(`Could not look for ${name}. Try again.`);
            return;
          }
          if (result.data !== null) {
            land(result.data);
            return;
          }
          setUnconfirmed(false);
          setMessage(
            `No group named ${name} was found there, so it was not created. Creating it again is safe.`,
          );
        })
        .catch(() => {
          setMessage(`Could not look for ${name}. Try again.`);
        });
    },
  };
}
