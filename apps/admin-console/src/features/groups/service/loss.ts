import type { RoleProvenance } from '@odudu/contracts/admin';
import {
  adminLoss,
  judgedLoss,
  type Loss,
  type OwnAccess,
  type OwnAccessRead,
} from '#/shared/service/capabilities';
import type { AdminCapability } from '#/shared/service/principal.ts';
import { within } from '#/features/groups/service/blocks.ts';

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
