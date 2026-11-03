import { type Role } from '@odudu/contracts/admin';
import { resourceAddress } from '#/shared/services/address';

export type { Role };

const roles = resourceAddress({ segment: 'roles', group: 'Identity', label: 'Roles' });

export const {
  listHref: rolesHref,
  newHref: newRoleHref,
  recordHref: roleHref,
  trail: rolesTrail,
} = roles;
