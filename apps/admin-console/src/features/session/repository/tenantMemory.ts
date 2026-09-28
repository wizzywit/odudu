import { loadLastTenant, storeLastTenant } from '#/features/session/adapter/lastTenant.ts';

// Remembered only once a session proves the tenant, so a mistyped name never
// becomes the next visit's suggestion.
export function readLastTenant(): string | null {
  return loadLastTenant();
}

export function rememberLastTenant(tenant: string): void {
  storeLastTenant(tenant);
}
