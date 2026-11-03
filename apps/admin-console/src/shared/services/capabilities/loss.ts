import { type EffectiveRoleAssignment, type RoleProvenance } from '@odudu/contracts/admin';
import { andList } from '#/shared/services/format';
import type { AdminCapability } from '#/shared/services/principal';
import {
  type Holding,
  holdingLabel,
  isAdminRole,
  isHolding,
} from '#/shared/services/capabilities/holdings';
import { type Asked, type DialogAsk } from '#/shared/services/dialog';

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

export type { Asked };

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

// What this console stops offering once a holding is gone.
const LOSS: Readonly<Record<Holding, string>> = {
  'tenant-admin': 'everything Full carries',
  'view-users': 'reading subjects',
  'manage-users': 'changing subjects',
  'manage-clients': 'changing clients',
  'manage-tenant': "changing this tenant's settings, roles, groups and scopes",
  'manage-keys': 'managing signing keys',
  'manage-sessions': 'ending sessions and revoking grants',
  'view-audit': 'reading the audit trail',
  'manage-tenants': 'reaching every other tenant',
};

export interface Confirmation extends DialogAsk {
  // Typed before it is confirmed, where the change reaches every tenant.
  typed: string | null;
}

// Asked before a save that takes admin capabilities from yourself, or takes
// manage-tenants from anybody: a plain save would land at once (§7.4).
export function removalConfirmation({
  name,
  self,
  removed,
  removesTenants,
}: {
  name: string;
  self: boolean;
  removed: readonly Holding[];
  removesTenants: boolean;
}): Confirmation | null {
  if (removed.length === 0 || (!self && !removesTenants)) return null;
  const lost = andList(removed.map(holdingLabel));
  const stops = andList(removed.map((holding) => LOSS[holding]));
  if (removesTenants) {
    return {
      title: self
        ? 'Revoke your own system administration?'
        : `Take system administration from ${name}?`,
      consequence: self
        ? `You are taking ${lost} from yourself, and with manage-tenants every other tenant. Once it lands this console stops offering ${stops}, and only another system administrator can give it back.`
        : `${name} loses ${lost}, and with manage-tenants every other tenant. Their other roles are kept; a holding through a group or a role that nests it stays until it is changed there.`,
      typed: name,
    };
  }
  return {
    title: 'Remove your own admin capabilities?',
    consequence: `You are taking ${lost} from yourself. Once it lands this console stops offering ${stops}, unless a group or another role still gives it to you, and you cannot give it back yourself.`,
    typed: null,
  };
}

export function onlyHolderText(name: string, tenant: string, counted: string): string {
  return `${name} is the only enabled holder of ${counted}, so ${tenant} would be left with nobody holding it. Give it to somebody else first.`;
}
