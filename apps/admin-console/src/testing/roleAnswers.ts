import { ADMIN_CAPABILITIES, type EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { ADMIN_CLIENT_KEY } from '#/shared/services/capabilities';
import type { AdminCapability } from '#/shared/services/principal';

export const EVERY_TENANT_CAPABILITY: AdminCapability[] = [
  'view-users',
  'manage-users',
  'manage-tenant',
  'manage-clients',
  'manage-keys',
  'manage-sessions',
  'view-audit',
];

export function role(
  id: string,
  name: string,
  clientKey: string | null = null,
  reach: AdminCapability[] = reachOf(name, clientKey),
) {
  return {
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `c-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
    admin_reach: reach,
  };
}

// What a built-in capability reaches: itself, and view-users with manage-users;
// tenant-admin reaches every capability of an ordinary tenant.
function reachOf(name: string, clientKey: string | null): AdminCapability[] {
  if (clientKey !== 'odudu-admin') return [];
  if (name === 'tenant-admin') return EVERY_TENANT_CAPABILITY;
  return name === 'manage-users'
    ? ['view-users', 'manage-users']
    : ADMIN_CAPABILITIES.filter((each) => each === name);
}

// The built-in admin client's roles, as the role list answers them.
export const ADMIN_ROLES = [
  role('r-full', 'tenant-admin', 'odudu-admin'),
  ...EVERY_TENANT_CAPABILITY.map((name) => role(`r-${name}`, name, 'odudu-admin')),
];

// A role of the built-in admin client as its own client id names it, holding no reach.
export function adminClientRole(id: string, name: string) {
  return {
    id,
    name,
    description: null,
    client_id: 'c-admin',
    client_key: 'odudu-admin',
    default_for_new_subjects: false,
    admin_reach: [],
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

// A role as the effective-roles answer carries it, with how the subject comes to hold it.
export function effectiveRole(
  name: string,
  via: EffectiveRoleAssignment['via'],
  clientKey: string | null = ADMIN_CLIENT_KEY,
): EffectiveRoleAssignment {
  return {
    id: `r-${name}`,
    name,
    client_id: clientKey === null ? null : 'c-admin',
    client_key: clientKey,
    via,
  };
}

export function reach(...capabilities: AdminCapability[]): AdminCapability[] {
  return capabilities;
}
