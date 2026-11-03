import { asksFirst, type Loss, type OwnAccessRead } from '#/shared/services/capabilities';
import { type Role } from '@odudu/contracts/admin';
import { type AdminCapability, type Authority } from '#/shared/services/principal';
import { deleteBlock, isBuiltin } from '#/features/roles/services/roleDeletion';

export type RemovalAction = 'wait' | 'ask' | 'run';

export function removalAction(loss: Loss): RemovalAction {
  if (loss.kind === 'checking') return 'wait';
  return asksFirst(loss) ? 'ask' : 'run';
}

export function deleteChecking(ceiling: Ceiling, loss: Loss): boolean {
  return ceiling.status !== 'ready' || loss.kind === 'checking';
}

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
