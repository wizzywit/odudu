import type { Role } from '@odudu/contracts/admin';
import { resourceAddress, withSearch } from '#/shared/services/address';

export type { Role };

const roles = resourceAddress({ segment: 'roles', group: 'Identity', label: 'Roles' });

export const {
  listHref: rolesHref,
  newHref: newRoleHref,
  recordHref: roleHref,
  trail: rolesTrail,
} = roles;

export function copyHref(tenant: string, id: string): string {
  return withSearch(newRoleHref(tenant), { copy: id });
}

// A copy is a tenant role, so only a tenant role offers one.
export function copyHrefOf(tenant: string, role: Role | undefined): string | null {
  return role?.client_id === null ? copyHref(tenant, role.id) : null;
}
