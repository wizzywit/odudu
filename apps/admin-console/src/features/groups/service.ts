import type {
  Group,
  GroupRecord,
  Role,
  RoleProvenance,
  SetGroupRolesResponse,
} from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  adminLoss,
  beyondCaller,
  judgedLoss,
  type Loss,
  type OwnAccess,
  type OwnAccessRead,
  ceilingOf,
  isAdminRole,
  isHolding,
  lossText,
  type Asked,
  writeRefusal,
} from '#/shared/service/capabilities.ts';
import { andList } from '#/shared/service/format.ts';
import { sortedIds } from '#/shared/service/ids.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';

export type { Group, GroupRecord };
export { lossText, possibleLoss } from '#/shared/service/capabilities.ts';
export type { Loss, OwnAccess };

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

export { DESCRIPTION_MAX } from '@odudu/contracts/admin';

export const DESCRIPTION_RULE = 'Leave it empty for none.';

export const PLACE_LABEL = 'Place in the tree';
export const DEFAULT_LABEL = 'Joined by every new subject';
export const NAME_TAKEN = 'That name is taken there';

function within(path: string, above: string): boolean {
  return path === above || path.startsWith(`${above}/`);
}

// A parent that is the group or sits beneath it would make a loop.
export function moveUnavailable(
  group: Pick<Group, 'id' | 'path'>,
  candidate: Pick<Group, 'id' | 'path'>,
): string | null {
  if (candidate.id === group.id) return 'the group itself';
  if (within(candidate.path, group.path)) {
    return `beneath ${group.path}, so the move would make a loop`;
  }
  return null;
}

type RefusedProblem = Parameters<typeof writeRefusal>[0];

const TAKEN = /^a group named (".*") already exists there$/u;

export function moveRefusal(problem: RefusedProblem): string | null {
  if (problem.status === 409 && problem.detail === 'would create a group reparent cycle') {
    return 'Refused: the parent chosen sits beneath this group, so the move would make a loop. Nothing was changed.';
  }
  const taken = problem.status === 409 ? TAKEN.exec(problem.detail ?? '') : null;
  if (taken !== null) {
    return `Refused: the parent chosen already holds a group named ${taken[1] ?? ''}, and two groups beside each other cannot share a name. Nothing was changed.`;
  }
  return writeRefusal(problem);
}

export interface ReachLines {
  // Why the group cannot be moved, or null when it can.
  move: string | null;
  // Why it cannot be deleted, or null when it can.
  remove: string | null;
}

// A move takes away what the old parent's chain hands down, and a delete
// what its subtree's members hold through it; neither may take what the
// caller lacks. The server works both out (`admin_reach`).
export function reachLines(
  group: GroupRecord,
  parentReach: readonly string[],
  caller: readonly AdminCapability[],
): ReachLines {
  const moved = beyondCaller(parentReach, caller);
  const removed = beyondCaller(group.subtree_admin_reach, caller);
  return {
    move:
      moved.length === 0
        ? null
        : `The groups above ${group.path} hand out ${andList(moved)}, which you do not hold, so you cannot move it: its members would lose that.`,
    remove:
      removed.length === 0
        ? null
        : `Its members hold ${andList(removed)} through it, which you do not hold, so you cannot delete it.`,
  };
}

export function defaultBlock(group: Group): string | null {
  if (group.default_for_new_subjects || group.admin_reach.length === 0) return null;
  return `Every new subject would join it and so receive ${andList(group.admin_reach)}, and a group every new subject joins may reach no admin capability. Take those roles off it, or off the groups above it, first.`;
}

