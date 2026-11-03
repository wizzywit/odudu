import { clearLockoutsResponseSchema, type ClearLockoutsResponse } from '@odudu/contracts/admin';
import { adminCall } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';

// At most 10,000 accounts per call: `remaining` says whether to call again.
export function clearTenantLockouts(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ClearLockoutsResponse>> {
  return adminCall(gateway, 'DELETE', tenant, ['lockouts'], {
    schema: clearLockoutsResponseSchema,
  });
}
