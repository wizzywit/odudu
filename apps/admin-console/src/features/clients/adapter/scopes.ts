import {
  assignScopeToClientResponseSchema,
  type AssignScopeToClientResponse,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

const nothing = z.undefined();

// Answers the client's scopes alone, which is all `manage-tenant` may be told of it.
export function assignScope(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  clientDbId: string,
  assignment: 'default' | 'optional',
): Promise<GatewayResult<AssignScopeToClientResponse>> {
  const t = encodeURIComponent(tenant);
  const scope = encodeURIComponent(scopeId);
  const client = encodeURIComponent(clientDbId);
  return gateway.request('PUT', `admin/tenants/${t}/scopes/${scope}/clients/${client}`, {
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
  const t = encodeURIComponent(tenant);
  const scope = encodeURIComponent(scopeId);
  const client = encodeURIComponent(clientDbId);
  return gateway.request('DELETE', `admin/tenants/${t}/scopes/${scope}/clients/${client}`, {
    schema: nothing,
  });
}
