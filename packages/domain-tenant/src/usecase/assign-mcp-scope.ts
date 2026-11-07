import { type TenantScopedDatabase } from '@odudu/db';
import { clientScopeRepository } from '#/repository/client-scopes';
import { type ClientScopeAssignment } from '#/schema/client-scopes';

/**
 * Gives a client one of the tenant's MCP scopes unless it already holds it,
 * so an assignment an administrator made is never lowered. A tenant that has
 * deleted the scope leaves the client without it.
 */
export async function assignMcpScope(
  tx: TenantScopedDatabase,
  clientId: string,
  scopeName: string,
  assignment: ClientScopeAssignment,
): Promise<void> {
  const scopes = clientScopeRepository(tx);
  const scope = await scopes.byName(scopeName);
  if (scope !== null && !(await scopes.assigned(clientId, scope.id))) {
    await scopes.assignOrUpdate(clientId, scope.id, assignment);
  }
}
