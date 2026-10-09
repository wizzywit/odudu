import type { EffectiveRoleAssignment, Role } from '@odudu/contracts/admin';
import { adminLoss, type Asked, type OwnAccessRead } from '#/shared/service/capabilities';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { deleteBlock, isBuiltin } from '#/features/roles/service/blocks.ts';

export type RoleChange =
  { kind: 'delete'; id: string } | { kind: 'remove'; id: string; child: string };

// What a principal holding `own` stops holding: a deleted role takes itself
// and everything held only within it, and an edge what it alone carried.
export function roleSelfLoss(
  own: readonly EffectiveRoleAssignment[],
  change: RoleChange,
): string[] {
  switch (change.kind) {
    case 'delete':
      return adminLoss(own, (_via, role) => role.id === change.id);
    case 'remove':
      return adminLoss(
        own,
        (via, role) =>
          role.id === change.child && via.kind === 'composite' && via.parent_role_id === change.id,
      );
  }
}

export type { Asked };

// What the role reaches, which its record carries, and the caller's own
// capabilities: every ceiling on its writes is judged by both, so nothing is
// offered until whoami has answered.
export type Ceiling =
  | { status: 'checking' }
  | {
      status: 'ready';
      caller: readonly AdminCapability[];
      // Why it cannot be deleted, by the ceiling, or null.
      deleteHeld: string | null;
    };

export function roleCeiling(role: Role | undefined, authority: Authority | undefined): Ceiling {
  if (authority === undefined || role === undefined) return { status: 'checking' };
  return {
    status: 'ready',
    caller: authority.capabilities,
    deleteHeld: isBuiltin(role) ? null : deleteBlock(role, authority.capabilities),
  };
}

// Left out by the ceiling, which the page's one line explains.
export function isDeleteHeld(ceiling: Ceiling): boolean {
  return ceiling.status === 'ready' && ceiling.deleteHeld !== null;
}

export function defaultsChecking(role: Role, ceiling: Ceiling): boolean {
  return ceiling.status !== 'ready' && !isBuiltin(role);
}

// Each removal asks first where it takes from yourself, so none is offered
// while that is still being read.
export function compositesOffered(
  ceiling: Ceiling,
  own: { status: OwnAccessRead['status'] },
): boolean {
  return ceiling.status === 'ready' && own.status !== 'loading';
}
