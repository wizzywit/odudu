import { describe, expect, it } from 'vitest';
import {
  clientRolesListHref,
  roleOwnerLine,
  rolesReadable,
} from '#/pages/clients/services/clientRoles';

describe('rolesReadable', () => {
  it('admits manage-tenant, and view-users that manage-users carries', () => {
    expect(rolesReadable({ capabilities: ['manage-tenant'], crossTenant: false })).toBe(true);
    expect(rolesReadable({ capabilities: ['view-users'], crossTenant: false })).toBe(true);
  });

  it('rules out a caller holding neither, and rules out nobody before whoami answers', () => {
    expect(rolesReadable({ capabilities: ['manage-clients'], crossTenant: false })).toBe(false);
    expect(rolesReadable(undefined)).toBe(true);
  });
});

it("narrows the roles list to the client's own by its row id", () => {
  expect(clientRolesListHref('/console/acme/roles', 'c1')).toBe('/console/acme/roles?client=c1');
});

it('says whose a role is, a tenant role by that name and a client role by its key', () => {
  expect(roleOwnerLine(null)).toBe('tenant role');
  expect(roleOwnerLine('portal')).toBe('Scoped to portal.');
});
