import { signingKeySchema, type SigningKey, type SigningKeyAlg } from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, nothing } from '#/shared/adapter/route';

export function stageKey(
  gateway: Gateway,
  tenant: string,
  alg: SigningKeyAlg,
): Promise<GatewayResult<SigningKey>> {
  return adminCall(gateway, 'POST', tenant, ['keys'], {
    body: { alg },
    schema: signingKeySchema,
  });
}

export function promoteKey(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<SigningKey>> {
  return adminCall(gateway, 'POST', tenant, ['keys', id, 'promote'], { schema: signingKeySchema });
}

export function retireKey(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<SigningKey>> {
  return adminCall(gateway, 'POST', tenant, ['keys', id, 'retire'], { schema: signingKeySchema });
}

export function deleteKey(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['keys', id], { schema: nothing });
}
