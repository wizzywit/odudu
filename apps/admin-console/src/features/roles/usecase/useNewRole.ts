import type { Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useCopySource, useCreateRole } from '#/features/roles/repository/useCreateRole.ts';
import { useGo } from '#/shared/repository/useGo.ts';
import {
  copiedDescription,
  type Copying,
  copyingOf,
  copyPlan,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  NAME_TAKEN,
  type PartialCopy,
  partialCopy,
  roleHref,
  rolesHref,
} from '#/features/roles/service';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import { requiredProblem, withoutField } from '#/shared/service/fieldErrors.ts';
import { createdText, createFailure, lookupText } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

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
  const push = useToasts((queue) => queue.push);
  const { params } = useUrlSearch();
  const source = useCopySource(tenant, params.get('copy'));
  const [name, setName] = useState('');
  const [description, setDescription] = useState<string | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [partial, setPartial] = useState<PartialCopy | null>(null);
  const shown = copiedDescription(description, source);
  const caller = useAuthority(tenant)?.capabilities;
  const plan = copyPlan(source.status === 'ready' ? source.children : [], caller, tenant);
  const children = plan.nested;
  const looked = lookupText('role', name);

  const land = (role: Role, missed: readonly Role[]): void => {
    const left = partialCopy(tenant, role, missed);
    if (left !== null) {
      setPartial(left);
      return;
    }
    push({ tone: 'success', message: createdText(role.name) });
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

  const failed = (failure: GatewayFailure): void => {
    const outcome = createFailure(failure, {
      noun: 'role',
      name,
      fields: ['name', 'description'],
      taken: { field: 'name', fallback: NAME_TAKEN },
      capability: 'manage-tenant',
    });
    if (outcome.unconfirmed) setUnconfirmed(true);
    if (outcome.report) refusal.report(failure, 'manage-tenant');
    setErrors(outcome.errors);
    setMessage(outcome.message);
  };

  return {
    listHref: rolesHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    copying: copyingOf(source, plan),
    name,
    description: shown,
    errors,
    message,
    unconfirmed,
    partial,
    busy: creation.busy || source.status === 'loading' || caller === undefined,
    editName: (next) => {
      setName(next);
      setErrors((was) => withoutField(was, 'name'));
    },
    editDescription: (next) => {
      setDescription(next);
      setErrors((was) => withoutField(was, 'description'));
    },
    submit: () => {
      if (
        creation.busy ||
        unconfirmed ||
        partial !== null ||
        source.status === 'loading' ||
        caller === undefined
      ) {
        return;
      }
      const required = requiredProblem(name, 'Enter a name.');
      if (required !== null) {
        setErrors({ name: required });
        return;
      }
      setErrors({});
      setMessage(null);
      creation
        .create({ name, description: shown })
        .then((result) => {
          if (result.ok) made(result.data);
          else failed(result);
        })
        .catch(() => {
          failed({ ok: false, kind: 'defect' });
        });
    },
    check: () => {
      if (creation.busy) return;
      creation
        .find(name)
        .then((result) => {
          if (!result.ok) {
            setMessage(looked.failed);
            return;
          }
          if (result.data !== null) {
            made(result.data);
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
