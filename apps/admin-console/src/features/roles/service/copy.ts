import type { ListRoleCompositesResponse, Role } from '@odudu/contracts/admin';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import { childUnavailable } from '#/features/roles/service/blocks.ts';
import { roleHref } from '#/features/roles/service/address.ts';

export type CopyRead =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; role: Role; children: ListRoleCompositesResponse['items'] }
  | { status: 'failed' };

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

export interface CopyPlan {
  nested: Role[];
  left: { name: string; why: string }[];
}

// A copy is a new tenant role, nested in nothing and handed to nobody yet,
// so each child is judged as a nesting into one. Until the caller is known
// every child is taken to be nestable.
export function copyPlan(
  children: readonly Role[],
  caller: readonly AdminCapability[] | undefined,
  tenant: string,
): CopyPlan {
  const fresh = { id: '', default_for_new_subjects: false };
  const plan: CopyPlan = { nested: [], left: [] };
  for (const child of children) {
    const why = caller === undefined ? null : childUnavailable(fresh, child, [], caller, tenant);
    if (why === null) plan.nested.push(child);
    else plan.left.push({ name: child.name, why });
  }
  return plan;
}

export function copyingOf(source: CopyRead, plan: CopyPlan): Copying {
  if (source.status === 'ready') {
    return {
      status: 'ready',
      name: source.role.name,
      children: plan.nested.map((child) => child.name),
      left: plan.left,
    };
  }
  return { status: source.status };
}

export function copyingText(copying: { name: string; children: readonly string[] }): string {
  const nests = copying.children.length === 0 ? 'nothing' : andList(copying.children);
  return `A copy of ${copying.name}, nesting ${nests}.`;
}

export function copiedDescription(edited: string | null, source: CopyRead): string {
  return edited ?? (source.status === 'ready' ? (source.role.description ?? '') : '');
}

// A copy missing some of its composites stays on the page, saying so, since
// a toast is never the only copy of something to act on.
export function partialCopy(
  tenant: string,
  role: Pick<Role, 'id' | 'name'>,
  missed: readonly Pick<Role, 'name'>[],
): PartialCopy | null {
  if (missed.length === 0) return null;
  return {
    text: `${role.name} was created, but ${andList(missed.map((each) => each.name))} could not be nested in it. Add them from its Composites tab.`,
    href: `${roleHref(tenant, role.id)}?tab=composites`,
    name: role.name,
  };
}
