import { type EffectiveRoleAssignment, type RoleProvenance } from '@odudu/contracts/admin';
import { TENANT_ADMIN } from '#/shared/service/administrators.ts';
import type { AdminCapability } from '#/shared/service/principal.ts';
import {
  ADMIN_CLIENT_KEY,
  CAPABILITY_TEXT,
  type Holding,
  fullText,
  grantableIn,
  holdingLabel,
  holdingsIn,
  includedBy,
  isAdminRole,
  isCapability,
  isHolding,
} from '#/shared/service/capabilities/holdings.ts';

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
