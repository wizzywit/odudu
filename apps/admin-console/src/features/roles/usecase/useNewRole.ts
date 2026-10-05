import type { Role } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import { useCopySource, useCreateRole } from '#/features/roles/repository/useCreateRole.ts';
import { useGo } from '#/features/roles/repository/useGo.ts';
import {
  childUnavailable,
  DESCRIPTION_MAX,
  DESCRIPTION_RULE,
  roleHref,
  rolesHref,
} from '#/features/roles/service.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { useUrlSearch } from '#/shared/repository/useUrlSearch.ts';
import { writeRefusal } from '#/shared/service/capabilities.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

type Field = 'name' | 'description';
type Errors = Partial<Record<Field, string>>;

function without(errors: Errors, field: Field): Errors {
  return Object.fromEntries(Object.entries(errors).filter(([name]) => name !== field));
}

function sentence(text: string): string {
  const said = text.charAt(0).toUpperCase() + text.slice(1);
  return said.endsWith('.') ? said : `${said}.`;
}

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export type Copying =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'failed' }
  | {
      status: 'ready';
      name: string;
      // What the copy will nest.
      children: readonly string[];
      // What it will not, since the caller could not nest it, and why.
      left: readonly { name: string; why: string }[];
    };

export interface PartialCopy {
  text: string;
  href: string;
  name: string;
}

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
  const shown = description ?? (source.status === 'ready' ? (source.role.description ?? '') : '');
  const caller = useAuthority(tenant)?.capabilities;
  // A copy is a new tenant role, nested in nothing and handed to nobody yet,
  // so each child is judged as a nesting into one.
  const fresh = { id: '', default_for_new_subjects: false };
  const judged = (source.status === 'ready' ? source.children : []).map((child) => ({
    child,
    why: caller === undefined ? null : childUnavailable(fresh, child, [], caller, tenant),
  }));
  const children = judged.filter((each) => each.why === null).map((each) => each.child);

  // A copy missing some of its composites stays here, saying so, since a
  // toast is never the only copy of something to act on.
  const land = (role: Role, missed: readonly Role[]): void => {
    if (missed.length > 0) {
      setPartial({
        text: `${role.name} was created, but ${AND.format(missed.map((each) => each.name))} could not be nested in it. Add them from its Composites tab.`,
        href: `${roleHref(tenant, role.id)}?tab=composites`,
        name: role.name,
      });
      return;
    }
    push({ tone: 'success', message: `${role.name} was created.` });
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
          'The console could not create the role. This is a fault in the console, not something you did.',
        );
        return;
      case 'problem': {
        const { problem } = failure;
        if (problem.status === 409) {
          setErrors({ name: sentence(problem.detail ?? 'That name is taken') });
          return;
        }
        const refused = writeRefusal(problem);
        if (refused !== null) {
          refusal.report(failure, 'manage-tenant');
          setMessage(refused);
          return;
        }
        const placed = fieldErrorsOf(problem, ['name', 'description']);
        setErrors(placed.fields);
        setMessage(placed.other.length === 0 ? null : placed.other.join(' '));
      }
    }
  };

  let copying: Copying = { status: 'none' };
  if (source.status === 'ready') {
    copying = {
      status: 'ready',
      name: source.role.name,
      children: children.map((child) => child.name),
      left: judged.flatMap(({ child, why }) => (why === null ? [] : [{ name: child.name, why }])),
    };
  } else if (source.status !== 'none') {
    copying = { status: source.status };
  }

  return {
    listHref: rolesHref(tenant),
    descriptionRule: DESCRIPTION_RULE,
    descriptionLimit: DESCRIPTION_MAX,
    copying,
    name,
    description: shown,
    errors,
    message,
    unconfirmed,
    partial,
    busy: creation.busy || source.status === 'loading' || caller === undefined,
    editName: (next) => {
      setName(next);
      setErrors((was) => without(was, 'name'));
    },
    editDescription: (next) => {
      setDescription(next);
      setErrors((was) => without(was, 'description'));
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
      if (name.trim() === '') {
        setErrors({ name: 'Enter a name.' });
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
            setMessage(`Could not look for ${name}. Try again.`);
            return;
          }
          if (result.data !== null) {
            made(result.data);
            return;
          }
          setUnconfirmed(false);
          setMessage(
            `No role named ${name} was found, so it was not created. Creating it again is safe.`,
          );
        })
        .catch(() => {
          setMessage(`Could not look for ${name}. Try again.`);
        });
    },
  };
}
