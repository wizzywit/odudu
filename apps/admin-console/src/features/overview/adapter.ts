import {
  countResponseSchema,
  MAX_LIMIT,
  type CountResponse,
  type SigningKey,
} from '@odudu/contracts/admin';
import type { AuditEvent } from '#/entities/audit-event';
import { z } from 'zod';
import type { Jwks } from '#/features/overview/services/discovery';
import type { Collection } from '#/features/overview/services/reads';
import { readAuditPage } from '#/shared/adapter/audit';
import { readKeyPage } from '#/shared/adapter/directory';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, segment } from '#/shared/adapter/route';

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

// A tenant holds a handful of keys; this bounds a cursor that never ends.
const MAX_KEY_PAGES = 10;
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

// A defect is logged where it is found, as the gateway logs its own.
function logDefect(message: string): void {
  console.error(message);
}

export async function readKeys(
  gateway: Gateway,
  tenant: string,
  log: (message: string) => void = logDefect,
): Promise<GatewayResult<readonly SigningKey[]>> {
  const keys: SigningKey[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_KEY_PAGES; page += 1) {
    const query = new URLSearchParams({ limit: String(MAX_LIMIT) });
    if (cursor !== undefined) query.set('cursor', cursor);
    const result = await readKeyPage(gateway, tenant, query);
    if (!result.ok) return result;
    keys.push(...result.data.items);
    cursor = result.data.next;
    if (cursor === undefined) return { ...result, data: keys };
  }
  log(
    `console defect: GET keys of ${tenant} still had a next page after ${String(MAX_KEY_PAGES)} pages`,
  );
  return { ok: false, kind: 'defect' };
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
