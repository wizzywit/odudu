import { type Role, type ListRoleCompositesResponse } from '@odudu/contracts/admin';
import { withSearch } from '#/shared/services/address';
import { newRoleHref } from '#/features/roles/services/roleAddress';
import { type LeftOut, type PartialCopy } from '#/shared/services/copy';
import { andList } from '#/shared/services/format';
import { type AdminCapability } from '#/shared/services/principal';
import { type GatewayResult } from '#/shared/services/result';
import { childUnavailable } from '#/features/roles/services/composites';
import { roleTabHref } from '#/features/roles/services/tabs';

export function copyHref(tenant: string, id: string): string {
  return withSearch(newRoleHref(tenant), { copy: id });
}

// A copy is a tenant role, so only a tenant role offers one.
export function copyHrefOf(tenant: string, role: Role | undefined): string | null {
  return role?.client_id === null ? copyHref(tenant, role.id) : null;
}

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
      left: readonly LeftOut[];
    };

export interface CopyPlan {
  nested: Role[];
  left: LeftOut[];
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

// The role with its children, or nothing when either read failed.
export function copySourceOf(
  role: GatewayResult<Role>,
  children: GatewayResult<ListRoleCompositesResponse>,
): { role: Role; children: ListRoleCompositesResponse['items'] } | null {
  return role.ok && children.ok ? { role: role.data, children: children.data.items } : null;
}

export function sourceChildren(source: CopyRead): ListRoleCompositesResponse['items'] {
  return source.status === 'ready' ? source.children : [];
}

export function sourceDescription(source: CopyRead): string | null {
  return source.status === 'ready' ? source.role.description : null;
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
    href: roleTabHref(tenant, role.id, 'composites'),
    name: role.name,
  };
}
