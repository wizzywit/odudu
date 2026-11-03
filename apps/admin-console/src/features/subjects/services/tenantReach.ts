import { type HeldAdminCapability } from '@odudu/contracts/admin';
import { MANAGE_TENANTS, TENANT_ADMIN } from '#/shared/services/administrators';
import { SYSTEM_TENANT } from '#/shared/services/principal';

export function capabilitiesRemoveTenants(
  tenant: string,
  base: readonly string[],
  chosen: readonly string[],
  kept: boolean,
): boolean {
  const reaches = (holdings: readonly string[]): boolean =>
    holdings.some((holding) => holding === TENANT_ADMIN || holding === MANAGE_TENANTS);
  return tenant === SYSTEM_TENANT && reaches(base) && !reaches(chosen) && !kept;
}

// manage-tenants, which in system reaches every other tenant.
export function reachesEveryTenant(
  tenant: string,
  held: readonly Pick<HeldAdminCapability, 'name'>[],
): boolean {
  return (
    tenant === SYSTEM_TENANT &&
    held.some((each) => each.name === MANAGE_TENANTS || each.name === TENANT_ADMIN)
  );
}
