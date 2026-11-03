import { type GroupRecord } from '@odudu/contracts/admin';
import { type Loss } from '#/shared/services/capabilities';
import { type AdminCapability, type Authority } from '#/shared/services/principal';
import { type Loaded } from '#/shared/services/read';
import { type ReachLines, reachLines } from '#/features/groups/services/groupReach';

export type GroupRead = { status: 'none' } | Loaded<GroupRecord>;

// A group named by an id that may not be there: none for none, else what was read.
export function namedGroupRead(id: string | null, read: GroupRead): GroupRead {
  return id === null ? { status: 'none' } : read;
}

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
    parent.status === 'none' ? [] : parent.status === 'ready' ? parent.data.admin_reach : null;
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

export function groupReadiness(status: Ceiling['status'], loss: Loss): Readiness {
  if (status === 'failed') return 'failed';
  return status !== 'ready' || loss.kind === 'checking' ? 'checking' : 'ready';
}

export function ceilingParentReach(ceiling: Ceiling): readonly string[] {
  return ceiling.status === 'ready' ? ceiling.parentReach : [];
}

export function ceilingLines(ceiling: Ceiling): ReachLines {
  return ceiling.status === 'ready' ? ceiling.lines : { move: null, remove: null };
}

// A write waits for what it is judged by to be read: until it has been, it
// is checking; if it could not be, the page's one line says so.
export type Readiness = 'checking' | 'failed' | 'ready';
