import { describe, expect, it } from 'vitest';
import { TENANT_TABS, tenantRecord } from '#/features/tenants/service/tabs.ts';

describe('the tenant record page', () => {
  it('keeps its tabs and its record name in one place', () => {
    expect(TENANT_TABS).toEqual(['general', 'administrators', 'export']);
    expect(tenantRecord('acme')).toBe('tenants/acme');
  });
});
