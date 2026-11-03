import { z } from 'zod';
import { segment } from '#/shared/adapter/route';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';

// The gateway's mirror of a tenant's discovery document has no contract in
// @odudu/contracts, so it is held only to what the pages read.
export const discoverySchema = z.looseObject({ issuer: z.string() });

export function readDiscovery(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<z.infer<typeof discoverySchema>>> {
  return gateway.request('GET', `tenants/${segment(tenant)}/discovery`, {
    schema: discoverySchema,
  });
}
