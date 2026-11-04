import {
  domainSchema,
  listDomainsResponseSchema,
  passkeyImpactResponseSchema,
  type Domain,
  type ListDomainsResponse,
  type PasskeyImpactResponse,
} from '@odudu/contracts/admin';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { adminCall, nothing } from '#/shared/api/adapter/route';

// The answer carries the ETag every switch of the tenant's address waits on.
export function readDomains(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<ListDomainsResponse>> {
  return adminCall(gateway, 'GET', tenant, ['domains'], { schema: listDomainsResponseSchema });
}

export function registerDomain(
  gateway: Gateway,
  tenant: string,
  host: string,
): Promise<GatewayResult<Domain>> {
  return adminCall(gateway, 'POST', tenant, ['domains'], {
    body: { host },
    schema: domainSchema,
  });
}

export function verifyDomain(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<Domain>> {
  return adminCall(gateway, 'POST', tenant, ['domains', id, 'verify'], { schema: domainSchema });
}

export function activateDomain(
  gateway: Gateway,
  tenant: string,
  id: string,
  ifMatch: string,
): Promise<GatewayResult<Domain>> {
  return adminCall(gateway, 'POST', tenant, ['domains', id, 'activate'], {
    ifMatch,
    schema: domainSchema,
  });
}

export function deactivateDomain(
  gateway: Gateway,
  tenant: string,
  id: string,
  ifMatch: string,
): Promise<GatewayResult<Domain>> {
  return adminCall(gateway, 'POST', tenant, ['domains', id, 'deactivate'], {
    ifMatch,
    schema: domainSchema,
  });
}

export function removeDomain(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['domains', id], { schema: nothing });
}

// `canonical` is `path`, or the host of one of the tenant's own domains.
export function readPasskeyImpact(
  gateway: Gateway,
  tenant: string,
  canonical: string,
): Promise<GatewayResult<PasskeyImpactResponse>> {
  return adminCall(gateway, 'GET', tenant, ['domains', 'passkey-impact'], {
    query: new URLSearchParams({ canonical }),
    schema: passkeyImpactResponseSchema,
  });
}
