import { resourceAddress } from '#/shared/lib/services/address';

const roles = resourceAddress({ segment: 'roles', group: 'Identity', label: 'Roles' });

export const {
  listHref: rolesHref,
  newHref: newRoleHref,
  recordHref: roleHref,
  trail: rolesTrail,
} = roles;
