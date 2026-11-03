import { useTenantSettings } from '#/entities/tenant/repository/useTenantSettings';
import { offeredLocales } from '#/entities/tenant/services/offeredLocales';
import { mapRead, recordRead, type Read } from '#/shared/services/read';

// The languages the tenant offers, for a field that holds text in each.
export function useOfferedLocales(tenant: string): Read<string[]> {
  return mapRead(recordRead(useTenantSettings(tenant)), offeredLocales);
}
