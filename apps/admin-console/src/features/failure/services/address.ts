import { CONSOLE_ROOT, tenantPage } from '#/shared/services/address';
import { isTenantName } from '#/shared/services/principal';

// A tenant's overview, or the console's own root where no tenant is in the
// address (or the one there is no tenant's name).
export function overviewAddress(tenant: string | undefined): string {
  return tenant !== undefined && isTenantName(tenant) ? tenantPage(tenant) : CONSOLE_ROOT;
}
