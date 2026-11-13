import {
  flowSchema,
  listFlowsResponseSchema,
  type FlowWire,
  type ListFlowsResponse,
  type SaveFlowRequest,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { adminCall, nothing } from '#/shared/api/adapter/route';

// A tenant holds at most as many flows as one read answers, so there is no next page.
export function readFlows(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ListFlowsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['flows'], { schema: listFlowsResponseSchema });
}

export function readFlowById(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<FlowWire>> {
  return adminCall(gateway, 'GET', tenant, ['flows', id], { schema: flowSchema });
}

export function createFlow(
  gateway: Gateway,
  tenant: string,
  body: SaveFlowRequest,
): Promise<GatewayResult<FlowWire>> {
  return adminCall(gateway, 'POST', tenant, ['flows'], { body, schema: flowSchema });
}

// The name and the steps replace the flow's own, on the ETag it was read with.
export function replaceFlowById(
  gateway: Gateway,
  tenant: string,
  id: string,
  body: SaveFlowRequest,
  ifMatch: string,
): Promise<GatewayResult<FlowWire>> {
  return adminCall(gateway, 'PUT', tenant, ['flows', id], { body, ifMatch, schema: flowSchema });
}

export function deleteFlow(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['flows', id], { schema: nothing });
}

// For a creation whose answer was lost: the flow of that name, if the tenant has it.
export async function findFlow(
  gateway: Gateway,
  tenant: string,
  name: string,
): Promise<GatewayResult<FlowWire | null>> {
  const result = await readFlows(gateway, tenant);
  if (!result.ok) return result;
  return { ...result, data: result.data.items.find((flow) => flow.name === name) ?? null };
}
