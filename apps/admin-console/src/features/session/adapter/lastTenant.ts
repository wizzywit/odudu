import { isTenantName } from '#/features/session/service';

const KEY = 'odudu.console.tenant';

// Only a convenience for the next visit, so storage that refuses, even at
// the getter, means nothing is remembered and nothing breaks.
function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadLastTenant(): string | null {
  try {
    const stored = storage()?.getItem(KEY) ?? null;
    return stored !== null && isTenantName(stored) ? stored : null;
  } catch {
    return null;
  }
}

export function storeLastTenant(tenant: string): void {
  try {
    storage()?.setItem(KEY, tenant);
  } catch {
    // Unremembered, the next visit asks which tenant.
  }
}
