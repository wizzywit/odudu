import type { GroupFields, RoleFields } from '@odudu/contracts/admin';
import { type TenantScopedDatabase } from '@odudu/db';
import {
  adminReachOfGroups,
  adminReachOfRoles,
  subtreeAdminReach,
} from '#/service/capability-ceiling';
import { holdsDefaultGroup } from '#/usecase/default-reach';

// The derived reach fields every role and group answer carries, read once
// for a whole page; the ETag is taken over the stored fields alone, so a
// change somewhere above or below a record never stales a write to it.

export async function withRoleReach<T extends { id: string }>(
  tx: TenantScopedDatabase,
  roles: readonly T[],
): Promise<(T & { admin_reach: readonly string[] })[]> {
  const reach = await adminReachOfRoles(
    tx,
    roles.map((role) => role.id),
  );
  return roles.map((role) => ({ ...role, admin_reach: reach.get(role.id) ?? [] }));
}

export async function withGroupReach(
  tx: TenantScopedDatabase,
  groups: readonly GroupFields[],
): Promise<(GroupFields & { admin_reach: readonly string[] })[]> {
  const reach = await adminReachOfGroups(
    tx,
    groups.map((group) => group.id),
  );
  return groups.map((group) => ({ ...group, admin_reach: reach.get(group.id) ?? [] }));
}

export async function groupRecordOf(
  tx: TenantScopedDatabase,
  group: GroupFields,
): Promise<
  GroupFields & {
    admin_reach: readonly string[];
    subtree_admin_reach: readonly string[];
    holds_default_group: boolean;
  }
> {
  const [reached] = await withGroupReach(tx, [group]);
  return {
    ...group,
    admin_reach: reached?.admin_reach ?? [],
    subtree_admin_reach: await subtreeAdminReach(tx, group.id),
    holds_default_group: await holdsDefaultGroup(tx, group.id),
  };
}

export async function roleWireOf(
  tx: TenantScopedDatabase,
  role: RoleFields,
): Promise<RoleFields & { admin_reach: readonly string[] }> {
  const [reached] = await withRoleReach(tx, [role]);
  return { ...role, admin_reach: reached?.admin_reach ?? [] };
}
