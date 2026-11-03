import type { Settings } from '#/entities/tenant/types/settings';
import { readTenantSettings } from '#/entities/tenant/adapter/tenantSettings';
import { useRecord, type RecordState } from '#/shared/lib/repository/useRecord';
import { TENANT_SETTINGS_RECORD } from '#/entities/tenant/services/tenantSettings';

export function useTenantSettings(
  tenant: string,
  { enabled = true, recent = false }: { enabled?: boolean; recent?: boolean } = {},
): RecordState<Settings> {
  return useRecord({
    tenant,
    record: TENANT_SETTINGS_RECORD,
    enabled,
    recent,
    read: (gateway) => readTenantSettings(gateway, tenant),
  });
}
