import { useTenantSettings } from '#/shared/repository/useTenantSettings';
import { offeredLocales } from '#/shared/service/offeredLocales';
import { mapRead, recordRead, type Read } from '#/shared/service/read';

// The languages the tenant offers, for a field that holds text in each.
export function useOfferedLocales(tenant: string): Read<string[]> {
  return mapRead(recordRead(useTenantSettings(tenant)), offeredLocales);
}
