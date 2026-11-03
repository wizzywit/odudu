import { storedCreation } from '#/entities/creation-draft';
import { draftOwner, usePrincipal } from '#/entities/session';
import { administratorTitle } from '#/pages/tenants/services/administratorOrigin';
import { titleOrigin } from '#/pages/tenants/services/administratorOrigin';

// Read before access is checked, so the header matches the page it becomes.
export function useAdministratorTitle(tenant: string): string {
  const principal = usePrincipal();
  const stored = storedCreation(draftOwner(principal), tenant);
  return administratorTitle(tenant, titleOrigin(stored));
}
