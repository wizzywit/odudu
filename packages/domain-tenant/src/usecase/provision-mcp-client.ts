import { type TenantScopedDatabase } from '@odudu/db';
import { OduduError } from '@odudu/kernel';
import { clientRepository } from '#/repository/clients';
import { clientScopeRepository } from '#/repository/client-scopes';
import { type ClientRecord } from '#/schema/clients';
import {
  MCP_CLIENT_ID,
  MCP_CLIENT_NAME,
  MCP_READ_SCOPE,
  MCP_WRITE_SCOPE,
} from '#/service/mcp-client';
import { provisionClientDefaults } from '#/usecase/provision-defaults';

/**
 * The built-in `odudu-mcp` public client row and its scope assignments:
 * `mcp:read` by default, `mcp:write` optional, beside the tenant's own
 * default vocabulary. A scope the tenant no longer defines is left out
 * rather than recreated. Idempotent: a second pass finds the marked client
 * and writes nothing. The OIDC configuration that /authorize needs lives in
 * protocol-oidc, whose `provisionMcpClient` calls this and adds it.
 */
export async function provisionMcpClient(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<ClientRecord> {
  const clients = clientRepository(tx);
  const existing = await clients.byClientId(MCP_CLIENT_ID);
  if (existing !== null) {
    if (!existing.builtinMcp) {
      throw new OduduError(
        'mcp_client_not_builtin',
        `client ${MCP_CLIENT_ID} already exists in this tenant and is not the built-in MCP client`,
      );
    }
    return existing;
  }
  const client = await clients.create({
    tenantId,
    clientId: MCP_CLIENT_ID,
    name: MCP_CLIENT_NAME,
    type: 'public',
    secretHash: null,
    builtinMcp: true,
  });
  await provisionClientDefaults(tx, client.id);
  const scopes = clientScopeRepository(tx);
  for (const [name, assignment] of [
    [MCP_READ_SCOPE, 'default'],
    [MCP_WRITE_SCOPE, 'optional'],
  ] as const) {
    const scope = await scopes.byName(name);
    if (scope !== null) await scopes.assignOrUpdate(client.id, scope.id, assignment);
  }
  return client;
}
