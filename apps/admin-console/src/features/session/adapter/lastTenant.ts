import { isTenantName } from '#/features/session/services/address';
import { browserStorage } from '#/shared/adapter/browserStorage';

const KEY = 'odudu.console.tenant';

export function loadLastTenant(): string | null {
  try {
    const stored = browserStorage('local')?.getItem(KEY) ?? null;
    return stored !== null && isTenantName(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeLastTenant(tenant: string): void {
  try {
    browserStorage('local')?.setItem(KEY, tenant);
  } catch {
    // Unremembered, the next visit asks which tenant.
  }
}
