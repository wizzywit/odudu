import { type Loss, type OwnAccessRead } from '#/shared/services/capabilities';
import type { Role } from '#/entities/role';
import { type Ceiling } from '#/shared/services/access';
import { type Authority } from '#/shared/services/principal';
import { deleteBlock, isBuiltin } from '#/pages/roles/services/roleDeletion';

export function deleteChecking(ceiling: RoleCeiling, loss: Loss): boolean {
  return ceiling.status !== 'ready' || loss.kind === 'checking';
}

// What the role reaches, which its record carries, and the caller's own
// capabilities: every ceiling on its writes is judged by both, so nothing is
// offered until whoami has answered.
export type RoleCeiling = Ceiling<{
  // Why it cannot be deleted, by the ceiling, or null.
  deleteHeld: string | null;
}>;

export function roleCeiling(role: Role | undefined, authority: Authority | undefined): RoleCeiling {
  if (authority === undefined || role === undefined) return { status: 'checking' };
  return {
    status: 'ready',
    caller: authority.capabilities,
    deleteHeld: isBuiltin(role) ? null : deleteBlock(role, authority.capabilities),
  };
}

// Left out by the ceiling, which the page's one line explains.
export function isDeleteHeld(ceiling: RoleCeiling): boolean {
  return ceiling.status === 'ready' && ceiling.deleteHeld !== null;
}

export function defaultsChecking(role: Role, ceiling: RoleCeiling): boolean {
  return ceiling.status !== 'ready' && !isBuiltin(role);
}

// Each removal asks first where it takes from yourself, so none is offered
// while that is still being read.
export function compositesOffered(
  ceiling: RoleCeiling,
  own: { status: OwnAccessRead['status'] },
): boolean {
  return ceiling.status === 'ready' && own.status !== 'loading';
}
