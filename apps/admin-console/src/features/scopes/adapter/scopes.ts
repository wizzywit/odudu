import {
  clientScopeSchema,
  listBuiltinScopesResponseSchema,
  listScopeClientsResponseSchema,
  MAX_LIMIT,
  restoreBuiltinScopesResponseSchema,
  scopeImpactSchema,
  scopeMappersSchema,
  setScopeRolesResponseSchema,
} from '@odudu/contracts/admin';
import type { Scope } from '#/entities/scope';
import type { BuiltinScopes, RestoredScopes } from '#/features/scopes/types/builtinScopes';
import type { ScopeClientList } from '#/features/scopes/types/scopeClient';
import type { ScopeImpact } from '#/features/scopes/types/scopeImpact';
import type { ScopeMappers } from '#/features/scopes/types/scopeMappers';
import type { ScopeRoleList } from '#/features/scopes/types/scopeRoles';
import { readScopePage } from '#/shared/adapter/directory';
import type { Gateway, GatewayResult } from '#/shared/transport/gateway';
import { adminCall, countReader, firstMatch, nothing } from '#/shared/adapter/route';

export { readScopePage };

export const readScopeCount = countReader('scopes');

export async function findScope(
  gateway: Gateway,
  tenant: string,
  name: string,
): Promise<GatewayResult<Scope | null>> {
  const result = await readScopePage(
    gateway,
    tenant,
    new URLSearchParams({ name, limit: String(MAX_LIMIT) }),
  );
  return firstMatch(result, (scope) => scope.name === name);
}

// A new scope is its name and description; a copy carries the source's other fields too.
export interface CreateScopeInput {
  name: string;
  description: string;
  include_in_id_token?: boolean;
  include_in_access_token?: boolean;
  default_client_assignment?: 'default' | 'optional';
  consent_text?: string;
  display_order?: number;
}

export function createScope(
  gateway: Gateway,
  tenant: string,
  input: CreateScopeInput,
): Promise<GatewayResult<Scope>> {
  const { description, ...rest } = input;
  return adminCall(gateway, 'POST', tenant, ['scopes'], {
    body: {
      ...rest,
      ...(description === '' ? {} : { description }),
    },
    schema: clientScopeSchema,
  });
}

export function readScope(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
): Promise<GatewayResult<Scope>> {
  return adminCall(gateway, 'GET', tenant, ['scopes', scopeId], {
    schema: clientScopeSchema,
  });
}

export function amendScope(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  changes: object,
  ifMatch: string,
): Promise<GatewayResult<Scope>> {
  return adminCall(gateway, 'PATCH', tenant, ['scopes', scopeId], {
    body: changes,
    ifMatch,
    schema: clientScopeSchema,
  });
}

// `confirm` is the scope's own name, which the server asks of a built-in scope.
export function deleteScope(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  confirm?: string,
): Promise<GatewayResult<undefined>> {
  return adminCall(gateway, 'DELETE', tenant, ['scopes', scopeId], {
    ...(confirm === undefined ? {} : { query: new URLSearchParams({ confirm }) }),
    schema: nothing,
  });
}

export function readScopeImpact(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
): Promise<GatewayResult<ScopeImpact>> {
  return adminCall(gateway, 'GET', tenant, ['scopes', scopeId, 'impact'], {
    schema: scopeImpactSchema,
  });
}

export function readBuiltinScopes(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<BuiltinScopes>> {
  return adminCall(gateway, 'GET', tenant, ['scopes', 'builtins'], {
    schema: listBuiltinScopesResponseSchema,
  });
}

export function restoreBuiltinScopes(
  gateway: Gateway,
  tenant: string,
): Promise<GatewayResult<RestoredScopes>> {
  return adminCall(gateway, 'POST', tenant, ['scopes', 'restore-builtins'], {
    schema: restoreBuiltinScopesResponseSchema,
  });
}

export function readScopeRoles(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
): Promise<GatewayResult<ScopeRoleList>> {
  return adminCall(gateway, 'GET', tenant, ['scopes', scopeId, 'roles'], {
    schema: setScopeRolesResponseSchema,
  });
}

export function setScopeRoles(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  roleIds: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<ScopeRoleList>> {
  return adminCall(gateway, 'PUT', tenant, ['scopes', scopeId, 'roles'], {
    body: { role_ids: roleIds },
    ifMatch,
    schema: setScopeRolesResponseSchema,
  });
}

export function readScopeMappers(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
): Promise<GatewayResult<ScopeMappers>> {
  return adminCall(gateway, 'GET', tenant, ['scopes', scopeId, 'mappers'], {
    schema: scopeMappersSchema,
  });
}

export function setScopeMappers(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  names: readonly string[],
  ifMatch: string,
): Promise<GatewayResult<ScopeMappers>> {
  return adminCall(gateway, 'PUT', tenant, ['scopes', scopeId, 'mappers'], {
    body: { mapper_names: names },
    ifMatch,
    schema: scopeMappersSchema,
  });
}

export function readScopeClients(
  gateway: Gateway,
  tenant: string,
  scopeId: string,
  query: URLSearchParams,
): Promise<GatewayResult<ScopeClientList>> {
  return adminCall(gateway, 'GET', tenant, ['scopes', scopeId, 'clients'], {
    query,
    schema: listScopeClientsResponseSchema,
  });
}
