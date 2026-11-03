import type { Group, GroupRecord } from '#/entities/group';
import { beyondCaller, blockedByDefault } from '#/shared/lib/services/capabilities';
import { andList } from '#/shared/lib/services/format';
import { type AdminCapability } from '#/shared/lib/services/principal';

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
  const blocked = blockedByDefault(!group.default_for_new_subjects, group.admin_reach);
  if (blocked.length === 0) return null;
  return `Every new subject would join it and so receive ${andList(blocked)}, and a group every new subject joins may reach no admin capability. Take those roles off it, or off the groups above it, first.`;
}

export type Defaulting = 'itself' | 'beneath' | null;

export function defaultingOf(
  group: Pick<Group, 'default_for_new_subjects'> & { holds_default_group: boolean },
): Defaulting {
  if (group.default_for_new_subjects) return 'itself';
  return group.holds_default_group ? 'beneath' : null;
}

export const DEFAULT_LABEL = 'Joined by every new subject';