// Its members would receive what the new parent hands out, so the caller
// may choose only a parent within its own capabilities.
export function parentUnavailable(
  group: Pick<GroupRecord, 'id' | 'path' | 'holds_default_group'> | null,
  candidate: Group,
  caller: readonly AdminCapability[],
): string | null {
  const loop = group === null ? null : moveUnavailable(group, candidate);
  if (loop !== null) return loop;
  if (group?.holds_default_group === true && candidate.admin_reach.length > 0) {
    return `its members receive ${andList(candidate.admin_reach)}, and a group every new subject joins, or holds one beneath it, may reach no admin capability`;
  }
  const beyond = beyondCaller(candidate.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `its members receive ${andList(beyond)}, which you do not hold`;
}

export type Defaulting = 'itself' | 'beneath' | null;

export function defaultingOf(
  group: Pick<Group, 'default_for_new_subjects'> & { holds_default_group: boolean },
): Defaulting {
  if (group.default_for_new_subjects) return 'itself';
  return group.holds_default_group ? 'beneath' : null;
}

export function roleUnavailable(
  role: { name: string; client_key: string | null; admin_reach: readonly string[] },
  caller: readonly AdminCapability[],
  defaulting: Defaulting,
  tenant: string,
): string | null {
  if (defaulting === 'itself' && role.admin_reach.length > 0) {
    return 'Every new subject joins this group, so it may hand out no admin capability.';
  }
  if (defaulting === 'beneath' && role.admin_reach.length > 0) {
    return 'Every new subject joins a group beneath this one and so receives what this one hands out, so it may hand out no admin capability.';
  }
  if (isAdminRole(role) && isHolding(role.name)) return ceilingOf(tenant, role.name, caller);
  const beyond = beyondCaller(role.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `It reaches ${andList(beyond)}, which you do not hold, so you cannot give or take it.`;
}

export type Change =
  | { kind: 'delete'; path: string }
  | { kind: 'move'; path: string; to: string | null }
  | { kind: 'roles'; path: string; removed: readonly string[] };

function viaGroup(via: RoleProvenance, matches: (path: string) => boolean): boolean {
  return via.kind === 'group' && matches(via.group_path);
}

// What the principal loses: a role mapped to a group reaches each member of
// it and of every group beneath it, so an edge through `above` goes when
// every membership beneath `above` goes or leaves it.
export function selfLoss(own: OwnAccess, change: Change): string[] {
  const { path } = change;
  const reachedBy = (above: string): readonly string[] =>
    own.groups.filter((member) => within(member, above));
  const allInside = (above: string): boolean => {
    const members = reachedBy(above);
    return members.length > 0 && members.every((member) => within(member, path));
  };
  switch (change.kind) {
    case 'delete':
      return adminLoss(own.roles, (via) => viaGroup(via, (above) => allInside(above)));
    case 'move':
      return adminLoss(own.roles, (via) =>
        viaGroup(
          via,
          (above) =>
            above !== path &&
            within(path, above) &&
            allInside(above) &&
            (change.to === null || !within(change.to, above)),
        ),
      );
    case 'roles':
      return adminLoss(
        own.roles,
        (via, role) => change.removed.includes(role.id) && viaGroup(via, (above) => above === path),
      );
  }
}

// What a write to a group takes from the principal itself (`judgedLoss`).
export function lossOf(
  own: OwnAccessRead,
  caller: readonly AdminCapability[],
  change: Change,
  taken: readonly string[],
): Loss {
  return judgedLoss(own, (access) => selfLoss(access, change), caller, taken);
}

// A write waits for what it is judged by to be read: until it has been, it
// is checking; if it could not be, the page's one line says so.
export type Readiness = 'checking' | 'failed' | 'ready';

export type { Asked };

export type GroupRead =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; group: GroupRecord }
  | { status: 'failed'; retry: () => void };

// What its parent hands down beside what the group itself carries, and the
// caller's own capabilities: every ceiling on its writes is judged by them,
// so none is offered until all three are known.
export type Ceiling =
  | { status: 'checking' }
  | { status: 'failed'; retry: () => void }
  | {
      status: 'ready';
      parentReach: readonly string[];
      caller: readonly AdminCapability[];
      lines: ReachLines;
    };

export function groupCeiling(
  parent: GroupRead,
  authority: Authority | undefined,
  group: GroupRecord | undefined,
): Ceiling {
  if (parent.status === 'failed') return { status: 'failed', retry: parent.retry };
  const parentReach =
    parent.status === 'none' ? [] : parent.status === 'ready' ? parent.group.admin_reach : null;
  if (parentReach === null || authority === undefined || group === undefined) {
    return { status: 'checking' };
  }
  return {
    status: 'ready',
    parentReach,
    caller: authority.capabilities,
    lines: reachLines(group, parentReach, authority.capabilities),
  };
}

// A group made under this one receives what it hands out, so it is offered
// only to a caller holding all of that.
export function createUnderHref(
  tenant: string,
  group: Pick<GroupRecord, 'id' | 'admin_reach'> | undefined,
  ceiling: Ceiling,
): string | null {
  return ceiling.status === 'ready' &&
    group !== undefined &&
    beyondCaller(group.admin_reach, ceiling.caller).length === 0
    ? newGroupHref(tenant, group.id)
    : null;
}

export function groupReadiness(status: Ceiling['status'], loss: Loss): Readiness {
  if (status === 'failed') return 'failed';
  return status !== 'ready' || loss.kind === 'checking' ? 'checking' : 'ready';
}

// Why Create is held: what the parent hands out is still being read, or the
// parent chosen hands out more than the caller holds.
export function createHeld(
  parentId: string | null,
  parent: Group | undefined,
  caller: readonly AdminCapability[] | undefined,
): string | null {
  if (caller === undefined || (parentId !== null && parent === undefined)) {
    return 'Checking what the parent hands out first.';
  }
  if (parent === undefined || parentId === null) return null;
  const beyond = beyondCaller(parent.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `A group made under ${parent.path} hands its members ${andList(beyond)}, which you do not hold, so you cannot make one there.`;
}

// A null path is the top level.
export function placeText(path: string | null, tense: 'will' | 'is'): string {
  const where = path === null ? 'at the top level' : `under ${path}`;
  const said = tense === 'will' ? `It will sit ${where}` : where;
  return `${said.charAt(0).toUpperCase()}${said.slice(1)}.`;
}

// Null until the parent chosen has been read.
export function newGroupPlace(
  parentId: string | null,
  parent: Pick<Group, 'path'> | undefined,
): string | null {
  if (parentId === null) return placeText(null, 'will');
  return parent === undefined ? null : placeText(parent.path, 'will');
}

// A path is its parent's with the name appended, so the parent read with the
// group needs no read of its own.
export function parentPathOf(
  group: Pick<GroupRecord, 'path' | 'parent_id'>,
  id: unknown,
  known: ReadonlyMap<string, Pick<Group, 'path'>>,
): string {
  if (typeof id !== 'string') return 'the top level';
  const read = group.path.slice(0, group.path.lastIndexOf('/'));
  return known.get(id)?.path ?? (id === group.parent_id ? read : id);
}

export function parentPlace(
  group: Pick<GroupRecord, 'path' | 'parent_id'>,
  id: string | null,
  known: ReadonlyMap<string, Pick<Group, 'path'>>,
): string | null {
  return id === null ? null : parentPathOf(group, id, known);
}

export function ceilingCaller(ceiling: Ceiling): readonly AdminCapability[] {
  return ceiling.status === 'ready' ? ceiling.caller : [];
}

export function ceilingParentReach(ceiling: Ceiling): readonly string[] {
  return ceiling.status === 'ready' ? ceiling.parentReach : [];
}

export function ceilingLines(ceiling: Ceiling): ReachLines | null {
  return ceiling.status === 'ready' ? ceiling.lines : null;
}

export function moveConfirmation(path: string, loss: Loss): Asked {
  return {
    title: 'Move a group your own access runs through?',
    consequence: `${path} would no longer receive what the groups above it hand down.${lossText(loss, 'the groups above it')}`,
  };
}

export function deleteConsequence(path: string, loss: Loss): string {
  return `Deleting ${path} deletes every group beneath it too, with every membership and role mapping of each, so their members lose the roles these groups gave them. It cannot be undone.${lossText(loss, 'these groups')}`;
}

export function subtreeDeletedText(path: string): string {
  return `${path} and every group beneath it were deleted.`;
}

export function rolesConfirmation(path: string, loss: Loss): Asked {
  return {
    title: 'Take roles your own access runs through?',
    consequence: `Taking them off the group takes them from its members.${lossText(loss, path)} You may not be able to give it back yourself.`,
  };
}

export interface Mapped {
  id: string;
  name: string;
  client_id: string | null;
  client_key: string | null;
  description: string | null;
}

type MappedItem = SetGroupRolesResponse['items'][number];

// The mapped roles, which carry no description, and then the picker's roles,
// which do and so win.
export function roleIndex(
  items: readonly MappedItem[],
  options: readonly Role[],
): ReadonlyMap<string, Mapped> {
  const entry = (role: MappedItem | Role, description: string | null): [string, Mapped] => [
    role.id,
    {
      id: role.id,
      name: role.name,
      client_id: role.client_id,
      client_key: role.client_key,
      description,
    },
  ];
  return new Map([
    ...items.map((role) => entry(role, null)),
    ...options.map((role) => entry(role, role.description)),
  ]);
}

export function mappedRoles(ids: readonly string[], index: ReadonlyMap<string, Mapped>): Mapped[] {
  return ids.map(
    (id) => index.get(id) ?? { id, name: id, client_id: null, client_key: null, description: null },
  );
}

// A role mapped here that the caller could not give is one it cannot take.
export function keptRoles(
  items: readonly MappedItem[],
  caller: readonly AdminCapability[],
  tenant: string,
): string[] {
  return items
    .filter((role) => roleUnavailable(role, caller, null, tenant) !== null)
    .map((role) => role.id);
}

export function reachOfRoles(items: readonly MappedItem[], ids: readonly string[]): string[] {
  return ids.flatMap((id) => items.find((role) => role.id === id)?.admin_reach ?? []);
}

export function withKept(ids: readonly string[], kept: readonly string[]): string[] {
  return sortedIds([...new Set([...ids, ...kept])]);
}
