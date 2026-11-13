import { listFlowsResponseSchema, type ListFlowsResponse } from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { adminCall } from '#/shared/api/adapter/route';

// A tenant holds at most as many flows as one read answers, so there is no next page.
export function readFlows(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ListFlowsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['flows'], { schema: listFlowsResponseSchema });
}
