import type { Settings } from '@odudu/contracts/admin';
import type { RecordState } from '#/shared/repository/useRecord';
import { useTenantSettings } from '#/shared/repository/useTenantSettings';

// The tenant's settings record for a page that shows or edits one of them.
// `recent` keeps a read another part of the page started a moment before.
export function useTenantSettingsRead(tenant: string, recent = false): RecordState<Settings> {
  return useTenantSettings(tenant, { recent });
}
