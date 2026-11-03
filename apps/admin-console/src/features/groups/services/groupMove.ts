import { type Group, type GroupRecord } from '@odudu/contracts/admin';
import { beyondCaller, blockedByDefault, writeRefusal } from '#/shared/services/capabilities';
import { andList } from '#/shared/services/format';
import { type AdminCapability } from '#/shared/services/principal';
import { within } from '#/features/groups/services/groupPath';

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

// Its members would receive what the new parent hands out, so the caller
// may choose only a parent within its own capabilities.
export function parentUnavailable(
  group: Pick<GroupRecord, 'id' | 'path' | 'holds_default_group'> | null,
  candidate: Group,
  caller: readonly AdminCapability[],
): string | null {
  const loop = group === null ? null : moveUnavailable(group, candidate);
  if (loop !== null) return loop;
  const blocked = blockedByDefault(group?.holds_default_group === true, candidate.admin_reach);
  if (blocked.length > 0) {
    return `its members receive ${andList(blocked)}, and a group every new subject joins, or holds one beneath it, may reach no admin capability`;
  }
  const beyond = beyondCaller(candidate.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `its members receive ${andList(beyond)}, which you do not hold`;
}
