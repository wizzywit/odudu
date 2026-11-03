import { type EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { adminLoss } from '#/shared/lib/services/capabilities';

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
