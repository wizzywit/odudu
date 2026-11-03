import {
  listExecutionsResponseSchema,
  type ListExecutionsResponse,
  type ReplaceExecutionsRequest,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall } from '#/shared/adapter/route';

export function readFlow(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ListExecutionsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['flow', 'executions'], {
    schema: listExecutionsResponseSchema,
  });
}

// The whole list replaces the flow, in the order it is given, on the ETag it was read with.
export function replaceFlow(
  gateway: Gateway,
  tenant: string,
  steps: ReplaceExecutionsRequest,
  ifMatch: string,
): Promise<GatewayResult<ListExecutionsResponse>> {
  return adminCall(gateway, 'PUT', tenant, ['flow', 'executions'], {
    body: steps,
    ifMatch,
    schema: listExecutionsResponseSchema,
  });
}
