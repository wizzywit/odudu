import { recordAddress, SYSTEM_BASE } from '#/shared/services/address';
import { SYSTEM_TENANT } from '#/shared/services/principal';

// system's administrators are its system administrators, so their guided
// step sits under that area and the rail keeps the operator's place.
export function administratorStepHref(tenant: string): string {
  return tenant === SYSTEM_TENANT
    ? `${SYSTEM_BASE}/system-admins/new`
    : `${recordAddress(`${SYSTEM_BASE}/tenants`, tenant)}/new-administrator`;
}
