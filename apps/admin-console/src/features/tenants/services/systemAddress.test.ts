import { describe, expect, it } from 'vitest';
import {
  IMPORT_TENANT_HREF,
  NEW_TENANT_HREF,
  systemAdminsHrefOf,
  tenantHref,
} from '#/features/tenants/services/systemAddress';

describe('the addresses', () => {
  it('puts creation and import beside the list, so no tenant name shadows them', () => {
    expect(tenantHref('new')).toBe('/console/system/tenants/new');
    expect(NEW_TENANT_HREF).toBe('/console/system/new-tenant');
    expect(IMPORT_TENANT_HREF).toBe('/console/system/import-tenant');
  });
});

describe('the guided administrator step', () => {
  it('names where the system administrators are managed, for system alone', () => {
    expect(systemAdminsHrefOf('system')).toBe('/console/system/system-admins');
    expect(systemAdminsHrefOf('acme')).toBeNull();
  });
});
