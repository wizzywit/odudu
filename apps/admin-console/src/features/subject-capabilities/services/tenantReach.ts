import type { HeldAdminCapability } from '#/shared/lib/types/capabilities';
import { SYSTEM_TENANT } from '#/shared/lib/services/principal';
import { carriesTenantReach } from '#/shared/lib/services/capabilities';

export function capabilitiesRemoveTenants(
  tenant: string,
  base: readonly string[],
  chosen: readonly string[],
  kept: boolean,
): boolean {
  const reaches = (holdings: readonly string[]): boolean => holdings.some(carriesTenantReach);
  return tenant === SYSTEM_TENANT && reaches(base) && !reaches(chosen) && !kept;
}

// manage-tenants, which in system reaches every other tenant.
export function reachesEveryTenant(
  tenant: string,
  held: readonly Pick<HeldAdminCapability, 'name'>[],
): boolean {
  return tenant === SYSTEM_TENANT && held.some((each) => carriesTenantReach(each.name));
}
