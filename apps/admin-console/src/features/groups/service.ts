import type { EffectiveRoleAssignment, Group, RoleProvenance } from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  adminLoss,
  beyondCaller,
  ceilingOf,
  isAdminRole,
  isHolding,
  reachOf,
  writeRefusal,
} from '#/shared/service/capabilities.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

export type { Group };

export function groupsHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/groups`;
}

export function newGroupHref(tenant: string, parent?: string): string {
  const base = `${groupsHref(tenant)}/new`;
  return parent === undefined ? base : `${base}?parent=${encodeURIComponent(parent)}`;
}

export function groupHref(tenant: string, id: string): string {
  return `${groupsHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function groupsTrail(tenant: string, current: string): readonly Crumb[] {
  return [{ label: 'Identity' }, { label: 'Groups', href: groupsHref(tenant) }, { label: current }];
}

export const GROUP_TABS = ['general', 'roles', 'members', 'activity'] as const;
export type GroupTab = (typeof GROUP_TABS)[number];

export const GROUP_TAB_LABELS: Readonly<Record<GroupTab, string>> = {
  general: 'General',
  roles: 'Roles',
  members: 'Members',
  activity: 'Activity',
};

export function groupRecord(id: string): string {
  return `groups/${id}`;
}

export function groupRolesRecord(id: string): string {
  return `groups/${id}/roles`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<GroupTab, (id: string) => readonly string[]>> = {
  general: (id) => [groupRecord(id)],
  roles: (id) => [groupRolesRecord(id)],
  members: () => [],
  activity: () => [],
};

// ADR 0039: a token's groups claim carries the path, which the name is part of.
export const NAME_FIXED =
  "A group's name is fixed once it is made: the groups claim carries its path, and a relying party that matches on it would otherwise pass or fail by a token's age.";

export const DESCRIPTION_RULE = 'At most 1000 characters. Leave it empty for none.';

function within(path: string, above: string): boolean {
  return path === above || path.startsWith(`${above}/`);
}

// A parent that is the group or sits beneath it would make a loop.
export function moveUnavailable(group: Group, candidate: Group): string | null {
  if (candidate.id === group.id) return 'the group itself';
  if (within(candidate.path, group.path)) {
    return `beneath ${group.path}, so the move would make a loop`;
  }
  return null;
}

type RefusedProblem = Parameters<typeof writeRefusal>[0];

export function moveRefusal(problem: RefusedProblem): string | null {
  if (problem.status === 409 && problem.type === 'about:blank') {
    return 'Refused: the parent chosen sits beneath this group, so the move would make a loop. Nothing was changed.';
  }
  return writeRefusal(problem);
}

export interface Step {
  group: Group;
  roles: readonly { name: string; client_key: string | null }[];
}

// The admin capabilities a group's members receive through it: what it maps
// itself, and what every group above it hands down.
export interface Reach {
  own: readonly AdminCapability[];
  inherited: readonly AdminCapability[];
}

export function groupReach(tenant: string, trail: readonly Step[]): Reach {
  const above = trail.slice(0, -1);
  return {
    own: reachOf(tenant, trail.at(-1)?.roles ?? []),
    inherited: reachOf(
      tenant,
      above.flatMap((step) => step.roles),
    ),
  };
}

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export interface ReachLines {
  // Why the group cannot be moved, or null when it can.
  move: string | null;
  // Why it cannot be deleted, or null when it can.
  remove: string | null;
}

// A move takes away what the old parents hand down, and a delete everything
// its members hold through it; neither may take what the caller lacks.
export function reachLines(
  path: string,
  reach: Reach,
  caller: readonly AdminCapability[],
): ReachLines {
  const moved = beyondCaller(reach.inherited, caller);
  const removed = beyondCaller([...new Set([...reach.own, ...reach.inherited])], caller);
  return {
    move:
      moved.length === 0
        ? null
        : `The groups above ${path} hand out ${AND.format(moved)}, which you do not hold, so you cannot move it: its members would lose that.`,
    remove:
      removed.length === 0
        ? null
        : `Its members hold ${AND.format(removed)} through it, which you do not hold, so you cannot delete it.`,
  };
}

export function defaultBlock(reach: Reach, isDefault: boolean): string | null {
  const reached = [...new Set([...reach.inherited, ...reach.own])];
  if (isDefault || reached.length === 0) return null;
  return `Every new subject would join it and so receive ${AND.format(reached)}, and a group every new subject joins may reach no admin capability. Take those roles off it, or off the groups above it, first.`;
}

export function roleUnavailable(
  role: { name: string; client_key: string | null },
  caller: readonly AdminCapability[],
  isDefault: boolean,
  tenant: string,
): string | null {
  if (!isAdminRole(role) || !isHolding(role.name)) return null;
  if (isDefault)
    return 'Every new subject joins this group, so it may hand out no admin capability.';
  return ceilingOf(tenant, role.name, caller);
}

export type Change =
  | { kind: 'delete'; path: string }
  | { kind: 'move'; path: string }
  | { kind: 'roles'; path: string; removed: readonly string[] };

function viaGroup(via: RoleProvenance, matches: (path: string) => boolean): boolean {
  return via.kind === 'group' && matches(via.group_path);
}

// What a principal holding `own` loses: a group's members hold what it maps
// and what every group above it maps, so a delete takes both from anybody in
// its subtree, and a move takes what the old parents handed down.
export function selfLoss(own: readonly EffectiveRoleAssignment[], change: Change): string[] {
  const { path } = change;
  switch (change.kind) {
    case 'delete':
      return adminLoss(own, (via) =>
        viaGroup(via, (each) => within(each, path) || within(path, each)),
      );
    case 'move':
      return adminLoss(own, (via) => viaGroup(via, (each) => each !== path && within(path, each)));
    case 'roles':
      return adminLoss(
        own,
        (via, role) => change.removed.includes(role.id) && viaGroup(via, (each) => each === path),
      );
  }
}
