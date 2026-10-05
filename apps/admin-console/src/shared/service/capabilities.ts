import {
  ADMIN_CAPABILITIES,
  type EffectiveRoleAssignment,
  type RoleProvenance,
} from '@odudu/contracts/admin';
import { andList } from '#/shared/service/format.ts';
import { tenantAdminCarries, TENANT_ADMIN } from '#/shared/service/administrators.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';

// The built-in client every capability role hangs off; its client_id is
// fixed, so a tenant role of the same name is never mistaken for one.
export const ADMIN_CLIENT_KEY = 'odudu-admin';

// Full is tenant-admin, which nests every capability the tenant offers.
export type Holding = typeof TENANT_ADMIN | AdminCapability;

export const CAPABILITY_TEXT: Readonly<Record<AdminCapability, string>> = {
  'view-users': 'Read subjects, their profiles, credentials, roles and groups.',
  'manage-users': 'Create, change and delete subjects. Carries view-users.',
  'manage-clients': 'Register, change and delete clients and their secrets.',
  'manage-tenant': 'Change settings, roles, groups, scopes, the sign-in flow and email.',
  'manage-keys': 'Create, promote, retire and delete signing keys.',
  'manage-sessions': 'See and end sessions, and revoke grants.',
  'view-audit': 'Read the audit trail.',
  'manage-tenants': 'Create, change and disable tenants, and act inside every one.',
};

export function fullText(tenant: string): string {
  return tenant === 'system'
    ? 'Every capability, manage-tenants among them, so every tenant too.'
    : 'Every capability this tenant offers.';
}

export function holdingLabel(holding: Holding): string {
  return holding === TENANT_ADMIN ? 'Full (tenant-admin)' : holding;
}

export function grantableIn(tenant: string): readonly AdminCapability[] {
  return tenantAdminCarries(tenant);
}

// Every holding offered in a tenant, Full first.
export function holdingsIn(tenant: string): readonly Holding[] {
  return [TENANT_ADMIN, ...grantableIn(tenant)];
}

function isCapability(name: string): name is AdminCapability {
  return (ADMIN_CAPABILITIES as readonly string[]).includes(name);
}

export function isHolding(name: string): name is Holding {
  return name === TENANT_ADMIN || isCapability(name);
}

export function adminClientOfRoles(
  roles: readonly { name: string; client_id: string | null; client_key: string | null }[],
): string | null {
  return (
    roles.find((role) => role.client_key === ADMIN_CLIENT_KEY && role.name === TENANT_ADMIN)
      ?.client_id ?? null
  );
}

export function holdingRoleIds(
  roles: readonly { id: string; name: string; client_key: string | null }[],
): ReadonlyMap<Holding, string> {
  const ids = new Map<Holding, string>();
  for (const role of roles) {
    if (isAdminRole(role) && isHolding(role.name)) ids.set(role.name, role.id);
  }
  return ids;
}

export function isAdminRole(role: { name: string; client_key: string | null }): boolean {
  return role.client_key === ADMIN_CLIENT_KEY && isHolding(role.name);
}

export function provenanceText(via: RoleProvenance): string {
  switch (via.kind) {
    case 'direct':
      return 'directly';
    case 'group':
      return `through group ${via.group_path}`;
    case 'composite':
      return `within ${via.parent_name}`;
  }
}

export interface Held {
  // Assigned to the subject itself, which is what an edit here changes.
  direct: boolean;
  // Every other path it is held by, as a reader says it.
  through: readonly string[];
}

export function heldCapabilities(
  effective: readonly EffectiveRoleAssignment[],
): ReadonlyMap<Holding, Held> {
  const held = new Map<Holding, Held>();
  for (const role of effective) {
    if (!isAdminRole(role) || !isHolding(role.name)) continue;
    held.set(role.name, {
      direct: role.via.some((via) => via.kind === 'direct'),
      through: role.via.filter((via) => via.kind !== 'direct').map(provenanceText),
    });
  }
  return held;
}

// A caller may never give or take authority it does not hold (ADR 0040).
export function ceilingOf(
  tenant: string,
  holding: Holding,
  caller: readonly AdminCapability[],
): string | null {
  if (holding === TENANT_ADMIN) {
    return grantableIn(tenant).every((capability) => caller.includes(capability))
      ? null
      : 'Full carries capabilities you do not hold, so you cannot give or take it.';
  }
  return caller.includes(holding)
    ? null
    : `You do not hold ${holding}, so you cannot give or take it.`;
}

