import { describe, expect, it } from 'vitest';
import { newRoleHref, roleHref, rolesHref, rolesTrail } from '#/entities/role/services/roleAddress';

describe('addresses', () => {
  it('puts a role, and a new one, under its tenant', () => {
    expect(rolesHref('acme')).toBe('/console/acme/roles');
    expect(roleHref('acme', 'r 1')).toBe('/console/acme/roles/r%201');
    expect(newRoleHref('acme')).toBe('/console/acme/roles/new');
    expect(rolesTrail('acme', 'auditor')).toEqual([
      { label: 'Identity' },
      { label: 'Roles', href: '/console/acme/roles' },
      { label: 'auditor' },
    ]);
  });
});
