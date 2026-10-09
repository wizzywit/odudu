import { type ClaimMapperRegistry } from '@odudu/kernel';
import { type ClaimContext, type LoadedClaimContext } from '#/service/claims';
import { narrowByScopeMappings } from '#/service/scope-mapping';

/** Which roles a granted scope reaches, and whether the client bypasses that. */
export interface RoleReach {
  readonly reachableRoleIds: ReadonlySet<string>;
  readonly fullScopeAllowed: boolean;
}

/**
 * The claims the registry maps for `scope`, with the subject's roles first
 * narrowed to what the scope reaches: the one computation behind an access
 * token's claims, an ID token's and a UserInfo response's.
 */
export function mappedClaims(
  registry: ClaimMapperRegistry<ClaimContext>,
  scope: readonly string[],
  loaded: LoadedClaimContext,
  reach: RoleReach,
): Promise<Record<string, unknown>> {
  const context: ClaimContext = {
    ...loaded.context,
    roles: narrowByScopeMappings(
      loaded.context.roles,
      reach.reachableRoleIds,
      reach.fullScopeAllowed,
    ),
  };
  return registry.assemble(scope, context, loaded.bindings);
}

// A granted scope reaches an ID token only if its own definition says so
// (`client_scopes.include_in_id_token`): `roles` and `groups` ship with that
// off, because the ID token reaches the browser and a client cannot opt out
// of what lands there.
export function idTokenScopeOf(
  assigned: readonly { readonly name: string; readonly includeInIdToken: boolean }[],
  scope: readonly string[],
): string[] {
  return assigned
    .filter((clientScope) => scope.includes(clientScope.name) && clientScope.includeInIdToken)
    .map((clientScope) => clientScope.name);
}
