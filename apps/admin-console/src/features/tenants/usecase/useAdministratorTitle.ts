import { draftOwner, usePrincipal } from '#/features/session';
import { storedCreation } from '#/features/tenants/repository/useCreation.ts';
import { administratorTitle, titleOrigin } from '#/features/tenants/service';

// Read before access is checked, so the header matches the page it becomes.
export function useAdministratorTitle(tenant: string): string {
  const principal = usePrincipal();
  const stored = storedCreation(draftOwner(principal), tenant);
  return administratorTitle(tenant, titleOrigin(stored));
}
