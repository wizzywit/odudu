import type { Group, GroupRecord } from '@odudu/contracts/admin';
import { beyondCaller, type Loss } from '#/shared/service/capabilities';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { type ReachLines, reachLines } from '#/features/groups/service/blocks.ts';
import { newGroupHref } from '#/features/groups/service/address.ts';
import { type Readiness } from '#/features/groups/service/loss.ts';

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
