import { type EffectiveRoleAssignment, type RoleProvenance } from '@odudu/contracts/admin';
import { andList } from '#/shared/services/format';
import type { AdminCapability } from '#/shared/services/principal';
import {
  ADMIN_CLIENT_KEY,
  CAPABILITY_TEXT,
  TENANT_ADMIN,
  type Holding,
  fullText,
  grantableIn,
  holdingLabel,
  holdingsIn,
  includedBy,
  isAdminRole,
  isCapability,
  isHolding,
} from '#/shared/services/capabilities/holdings';

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

export function provenanceListText(via: readonly RoleProvenance[]): string {
  return via.map(provenanceText).join(', ');
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

// Why a caller cannot give or take a role: it is, or reaches, authority the
// caller does not hold (ADR 0040). Null when it can.
export function roleReachUnavailable(
  role: { name: string; client_key: string | null; admin_reach: readonly string[] },
  caller: readonly AdminCapability[],
  tenant: string,
): string | null {
  if (isAdminRole(role) && isHolding(role.name)) return ceilingOf(tenant, role.name, caller);
  const beyond = beyondCaller(role.admin_reach, caller);
  return beyond.length === 0
    ? null
    : `It reaches ${andList(beyond)}, which you do not hold, so you cannot give or take it.`;
}

// What a role or group that every new subject receives may not carry, which
// is all it reaches: nothing at all when it is not, and will not become, one.
export function blockedByDefault(isDefault: boolean, reach: readonly string[]): readonly string[] {
  return isDefault ? reach : [];
}

export const TENANT_ROLE_TEXT = 'tenant role';

// Whose a role is, in words: a client's role reaches a token under its
// client's name, and the built-in admin client's roles are the capabilities.
export function roleOwnerText(role: {
  client_id: string | null;
  client_key: string | null;
}): string {
  if (role.client_id === null) return TENANT_ROLE_TEXT;
  return role.client_key === ADMIN_CLIENT_KEY
    ? 'admin capability'
    : `role of client ${role.client_key ?? role.client_id}`;
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
