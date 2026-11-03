import {
  listRegistrationTokensResponseSchema,
  mintRegistrationTokenResponseSchema,
  type MintRegistrationTokenResponse,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, listReader, nothing } from '#/shared/adapter/route';

export const readTokenPage = listReader(
  'registration-tokens',
  listRegistrationTokensResponseSchema,
);

export function mintToken(
  gateway: Gateway,
  tenant: string,
  input: { uses: number; ttl_seconds: number },
): Promise<GatewayResult<MintRegistrationTokenResponse>> {
  return adminCall(gateway, 'POST', tenant, ['registration-tokens'], {
    body: input,
    schema: mintRegistrationTokenResponseSchema,
  });
}

export function revokeToken(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['registration-tokens', id], {
    schema: nothing,
  });
}
