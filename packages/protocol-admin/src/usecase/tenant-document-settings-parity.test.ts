import { REGISTRATION_POLICY_SETTINGS, tenantSettingsDocumentSchema } from '@odudu/contracts/admin';
import { TENANT_SETTING_NAMES } from '@odudu/domain-tenant';
import { describe, expect, it } from 'vitest';

describe('the exported settings match @odudu/domain-tenant’s settings', () => {
  it('names every tenant setting exactly once, under settings or registration_policy', () => {
    const exported = [
      ...Object.keys(tenantSettingsDocumentSchema.shape),
      ...REGISTRATION_POLICY_SETTINGS,
    ];

    expect(exported.sort()).toEqual([...TENANT_SETTING_NAMES].sort());
  });
});
