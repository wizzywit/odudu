import { type EffectiveRoleAssignment, type RoleProvenance } from '@odudu/contracts/admin';
import { andList } from '#/shared/service/format.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import { type Holding, isAdminRole, isHolding } from '#/shared/service/capabilities/holdings.ts';

// The admin capabilities a principal stops holding once every way `gone`
// names is taken away; a role nested in one that goes, goes with it.
export function adminLoss(
  own: readonly EffectiveRoleAssignment[],
  gone: (via: RoleProvenance, role: EffectiveRoleAssignment) => boolean,
): Holding[] {
  const lost = new Set<string>();
  let grew = true;
  while (grew) {
    grew = false;
    for (const role of own) {
      if (lost.has(role.id) || role.via.length === 0) continue;
      const each = role.via.every((via) =>
        via.kind === 'composite'
          ? lost.has(via.parent_role_id) || gone(via, role)
          : gone(via, role),
      );
      if (each) {
        lost.add(role.id);
        grew = true;
      }
    }
  }
  return own
    .filter((role) => lost.has(role.id) && isAdminRole(role))
    .flatMap((role) => (isHolding(role.name) ? [role.name] : []));
}

// The principal's own roles and the groups it belongs to directly, as far as
// they could be read.
export interface OwnAccess {
  roles: readonly EffectiveRoleAssignment[];
  // The paths of the groups it belongs to directly.
  groups: readonly string[];
}

export type OwnAccessRead =
  { status: 'loading' } | { status: 'unknown' } | ({ status: 'ready' } & OwnAccess);

// Without the principal's own access, what it holds that a write takes from
// whoever holds it there.
export function possibleLoss(
  caller: readonly AdminCapability[],
  taken: readonly string[],
): AdminCapability[] {
  return caller.filter((capability) => taken.includes(capability));
}

// A write that takes something from the caller is confirmed first.
export interface Asked {
  title: string;
  consequence: string;
}

export type Loss =
  | { kind: 'checking' }
  | { kind: 'none' }
  | { kind: 'certain' | 'possible'; lost: readonly string[] };

// What a write takes from the principal itself: exactly where its own access
// was read, and otherwise whatever it holds that the write takes from
// whoever holds it there. Until either is known, the write waits.
export function judgedLoss(
  own: OwnAccessRead,
  exact: (access: OwnAccess) => readonly string[],
  caller: readonly AdminCapability[],
  taken: readonly string[],
): Loss {
  if (own.status === 'loading') return { kind: 'checking' };
  const lost = own.status === 'ready' ? exact(own) : possibleLoss(caller, taken);
  if (lost.length === 0) return { kind: 'none' };
  return { kind: own.status === 'ready' ? 'certain' : 'possible', lost };
}

export function lossText(loss: Loss, through: string): string {
  if (loss.kind === 'checking' || loss.kind === 'none') return '';
  const held = andList(loss.lost);
  return loss.kind === 'certain'
    ? ` You hold ${held} through ${through}, so this takes it from you, and this console with it.`
    : ` If you hold ${held} through ${through}, this takes it from you, and this console with it.`;
}

// Whether a write has to be confirmed first: it takes something from the caller.
export function asksFirst(loss: Loss): boolean {
  return loss.kind === 'certain' || loss.kind === 'possible';
}

export function lossBlocked(loss: Loss): string | undefined {
  return loss.kind === 'checking' ? 'Checking what this takes from you first.' : undefined;
}
