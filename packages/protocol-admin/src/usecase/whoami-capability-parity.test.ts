import { ADMIN_CAPABILITIES } from '@odudu/contracts/admin';
import { MANAGE_TENANTS, TENANT_CAPABILITIES } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';

describe('the wire capability enum matches @odudu/domain-tenant’s vocabulary', () => {
  it('lists exactly the tenant capabilities plus manage-tenants', () => {
    expect([...ADMIN_CAPABILITIES].sort()).toEqual([...TENANT_CAPABILITIES, MANAGE_TENANTS].sort());
  });
});
