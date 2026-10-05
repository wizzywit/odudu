import type { EffectiveRoleAssignment, Role } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  ADMIN_CLIENT_KEY,
  adminLoss,
  beyondCaller,
  ceilingOf,
  isAdminRole,
  isHolding,
  writeRefusal,
} from '#/shared/service/capabilities.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

export type { Role };

export function rolesHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/roles`;
}

export function newRoleHref(tenant: string): string {
  return `${rolesHref(tenant)}/new`;
}

export function copyHref(tenant: string, id: string): string {
  return `${newRoleHref(tenant)}?copy=${encodeURIComponent(id)}`;
}

export function roleHref(tenant: string, id: string): string {
  return `${rolesHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function rolesTrail(tenant: string, current: string): readonly Crumb[] {
  return [{ label: 'Identity' }, { label: 'Roles', href: rolesHref(tenant) }, { label: current }];
}

export const ROLE_TABS = ['general', 'composites', 'members', 'activity'] as const;
export type RoleTab = (typeof ROLE_TABS)[number];

export const ROLE_TAB_LABELS: Readonly<Record<RoleTab, string>> = {
  general: 'General',
  composites: 'Composites',
  members: 'Members',
  activity: 'Activity',
};

export function roleRecord(id: string): string {
  return `roles/${id}`;
}

export function compositesRecord(id: string): string {
  return `roles/${id}/composites`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<RoleTab, (id: string) => readonly string[]>> = {
  general: (id) => [roleRecord(id)],
  composites: (id) => [compositesRecord(id)],
  members: () => [],
  activity: () => [],
};

// ADR 0039: a token's roles claim carries the name.
export const NAME_FIXED =
  "A role's name is fixed once it is made: tokens carry it in their roles claim, and a relying party that matches on it would otherwise pass or fail by a token's age. A tenant role can be copied under another name instead.";

export { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export const DESCRIPTION_RULE = 'Leave it empty for none.';

// Every role of the built-in admin client, which the server guards by the
// client rather than by the role's name.
export function isBuiltin(role: Pick<Role, 'client_key'>): boolean {
  return role.client_key === ADMIN_CLIENT_KEY;
}

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

type Reaching = Pick<Role, 'name' | 'client_key' | 'admin_reach'>;

// `admin_reach` is the server's judgement of what a role hands out, however
// deep it nests a capability: the same one each ceiling on its writes makes.
export function deleteBlock(role: Role, caller: readonly AdminCapability[]): string | null {
  if (isBuiltin(role)) {
    return `${role.name} is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.`;
  }
  const beyond = beyondCaller(role.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `${role.name} reaches ${AND.format(beyond)}, which you do not hold, so you cannot delete it.`;
}

export function defaultBlock(role: Role): string | null {
  if (isBuiltin(role)) {
    return 'A capability of the built-in admin client is never handed to every new subject.';
  }
  if (role.default_for_new_subjects || role.admin_reach.length === 0) return null;
  return `It reaches ${AND.format(role.admin_reach)}, and a role every new subject receives may reach no admin capability. Take those composites out of it first.`;
}

// Giving a role or taking it out passes on what it reaches, so either is
// held to the caller's own capabilities.
export function removalBlock(
  child: Reaching,
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (isAdminRole(child) && isHolding(child.name)) return ceilingOf(tenant, child.name, caller);
  const beyond = beyondCaller(child.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `It reaches ${AND.format(beyond)}, which you do not hold, so you cannot give or take it.`;
}

export function childUnavailable(
  parent: Pick<Role, 'id' | 'default_for_new_subjects'>,
  child: Role,
  children: readonly Pick<Role, 'id'>[],
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (child.id === parent.id) return 'this role itself';
  if (children.some((each) => each.id === child.id)) return 'nested here already';
  if (parent.default_for_new_subjects && child.admin_reach.length > 0) {
    return 'Every new subject receives this role, so it may nest no admin capability.';
  }
  return removalBlock(child, caller, tenant);
}

type RefusedProblem = Parameters<typeof writeRefusal>[0];

export function compositeRefusal(child: string, problem: RefusedProblem): string | null {
  if (problem.status === 409 && problem.detail === 'would create a role composite cycle') {
    return `Refused: ${child} already includes this role, so nesting it here would make a loop.`;
  }
  if (problem.status === 409 && problem.type === 'about:blank' && problem.detail !== undefined) {
    return `Refused: ${problem.detail}.`;
  }
  return writeRefusal(problem);
}

export type RoleChange =
  { kind: 'delete'; id: string } | { kind: 'remove'; id: string; child: string };

// What a principal holding `own` stops holding: a deleted role takes itself
// and everything held only within it, and an edge what it alone carried.
export function roleSelfLoss(
  own: readonly EffectiveRoleAssignment[],
  change: RoleChange,
): string[] {
  switch (change.kind) {
    case 'delete':
      return adminLoss(own, (_via, role) => role.id === change.id);
    case 'remove':
      return adminLoss(
        own,
        (via, role) =>
          role.id === change.child && via.kind === 'composite' && via.parent_role_id === change.id,
      );
  }
}
