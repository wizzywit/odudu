import { type RealmScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { clientScopeRepository, type ClientScopeRecord } from '@odudu/domain-realm';

// A granted scope name with no matching client_scopes row resolves to
// nothing rather than erroring — the same "missing means absent"
// `resolveScope` already assumes.
async function resolveClientScopes(
  tx: RealmScopedDatabase,
  grantedScope: readonly string[],
): Promise<ClientScopeRecord[]> {
  const found: ClientScopeRecord[] = [];
  for (const name of grantedScope) {
    const clientScope = await clientScopeRepository(tx).byName(name);
    if (clientScope !== null) found.push(clientScope);
  }
  return found;
}

// Which roles a granted scope set reaches, read fresh per issuance because
// a mapping edited between requests must take effect on the next one, not
// the next login.
export async function reachableRoleIds(
  tx: RealmScopedDatabase,
  grantedScope: readonly string[],
): Promise<ReadonlySet<string>> {
  const scopes = await resolveClientScopes(tx, grantedScope);
  return roleRepository(tx).idsForClientScopes(scopes.map((scope) => scope.id));
}

// The subset of a granted scope whose own definition opts it into the
// access token (`client_scopes.include_in_access_token`) — symmetric with
// the ID token's `include_in_id_token` gate, and read the same way.
export async function accessTokenEligibleScope(
  tx: RealmScopedDatabase,
  grantedScope: readonly string[],
): Promise<string[]> {
  const scopes = await resolveClientScopes(tx, grantedScope);
  return scopes.filter((scope) => scope.includeInAccessToken).map((scope) => scope.name);
}

// What actually appears in the issued `scope` claim — narrower than the
// granted scope set itself, which keeps gating mappers and narrowing roles
// (both read the granted set directly, never this). A scope whose own
// `include_in_token_scope` is false still contributed its claims; only its
// name is left off the string a client reads back. `openid` is exempt: an
// OIDC client checks for it, and no realm data should be able to hide it.
export async function tokenScopeClaim(
  tx: RealmScopedDatabase,
  grantedScope: readonly string[],
): Promise<string[]> {
  const scopes = await resolveClientScopes(tx, grantedScope);
  const includeByName = new Map(scopes.map((scope) => [scope.name, scope.includeInTokenScope]));
  return grantedScope.filter((name) => name === 'openid' || includeByName.get(name) !== false);
}
