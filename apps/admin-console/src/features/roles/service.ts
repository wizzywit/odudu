import type { EffectiveRoleAssignment, Role } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  ADMIN_CLIENT_KEY,
  adminLoss,
  beyondCaller,
  ceilingOf,
  isAdminRole,
  isHolding,
  reachOf,
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

export const DESCRIPTION_RULE = 'At most 1000 characters. Leave it empty for none.';

// Every role of the built-in admin client, which the server guards by the
// client rather than by the role's name.
export function isBuiltin(role: Pick<Role, 'client_key'>): boolean {
  return role.client_key === ADMIN_CLIENT_KEY;
}

export function ownerText(role: Pick<Role, 'client_key' | 'client_id'>): string {
  if (role.client_id === null) return 'tenant role';
  return isBuiltin(role)
    ? 'admin capability'
    : `role of client ${role.client_key ?? role.client_id}`;
}

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

type Named = Pick<Role, 'name' | 'client_key'>;

// What the role hands out by itself and through the roles nested in it, one
// level down; a capability nested deeper is the server's to find.
export function roleReach(tenant: string, role: Named, children: readonly Named[]) {
  return reachOf(tenant, [role, ...children]);
}

export function deleteBlock(
  tenant: string,
  role: Role,
  children: readonly Named[],
  caller: readonly AdminCapability[],
): string | null {
  if (isBuiltin(role)) {
    return `${role.name} is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.`;
  }
  const beyond = beyondCaller(roleReach(tenant, role, children), caller);
  return beyond.length === 0
    ? null
    : `${role.name} reaches ${AND.format(beyond)}, which you do not hold, so you cannot delete it.`;
}

export function defaultBlock(
  tenant: string,
  role: Role,
  children: readonly Named[],
): string | null {
  if (isBuiltin(role)) {
    return 'A capability of the built-in admin client is never handed to every new subject.';
  }
  const reached = roleReach(tenant, role, children);
  if (role.default_for_new_subjects || reached.length === 0) return null;
  return `It reaches ${AND.format(reached)}, and a role every new subject receives may reach no admin capability. Take those composites out of it first.`;
}

export function childUnavailable(
  parent: Role,
  child: Role,
  children: readonly Pick<Role, 'id'>[],
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (child.id === parent.id) return 'this role itself';
  if (children.some((each) => each.id === child.id)) return 'nested here already';
  if (!isAdminRole(child) || !isHolding(child.name)) return null;
  if (parent.default_for_new_subjects) {
    return 'Every new subject receives this role, so it may nest no admin capability.';
  }
  return ceilingOf(tenant, child.name, caller);
}

// Taking a capability out of a role takes it from whoever holds it there.
export function removalBlock(
  child: Named,
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (!isAdminRole(child) || !isHolding(child.name)) return null;
  return ceilingOf(tenant, child.name, caller);
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
