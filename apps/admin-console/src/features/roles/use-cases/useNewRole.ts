import type { Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useCopySource, useCreateRole } from '#/features/roles/repository/useCreateRole';
import { useGo } from '#/shared/repository/useGo';
import {
  sourceDescription,
  type Copying,
  copyingOf,
  copyPlan,
  partialCopy,
  roleHref,
  rolesHref,
  sourceChildren,
} from '#/features/roles/services';
import { useToast } from '#/shared/repository/useToasts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch';
import { problemAt, requiredProblem } from '#/shared/services/fieldErrors';
import { createdText, lookupText, namedCreation } from '#/shared/services/failure';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/services/labels';
import { useCreationFlow } from '#/shared/use-cases/useCreationFlow';
import { copiedDescription, copyBlocked, copyBusy, type PartialCopy } from '#/shared/services/copy';

type Field = 'name' | 'description';
type Errors = Partial<Record<Field, string>>;

export type { Copying, PartialCopy };

export interface NewRole {
  listHref: string;
  descriptionRule: string;
  descriptionLimit: number;
  copying: Copying;
  name: string;
  description: string;
  errors: Errors;
  message: string | null;
  // The POST's answer was lost: offer to look for the role rather than send it again.
  unconfirmed: boolean;
  // A copy made, without some of what it nests.
  partial: PartialCopy | null;
  busy: boolean;
  editName: (name: string) => void;
  editDescription: (description: string) => void;
  submit: () => void;
  check: () => void;
}

export function useNewRole(tenant: string): NewRole {
  const refusal = useRefusal(tenant);
  const creation = useCreateRole(tenant);
  const go = useGo();
  const toast = useToast();
  const { params } = useUrlSearch();
  const source = useCopySource(tenant, params.get('copy'));
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const flow = useCreationFlow<Field>(refusal);
  const [partial, setPartial] = useState<PartialCopy | null>(null);
  const shown = copiedDescription(description, sourceDescription(source));
  const caller = useAuthority(tenant)?.capabilities;
  const plan = copyPlan(sourceChildren(source), caller, tenant);
  const children = plan.nested;
  const looked = lookupText('role', name);

  const land = (role: Role, missed: readonly Role[]): void => {
    const left = partialCopy(tenant, role, missed);
    if (left !== null) {
      setPartial(left);
      return;
    }
    toast.succeeded(createdText(role.name));
    go(roleHref(tenant, role.id), { replace: true });
  };

  const made = (role: Role): void => {
    if (children.length === 0) {
      land(role, []);
      return;
    }
    creation
      .nest(role.id, children)
      .then((missed) => {
        land(role, missed);
      })
      .catch(() => {
        land(role, children);
      });
  };

  return {
    listHref: rolesHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    copying: copyingOf(source, plan),
    name,
    description: shown,
    errors: flow.errors,
    message: flow.message,
    unconfirmed: flow.unconfirmed,
    partial,
    busy: copyBusy(creation.busy, source.status, caller),
    editName: (next) => {
      setName(next);
      flow.edited('name');
    },
    editDescription: (next) => {
      setDescription(next);
      flow.edited('description');
    },
    submit: () => {
      flow.submit({
        blocked: copyBlocked(creation.busy, partial, source.status, caller),
        problem: problemAt('name', requiredProblem(name, 'Enter a name.')),
        spec: namedCreation('role', name),
        create: () => creation.create({ name, description: shown }),
        made,
      });
    },
    check: () => {
      flow.check({ busy: creation.busy, find: () => creation.find(name), made, looked });
    },
  };
}
