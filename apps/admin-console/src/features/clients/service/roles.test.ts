import { describe, expect, it } from 'vitest';
import { clientRolesListHref, rolesReadable } from '#/features/clients/service/roles.ts';

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
