import { describe, expect, it } from 'vitest';
import type { Holding } from '#/shared/services/capabilities';
import {
  capabilitiesRemoveTenants,
  reachesEveryTenant,
} from '#/features/subjects/services/tenantReach';

describe('reaching every tenant', () => {
  it('takes manage-tenants away only in system, when none of what carries it is kept', () => {
    const take = (tenant: string, base: Holding[], chosen: string[], kept: boolean) =>
      capabilitiesRemoveTenants(tenant, base, chosen, kept);
    expect(take('system', ['tenant-admin'], [], false)).toBe(true);
    expect(take('system', ['manage-tenants'], ['view-audit'], false)).toBe(true);
    expect(take('system', ['tenant-admin'], ['manage-tenants'], false)).toBe(false);
    expect(take('system', ['tenant-admin'], [], true)).toBe(false);
    expect(take('acme', ['tenant-admin'], [], false)).toBe(false);
    expect(take('system', ['view-audit'], [], false)).toBe(false);
  });

  it('reaches every tenant from system by manage-tenants or Full, and from nowhere else', () => {
    const held = (name: string) => [{ name, direct: true }] as never;
    expect(reachesEveryTenant('system', held('manage-tenants'))).toBe(true);
    expect(reachesEveryTenant('system', held('tenant-admin'))).toBe(true);
    expect(reachesEveryTenant('system', held('view-audit'))).toBe(false);
    expect(reachesEveryTenant('acme', held('manage-tenants'))).toBe(false);
  });
});
