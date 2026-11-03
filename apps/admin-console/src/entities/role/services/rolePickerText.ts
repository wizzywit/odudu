import { roleOwnerShort, roleOwnerText } from '#/shared/services/capabilities';
import type { Role } from '#/entities/role/types/role';

// A client role is carried in a token under its client's name, so two roles
// of one name are told apart by their owner, spoken as well as shown.
function ownerKey(role: Pick<Role, 'client_id' | 'client_key'>): string | null {
  if (role.client_id === null) return null;
  return role.client_key ?? role.client_id;
}

export function roleDetail(role: Pick<Role, 'client_id' | 'client_key' | 'description'>): string {
  const owner = roleOwnerShort(ownerKey(role));
  return role.description === null || role.description === ''
    ? owner
    : `${owner} · ${role.description}`;
}

export function roleAccessibleName(role: Pick<Role, 'name' | 'client_id' | 'client_key'>): string {
  const owner = ownerKey(role);
  return owner === null ? `${role.name}, a tenant role` : `${role.name}, a role of client ${owner}`;
}

export function roleOwnerTag(role: Pick<Role, 'client_id' | 'client_key'>): string {
  return roleOwnerText(role);
}
