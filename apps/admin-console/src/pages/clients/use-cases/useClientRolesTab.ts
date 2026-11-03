import type { Role } from '@odudu/contracts/admin';
import type { Client } from '#/entities/client';
import { useState } from 'react';
import { roleHref, rolesHref } from '#/entities/role';
import { useAuthority, useRefusal } from '#/entities/session';
import { useClientRoleList, useCreateClientRole } from '#/pages/clients/repository/useClientRoles';
import {
  clientRolesListHref,
  CLIENT_ROLES_RULE,
  NAME_REQUIRED,
  NEW_ROLE_HEADING,
  NEW_ROLE_NAME_LABEL,
  NEW_ROLE_RULE,
  NO_CLIENT_ROLES,
  ROLE_NAME_TAKEN,
  ROLES_CAPABILITY,
  ROLES_OPEN_LABEL,
  rolesReadable,
} from '#/pages/clients/services/clientRoles';
import { useGo } from '#/shared/lib/repository/useGo';
import { useToast } from '#/shared/lib/repository/useToasts';
import { lacking } from '#/shared/lib/services/access';
import { createdText, createFailure } from '#/shared/lib/services/failure';
import { requiredProblem, withoutField } from '#/shared/lib/services/fieldErrors';
import type { AdminCapability } from '#/shared/lib/services/principal';
import type { ResourceListState } from '#/shared/lib/services/resourceList';
import type { GatewayFailure } from '#/shared/api/transport/gateway';
import { DESCRIPTION_MAX, DESCRIPTION_RULE } from '#/shared/lib/services/labels';

type Field = 'name' | 'description';
type Errors = Partial<Record<Field, string>>;

export interface RolesPanel {
  // Whether whoami admits the caller to the role list.
  readable: boolean;
  capability: AdminCapability;
}

export function useRolesPanel(tenant: string): RolesPanel {
  return { readable: rolesReadable(useAuthority(tenant)), capability: ROLES_CAPABILITY };
}

export interface ClientRoles {
  rule: string;
  capability: AdminCapability;
  openLabel: string;
  empty: string;
  newRoleHeading: string;
  newRoleRule: string;
  newRoleNameLabel: string;
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
  const toast = useToast();
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
    rule: CLIENT_ROLES_RULE,
    capability: ROLES_CAPABILITY,
    openLabel: ROLES_OPEN_LABEL,
    empty: NO_CLIENT_ROLES,
    newRoleHeading: NEW_ROLE_HEADING,
    newRoleRule: NEW_ROLE_RULE,
    newRoleNameLabel: NEW_ROLE_NAME_LABEL,
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
          toast.succeeded(createdText(result.data.name));
          setName('');
          setDescription('');
        })
        .catch(() => {
          failed({ ok: false, kind: 'defect' });
        });
    },
  };
}
