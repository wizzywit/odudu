import { type EffectiveRoleAssignment, type HeldAdminCapability } from '@odudu/contracts/admin';
import { holds } from '#/shared/service/access.ts';
import {
  holdingLabel,
  TENANT_ROLE_TEXT,
  includedBy,
  isAdminRole,
  isHolding,
  type Holding,
} from '#/shared/service/capabilities';
import { type Authority } from '#/shared/service/principal.ts';
import { type Loaded } from '#/features/subjects/service/create.ts';

interface Assigned {
  id: string;
  name: string;
  client_key: string | null;
}

export interface SplitRoles {
  roleIds: string[];
  adminIds: string[];
  // The admin capabilities assigned, Full first, in the order they are offered.
  holdings: Holding[];
}

// One assignment list holds both: the admin capabilities are edited on their
// own, and every save sends the other part back as it was.
export function splitRoles(items: readonly Assigned[]): SplitRoles {
  const admin = items.filter((role) => isAdminRole(role));
  const holdings = admin.map((role) => role.name).filter((name) => isHolding(name));
  return {
    roleIds: items.filter((role) => !isAdminRole(role)).map((role) => role.id),
    adminIds: admin.map((role) => role.id),
    holdings: [
      ...holdings.filter((name) => name === 'tenant-admin'),
      ...holdings.filter((name) => name !== 'tenant-admin'),
    ],
  };
}

export interface HeldLine {
  holding: string;
  label: string;
  how: string;
}

// What a listed holder holds: Full collapses what it carries, and
// manage-users view-users; which group or role carries the rest is the
// open editor's to say.
export function heldLines(held: readonly HeldAdminCapability[]): HeldLine[] {
  const names = held.map((each) => each.name);
  return held
    .filter((each) => includedBy(each.name, names) === null)
    .map((each) => ({
      holding: each.name,
      label: holdingLabel(each.name),
      how: each.direct ? 'directly' : 'through a group or role',
    }));
}

export type OwnRoles =
  | { status: 'loading' }
  | {
      status: 'ready';
      roles: readonly EffectiveRoleAssignment[];
      // The paths of the groups it belongs to directly.
      groups: readonly string[];
    }
  | { status: 'unknown' };

export function ownRolesOf({
  member,
  authority,
  roles,
  groups,
}: {
  member: boolean;
  authority: Authority | undefined;
  roles: Loaded<{ items: readonly EffectiveRoleAssignment[] }>;
  groups: Loaded<{ items: readonly { path: string }[] }>;
}): OwnRoles {
  if (!member) return { status: 'ready', roles: [], groups: [] };
  if (authority === undefined) return { status: 'loading' };
  if (!holds(authority, 'view-users')) return { status: 'unknown' };
  if (roles.status === 'failed' || groups.status === 'failed') return { status: 'unknown' };
  if (roles.status === 'loading' || groups.status === 'loading') return { status: 'loading' };
  return {
    status: 'ready',
    roles: roles.data.items,
    groups: groups.data.items.map((group) => group.path),
  };
}

export interface Assignment {
  id: string;
  name: string;
  // The client it belongs to, by its client_id, or null for a tenant role.
  client: string | null;
}

export function knownAssignments(
  ...lists: (readonly { id: string; name: string; client_key: string | null }[])[]
): ReadonlyMap<string, Assignment> {
  return new Map(
    lists
      .flat()
      .map((role) => [role.id, { id: role.id, name: role.name, client: role.client_key }]),
  );
}

export function assignmentsOf(
  ids: readonly string[],
  known: ReadonlyMap<string, Assignment>,
): Assignment[] {
  return ids.map((id) => known.get(id) ?? { id, name: id, client: null });
}

export function roleUnavailableHere(role: {
  name: string;
  client_key: string | null;
}): string | null {
  return isAdminRole(role) ? 'an admin capability: set it under Admin capabilities' : null;
}

export function roleOwnerOf(client: string | null): string {
  return client === null ? TENANT_ROLE_TEXT : `client ${client}`;
}

export function roleIdsOf(
  holdings: readonly Holding[],
  adminRoles: ReadonlyMap<Holding, string> | null,
): { ids: string[] } | { missing: Holding[] } {
  if (adminRoles === null) return { missing: [...holdings] };
  const missing = holdings.filter((holding) => !adminRoles.has(holding));
  if (missing.length > 0) return { missing };
  return { ids: holdings.flatMap((holding) => adminRoles.get(holding) ?? []) };
}
