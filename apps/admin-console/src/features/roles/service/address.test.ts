import { describe, expect, it } from 'vitest';
import {
  copyHref,
  newRoleHref,
  roleHref,
  rolesHref,
  rolesTrail,
} from '#/features/roles/service/address.ts';

describe('addresses', () => {
  it('puts a role under its tenant, and a copy beside a new one', () => {
    expect(rolesHref('acme')).toBe('/console/acme/roles');
    expect(roleHref('acme', 'r 1')).toBe('/console/acme/roles/r%201');
    expect(newRoleHref('acme')).toBe('/console/acme/roles/new');
    expect(copyHref('acme', 'r-aud')).toBe('/console/acme/roles/new?copy=r-aud');
    expect(rolesTrail('acme', 'auditor')).toEqual([
      { label: 'Identity' },
      { label: 'Roles', href: '/console/acme/roles' },
      { label: 'auditor' },
    ]);
  });
});
