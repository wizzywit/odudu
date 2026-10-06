import {
  clientInstallationSchema,
  countResponseSchema,
  evaluateClaimsResponseSchema,
  listLogoutDeliveriesResponseSchema,
  listTenantSessionsResponseSchema,
  revokeClientGrantsResponseSchema,
  type ClientInstallation,
  type CountResponse,
  type EvaluateClaimsResponse,
  type ListLogoutDeliveriesResponse,
  type ListTenantSessionsResponse,
  type RevokeClientGrantsResponse,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

export function readClientSessions(
  gateway: Gateway,
  tenant: string,
  clientDbId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListTenantSessionsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(clientDbId);
  return gateway.request('GET', `admin/tenants/${t}/clients/${id}/sessions?${query.toString()}`, {
    schema: listTenantSessionsResponseSchema,
  });
}

// The sessions holding a grant through the client, bounded by the count's own cap.
export function readClientSessionCount(
  gateway: Gateway,
  tenant: string,
  clientDbId: string,
): Promise<GatewayResult<CountResponse>> {
  const t = encodeURIComponent(tenant);
  const query = new URLSearchParams({ client: clientDbId });
  return gateway.request('GET', `admin/tenants/${t}/sessions/count?${query.toString()}`, {
    schema: countResponseSchema,
  });
}

// At most 10,000 grants per call: `remaining` says whether to call again.
export function revokeClientGrants(
  gateway: Gateway,
  tenant: string,
  clientDbId: string,
): Promise<GatewayResult<RevokeClientGrantsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(clientDbId);
  return gateway.request('DELETE', `admin/tenants/${t}/clients/${id}/grants`, {
    schema: revokeClientGrantsResponseSchema,
  });
}

export function readLogoutDeliveries(
  gateway: Gateway,
  tenant: string,
  clientDbId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListLogoutDeliveriesResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(clientDbId);
  return gateway.request(
    'GET',
    `admin/tenants/${t}/clients/${id}/logout-deliveries?${query.toString()}`,
    { schema: listLogoutDeliveriesResponseSchema },
  );
}

export function readInstallation(
  gateway: Gateway,
  tenant: string,
  clientDbId: string,
): Promise<GatewayResult<ClientInstallation>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(clientDbId);
  return gateway.request('GET', `admin/tenants/${t}/clients/${id}/installation`, {
    schema: clientInstallationSchema,
  });
}

// The claims a request for `subject` and `scope` would be issued, signing nothing.
export function evaluateClaims(
  gateway: Gateway,
  tenant: string,
  clientDbId: string,
  request: { subject: string; scope: string },
): Promise<GatewayResult<EvaluateClaimsResponse>> {
  const t = encodeURIComponent(tenant);
  const id = encodeURIComponent(clientDbId);
  const query = new URLSearchParams({ subject: request.subject });
  if (request.scope.trim() !== '') query.set('scope', request.scope.trim());
  return gateway.request('GET', `admin/tenants/${t}/clients/${id}/evaluate?${query.toString()}`, {
    schema: evaluateClaimsResponseSchema,
  });
}
