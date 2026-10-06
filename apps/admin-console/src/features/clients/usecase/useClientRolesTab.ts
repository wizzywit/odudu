import type { Client, Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { roleHref, rolesHref } from '#/features/roles';
import { useAuthority, useRefusal } from '#/features/session';
import {
  useClientRoleList,
  useCreateClientRole,
} from '#/features/clients/repository/useClientRoles.ts';
import {
  clientRolesListHref,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  NAME_REQUIRED,
  ROLE_NAME_TAKEN,
  ROLES_CAPABILITY,
  rolesReadable,
} from '#/features/clients/service';
import { useGo } from '#/shared/repository/useGo.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { lacking } from '#/shared/service/access.ts';
import { createdText, createFailure } from '#/shared/service/failure.ts';
import { requiredProblem, withoutField } from '#/shared/service/fieldErrors.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import type { ResourceListState } from '#/shared/service/resourceList.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

type Field = 'name' | 'description';
type Errors = Partial<Record<Field, string>>;

// Whether whoami admits the caller to the role list.
export function useRolesReadable(tenant: string): boolean {
  return rolesReadable(useAuthority(tenant));
}

export interface ClientRoles {
  list: ResourceListState<Role>;
  listHref: string;
  open: (id: string) => void;
  // What making a role needs that the caller lacks.
  needs: readonly AdminCapability[];
  descriptionRule: string;
  descriptionLimit: number;
  name: string;
  description: string;
  errors: Errors;
  message: string | null;
  busy: boolean;
  editName: (name: string) => void;
  editDescription: (description: string) => void;
  submit: () => void;
}

export function useClientRolesTab(tenant: string, client: Client): ClientRoles {
  const authority = useAuthority(tenant);
  const refusal = useRefusal(tenant);
  const list = useClientRoleList(tenant, client.id);
  const creation = useCreateClientRole(tenant, client.id);
  const push = useToasts((queue) => queue.push);
  const go = useGo();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);

  const failed = (failure: GatewayFailure): void => {
    const outcome = createFailure(failure, {
      noun: 'role',
      name,
      fields: ['name', 'description'],
      taken: { field: 'name', fallback: ROLE_NAME_TAKEN },
      capability: ROLES_CAPABILITY,
    });
    if (outcome.report) refusal.report(failure, ROLES_CAPABILITY);
    setErrors(outcome.errors);
    setMessage(outcome.message);
  };

  return {
    list,
    listHref: clientRolesListHref(rolesHref(tenant), client.id),
    open: (id) => {
      go(roleHref(tenant, id));
    },
    needs: lacking(authority, [ROLES_CAPABILITY]),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    name,
    description,
    errors,
    message,
    busy: creation.busy,
    editName: (next) => {
      setName(next);
      setErrors((was) => withoutField(was, 'name'));
    },
    editDescription: (next) => {
      setDescription(next);
      setErrors((was) => withoutField(was, 'description'));
    },
    submit: () => {
      if (creation.busy) return;
      const required = requiredProblem(name, NAME_REQUIRED);
      if (required !== null) {
        setErrors({ name: required });
        return;
      }
      setErrors({});
      setMessage(null);
      creation
        .create({ name, description })
        .then((result) => {
          if (!result.ok) {
            failed(result);
            return;
          }
          push({ tone: 'success', message: createdText(result.data.name) });
          setName('');
          setDescription('');
        })
        .catch(() => {
          failed({ ok: false, kind: 'defect' });
        });
    },
  };
}
