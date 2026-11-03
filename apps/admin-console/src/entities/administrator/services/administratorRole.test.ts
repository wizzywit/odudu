import { describe, expect, it } from 'vitest';
import {
  builtinAdminClient,
  tenantAdminRole,
  withRole,
} from '#/entities/administrator/services/administratorRole';

describe('the tenant-admin role', () => {
  it('is the role named tenant-admin on the built-in odudu-admin client, and no other', () => {
    const clients = [
      { id: 'c-own', client_id: 'odudu-admin-copy', builtin_admin: false },
      { id: 'c-builtin', client_id: 'odudu-admin', builtin_admin: true },
    ];
    expect(builtinAdminClient(clients)).toBe('c-builtin');
    expect(builtinAdminClient(clients.slice(0, 1))).toBeNull();
    const roles = [
      { id: 'r-other', name: 'tenant-admin-x', client_id: 'c-builtin' },
      { id: 'r-own', name: 'tenant-admin', client_id: 'c-own' },
      { id: 'r-admin', name: 'tenant-admin', client_id: 'c-builtin' },
    ];
    expect(tenantAdminRole(roles, 'c-builtin')).toBe('r-admin');
    expect(tenantAdminRole(roles.slice(0, 2), 'c-builtin')).toBeNull();
  });

  it('is added to the roles a subject already holds, once', () => {
    expect(withRole(['r1'], 'r-admin')).toEqual(['r1', 'r-admin']);
    expect(withRole(['r-admin', 'r1'], 'r-admin')).toEqual(['r-admin', 'r1']);
  });
});
