import { settingsSchema, type AmendSettingsRequest, type Settings } from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall } from '#/shared/adapter/route';

export function readTenantSettings(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<Settings>> {
  return adminCall(gateway, 'GET', tenant, ['settings'], {
    schema: settingsSchema,
  });
}

// The answer is every setting again, with the ETag that now stands for them all.
export function amendTenantSettings(
  gateway: Gateway,
  tenant: string,
  changes: AmendSettingsRequest,
  ifMatch: string,
): Promise<GatewayResult<Settings>> {
  return adminCall(gateway, 'PATCH', tenant, ['settings'], {
    body: changes,
    ifMatch,
    schema: settingsSchema,
  });
}
