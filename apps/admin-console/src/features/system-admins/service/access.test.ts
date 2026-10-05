import { describe, expect, it } from 'vitest';
import { tenantAdminCarries } from '#/shared/service/administrators.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import { administratorsAccess } from '#/features/system-admins/service/access.ts';

const caller = (...capabilities: AdminCapability[]): Authority => ({
  capabilities,
  crossTenant: false,
});

describe('what the system administrators page needs', () => {
  it('asks nothing until whoami has answered', () => {
    expect(administratorsAccess(undefined)).toEqual({
      createNeeds: [],
      changeNeeds: [],
      blocked: null,
    });
  });

  it('is met by Full in system', () => {
    expect(administratorsAccess(caller(...tenantAdminCarries('system')))).toEqual({
      createNeeds: [],
      changeNeeds: [],
      blocked: null,
    });
  });

  it('names what creating and changing need, and says which changes are ruled out', () => {
    const access = administratorsAccess(caller('manage-tenants'));
    expect(access.createNeeds).toContain('manage-users');
    expect(access.changeNeeds).toEqual(['manage-users']);
    expect(access.blocked?.change).toBe('create them or change what they hold');
    expect(access.blocked?.needs).toContain('manage-clients');
  });
});
