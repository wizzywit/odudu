import { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';
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

export function isCapability(name: string): name is AdminCapability {
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
