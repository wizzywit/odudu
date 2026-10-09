import type { Group, GroupRecord } from '@odudu/contracts/admin';
import {
  beyondCaller,
  ceilingOf,
  isAdminRole,
  isHolding,
  writeRefusal,
} from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

export function within(path: string, above: string): boolean {
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
