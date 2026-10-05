import { usePrincipal } from '#/features/session';
import { storedCreation } from '#/features/tenants/repository/useCreation.ts';
import { administratorTitle } from '#/features/tenants/service.ts';

// Read before access is checked, so the header matches the page it becomes.
export function useAdministratorTitle(tenant: string): string {
  const principal = usePrincipal();
  const stored = storedCreation(`${principal.tenant}/${principal.subjectId}`, tenant);
  return administratorTitle(tenant, stored?.step === 'administrator' ? stored.origin : 'existing');
}
