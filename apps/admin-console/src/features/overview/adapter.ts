import {
  countResponseSchema,
  listKeysResponseSchema,
  settingsSchema,
  smtpConfigSchema,
  type AuditEvent,
  type CountResponse,
  type Settings,
  type SigningKey,
  type SmtpConfig,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import type { Discovery, Jwks } from '#/features/overview/service.ts';
import { readAuditPage } from '#/shared/adapter/audit.ts';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

// The gateway's mirrors of the tenant's public documents have no contract
// in @odudu/contracts, so these hold them only to what the page reads and
// keep every other member for the raw view.
const discoverySchema = z.looseObject({ issuer: z.string() });
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

const KEY_PAGE = 200;
// A tenant holds a handful of keys; this bounds a cursor that never ends.
const MAX_KEY_PAGES = 10;
const LATEST_AUDIT = 5;

export type Collection = 'subjects' | 'clients' | 'groups' | 'roles' | 'scopes';

function tenantPath(tenant: string): string {
  return encodeURIComponent(tenant);
}

export function readDiscovery(gateway: Gateway, tenant: string): Promise<GatewayResult<Discovery>> {
  return gateway.request('GET', `tenants/${tenantPath(tenant)}/discovery`, {
    schema: discoverySchema,
  });
}

export function readJwks(gateway: Gateway, tenant: string): Promise<GatewayResult<Jwks>> {
  return gateway.request('GET', `tenants/${tenantPath(tenant)}/jwks`, { schema: jwksSchema });
}

// One literal path per collection, so each route is named where it is called.
export function readCount(
  gateway: Gateway,
  tenant: string,
  collection: Collection,
): Promise<GatewayResult<CountResponse>> {
  const t = tenantPath(tenant);
  const options = { schema: countResponseSchema };
  switch (collection) {
    case 'subjects':
      return gateway.request('GET', `admin/tenants/${t}/subjects/count`, options);
    case 'clients':
      return gateway.request('GET', `admin/tenants/${t}/clients/count`, options);
    case 'groups':
      return gateway.request('GET', `admin/tenants/${t}/groups/count`, options);
    case 'roles':
      return gateway.request('GET', `admin/tenants/${t}/roles/count`, options);
    case 'scopes':
      return gateway.request('GET', `admin/tenants/${t}/scopes/count`, options);
  }
}

export function readSettings(gateway: Gateway, tenant: string): Promise<GatewayResult<Settings>> {
  return gateway.request('GET', `admin/tenants/${tenantPath(tenant)}/settings`, {
    schema: settingsSchema,
  });
}

export function readSmtp(gateway: Gateway, tenant: string): Promise<GatewayResult<SmtpConfig>> {
  return gateway.request('GET', `admin/tenants/${tenantPath(tenant)}/smtp`, {
    schema: smtpConfigSchema,
  });
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
    const query = new URLSearchParams({ limit: String(KEY_PAGE) });
    if (cursor !== undefined) query.set('cursor', cursor);
    const result = await gateway.request(
      'GET',
      `admin/tenants/${tenantPath(tenant)}/keys?${query.toString()}`,
      { schema: listKeysResponseSchema },
    );
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
