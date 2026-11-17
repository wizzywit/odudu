import { flowSchema, type FlowWire, type SaveFlowRequest } from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { adminCall, nothing } from '#/shared/api/adapter/route';

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
  ifMatch: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['flows', id], { ifMatch, schema: nothing });
}

// Bound to the flow version the administrator confirmed, never to a fresher one.
export function makeFlowDefault(
  gateway: Gateway,
  tenant: string,
  id: string,
  ifMatch: string,
): Promise<GatewayResult<FlowWire>> {
  return adminCall(gateway, 'POST', tenant, ['flows', id, 'make-default'], {
    ifMatch,
    schema: flowSchema,
  });
}
