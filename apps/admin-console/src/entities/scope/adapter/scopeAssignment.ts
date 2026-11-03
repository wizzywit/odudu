import { assignScopeToClientResponseSchema } from '@odudu/contracts/admin';
import type { AssignedScopes } from '#/entities/scope/types/scope';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, nothing } from '#/shared/adapter/route';

// Answers the client's scopes alone, which is all `manage-tenant` may be told of it.
export function assignScope(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  clientDbId: string,
  assignment: 'default' | 'optional',
): Promise<GatewayResult<AssignedScopes>> {
  return adminCall(gateway, 'PUT', tenant, ['scopes', scopeId, 'clients', clientDbId], {
    body: { assignment },
    schema: assignScopeToClientResponseSchema,
  });
}

export function unassignScope(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  clientDbId: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['scopes', scopeId, 'clients', clientDbId], {
    schema: nothing,
  });
}
