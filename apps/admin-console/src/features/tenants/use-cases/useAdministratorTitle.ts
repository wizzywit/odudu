import { draftOwner, usePrincipal } from '#/entities/session';
import { storedCreation } from '#/features/tenants/repository/useCreation';
import { administratorTitle } from '#/features/tenants/services/address';
import { titleOrigin } from '#/features/tenants/services/administratorOrigin';

// Read before access is checked, so the header matches the page it becomes.
export function useAdministratorTitle(tenant: string): string {
  const principal = usePrincipal();
  const stored = storedCreation(draftOwner(principal), tenant);
  return administratorTitle(tenant, titleOrigin(stored));
}
