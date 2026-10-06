import {
  clientSchema,
  countResponseSchema,
  createClientResponseSchema,
  listClientsResponseSchema,
  type Client,
  type CountResponse,
  type CreateClientResponse,
  type ListClientsResponse,
} from '@odudu/contracts/admin';
import { z } from 'zod';
import { entriesOf, type NewClientKind } from '#/features/clients/service';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway.ts';

const nothing = z.undefined();

function path(tenant: string): string {
  return encodeURIComponent(tenant);
}

function segment(id: string): string {
  return encodeURIComponent(id);
}

export function readClientPage(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<ListClientsResponse>> {
  return gateway.request('GET', `admin/tenants/${path(tenant)}/clients?${query.toString()}`, {
    schema: listClientsResponseSchema,
  });
}

export function readClientCount(
  gateway: Gateway,
  tenant: string,
  query: URLSearchParams,
): Promise<GatewayResult<CountResponse>> {
  return gateway.request('GET', `admin/tenants/${path(tenant)}/clients/count?${query.toString()}`, {
    schema: countResponseSchema,
  });
}

export interface NewClient {
  clientId: string;
  name: string;
  description: string;
  kind: NewClientKind;
  redirectUris: readonly string[];
}

// A public client authenticates with nothing; a confidential one starts on
// the method every relying party library speaks, and its Advanced tab changes
// it. A service takes the grant that signs nobody in, and so no redirect.
function kindFields(kind: NewClientKind, redirectUris: readonly string[]): Record<string, unknown> {
  switch (kind) {
    case 'public':
      return { token_endpoint_auth_method: 'none', redirect_uris: entriesOf(redirectUris) };
    case 'confidential':
      return {
        token_endpoint_auth_method: 'client_secret_basic',
        redirect_uris: entriesOf(redirectUris),
      };
    case 'service':
      return {
        token_endpoint_auth_method: 'client_secret_basic',
        grant_types: ['client_credentials'],
      };
  }
}

// The answer to a confidential client carries its secret, once.
export function createClient(
  gateway: Gateway,
  tenant: string,
  input: NewClient,
): Promise<GatewayResult<CreateClientResponse>> {
  return gateway.request('POST', `admin/tenants/${path(tenant)}/clients`, {
    body: {
      client_id: input.clientId,
      ...(input.name === '' ? {} : { name: input.name }),
      ...(input.description === '' ? {} : { description: input.description }),
      ...kindFields(input.kind, input.redirectUris),
    },
    schema: createClientResponseSchema,
  });
}

export function readClient(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<Client>> {
  return gateway.request('GET', `admin/tenants/${path(tenant)}/clients/${segment(id)}`, {
    schema: clientSchema,
  });
}

export interface ClientChanges {
  name?: string;
  description?: string;
  client_uri?: string;
  policy_uri?: string;
  tos_uri?: string;
  enabled?: boolean;
  consent_required?: boolean;
  redirect_uris?: readonly string[];
  web_origins?: readonly string[];
}

// The server keeps no empty description or page, so an emptied one is cleared.
const CLEARED = ['description', 'client_uri', 'policy_uri', 'tos_uri'] as const;
const LISTS = ['redirect_uris', 'web_origins'] as const;

function wireChanges(changes: ClientChanges): Record<string, unknown> {
  const body: Record<string, unknown> = { ...changes };
  for (const field of CLEARED) {
    if (changes[field] === '') body[field] = null;
  }
  for (const field of LISTS) {
    const rows = changes[field];
    if (rows !== undefined) body[field] = entriesOf(rows);
  }
  return body;
}

export function amendClient(
  gateway: Gateway,
  tenant: string,
  id: string,
  changes: ClientChanges,
  ifMatch: string,
): Promise<GatewayResult<Client>> {
  return gateway.request('PATCH', `admin/tenants/${path(tenant)}/clients/${segment(id)}`, {
    body: wireChanges(changes),
    ifMatch,
    schema: clientSchema,
  });
}

export function deleteClient(
  gateway: Gateway,
  tenant: string,
  id: string,
): Promise<GatewayResult<undefined>> {
  return gateway.request('DELETE', `admin/tenants/${path(tenant)}/clients/${segment(id)}`, {
    schema: nothing,
  });
}

// One client by its exact id, from the unique index.
export async function findClient(
  gateway: Gateway,
  tenant: string,
  clientId: string,
): Promise<GatewayResult<Client | null>> {
  const query = new URLSearchParams({ client_id_exact: clientId, limit: '1' });
  const result = await readClientPage(gateway, tenant, query);
  return result.ok ? { ...result, data: result.data.items[0] ?? null } : result;
}
