import { type RealmScopedDatabase } from '@odudu/db';
import { roleRepository } from '@odudu/domain-authz';
import { clientScopeRepository } from '@odudu/domain-realm';

// Which roles a granted scope set reaches, read fresh per issuance because
// a mapping edited between requests must take effect on the next one, not
// the next login. A granted scope name with no matching client_scopes row
// reaches nothing rather than erroring — the same "missing means absent"
// `resolveScope` already assumes.
export async function reachableRoleIds(
  tx: RealmScopedDatabase,
  grantedScope: readonly string[],
): Promise<ReadonlySet<string>> {
  const clientScopeIds: string[] = [];
  for (const name of grantedScope) {
    const clientScope = await clientScopeRepository(tx).byName(name);
    if (clientScope !== null) clientScopeIds.push(clientScope.id);
  }
  return roleRepository(tx).idsForClientScopes(clientScopeIds);
}
