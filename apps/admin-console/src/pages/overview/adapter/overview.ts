import { countResponseSchema, type CountResponse } from '@odudu/contracts/admin';
import type { AuditEvent } from '#/entities/audit-event';
import { z } from 'zod';
import type { Collection, Jwks } from '#/pages/overview/types/overviewReads';
import { readAuditPage } from '#/entities/audit-event';
import type { Gateway, GatewayResult } from '#/shared/api/transport/gateway';
import { adminCall, segment } from '#/shared/api/adapter/route';

// The gateway's mirrors of the tenant's public documents have no contract
// in @odudu/contracts, so these hold them only to what the page reads and
// keep every other member for the raw view.
const jwksSchema = z.looseObject({
  keys: z.array(
    z.looseObject({
      kty: z.string(),
      kid: z.string().optional(),
      alg: z.string().optional(),
      use: z.string().optional(),
    }),
  ),
});

const LATEST_AUDIT = 5;

export function readJwks(gateway: Gateway, tenant: string): Promise<GatewayResult<Jwks>> {
  return gateway.request('GET', `tenants/${segment(tenant)}/jwks`, { schema: jwksSchema });
}

// One literal path per collection, so each route is named where it is called.
export function readCount(
  gateway: Gateway,
  tenant: string,
  collection: Collection,
): Promise<GatewayResult<CountResponse>> {
  const options = { schema: countResponseSchema };
  switch (collection) {
    case 'subjects':
      return adminCall(gateway, 'GET', tenant, ['subjects', 'count'], options);
    case 'clients':
      return adminCall(gateway, 'GET', tenant, ['clients', 'count'], options);
    case 'groups':
      return adminCall(gateway, 'GET', tenant, ['groups', 'count'], options);
    case 'roles':
      return adminCall(gateway, 'GET', tenant, ['roles', 'count'], options);
    case 'scopes':
      return adminCall(gateway, 'GET', tenant, ['scopes', 'count'], options);
  }
}

export async function readLatestAudit(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<readonly AuditEvent[]>> {
  const result = await readAuditPage(
    gateway,
    tenant,
    new URLSearchParams({ limit: String(LATEST_AUDIT) }),
  );
  return result.ok ? { ...result, data: result.data.items } : result;
}