// A subject holding a capability the caller lacks is out of the caller's
// reach altogether, removals included (ADR 0040's target ceiling).
export function beyondCaller(
  held: readonly string[],
  caller: readonly AdminCapability[],
): AdminCapability[] {
  return held.filter((name) => isCapability(name)).filter((name) => !caller.includes(name));
}

const NESTED: Readonly<Partial<Record<AdminCapability, AdminCapability>>> = {
  'view-users': 'manage-users',
};

// The chosen holding that already carries this one, if any.
export function includedBy(holding: Holding, chosen: readonly string[]): Holding | null {
  if (holding === TENANT_ADMIN) return null;
  if (chosen.includes(TENANT_ADMIN)) return TENANT_ADMIN;
  const parent = NESTED[holding];
  return parent !== undefined && chosen.includes(parent) ? parent : null;
}

// Whose a role is, in words: a client's role reaches a token under its
// client's name, and the built-in admin client's roles are the capabilities.
export function roleOwnerText(role: {
  client_id: string | null;
  client_key: string | null;
}): string {
  if (role.client_id === null) return 'tenant role';
  return role.client_key === ADMIN_CLIENT_KEY
    ? 'admin capability'
    : `role of client ${role.client_key ?? role.client_id}`;
}

// The capabilities one part of a ceiling refusal's detail names after `lead`.
function namedAfter(parts: readonly string[], lead: string): string[] {
  const part = parts.find((each) => each.startsWith(lead));
  return part === undefined ? [] : part.slice(lead.length).split(', ');
}

// What a group, role or scope write refused by its guards means, worded
// where it was made; the server's own reason is kept when it is not the
// capability ceiling's (ADR 0040). Null for anything else.
export function writeRefusal(
  problem: { type: string; status: number; detail?: string | undefined },
  capability = 'manage-tenant',
): string | null {
  const detail = problem.detail;
  if (problem.status === 409 && problem.type === 'about:blank#last-administrator') {
    const who = detail === undefined ? '' : ` (${detail})`;
    return `Refused: it would leave this tenant with no enabled administrator${who}. Make somebody else an administrator first.`;
  }
  if (problem.status !== 403) return null;
  if (detail === undefined || detail === '') {
    return `Refused: it needs the ${capability} capability, or reaches a capability you do not hold.`;
  }
  const parts = detail.split('; ');
  const granted = namedAfter(parts, 'the caller does not hold: ');
  const removed = namedAfter(parts, 'this removes capabilities the caller does not hold: ');
  if (granted.length + removed.length === 0) return `Refused: ${detail}.`;
  const would = [
    ...(granted.length === 0 ? [] : [`hand out ${andList(granted)}`]),
    ...(removed.length === 0
      ? []
      : [`take ${andList(removed)} from whoever holds it through here`]),
  ];
  const tail =
    granted.length + removed.length > 1
      ? 'none of which you hold yourself'
      : 'which you do not hold yourself';
  return `Refused: it would ${would.join(' and ')}, ${tail}.`;
}

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

export function holdingNote(carrier: Holding | null, held?: Held): string | null {
  if (carrier !== null) return `Carried by ${holdingLabel(carrier)}.`;
  if (held === undefined || held.through.length === 0) return null;
  return `${held.direct ? 'Also held' : 'Held'} ${held.through.join(', ')}.`;
}

export interface HoldingOption {
  id: Holding;
  label: string;
  description: string;
  note: string | null;
  unavailable: string | null;
}

// Every holding a tenant offers, each with what carries it already and why
// it cannot be given or taken: the caller's ceiling first, then `guard`.
export function holdingOptions(
  tenant: string,
  chosen: readonly string[],
  caller: readonly AdminCapability[] | undefined,
  extra: {
    held?: ReadonlyMap<Holding, Held>;
    guard?: (holding: Holding) => string | null;
  } = {},
): HoldingOption[] {
  return holdingsIn(tenant).map((holding) => ({
    id: holding,
    label: holdingLabel(holding),
    description: holding === TENANT_ADMIN ? fullText(tenant) : CAPABILITY_TEXT[holding],
    note: holdingNote(includedBy(holding, chosen), extra.held?.get(holding)),
    unavailable:
      (caller === undefined ? null : ceilingOf(tenant, holding, caller)) ??
      extra.guard?.(holding) ??
      null,
  }));
}
