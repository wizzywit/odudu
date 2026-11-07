import { AgentTokenRefused, MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import { type AdminBearer } from '#/service/request-scope';
import { insufficientScopeProblem } from '#/service/admin-access';
import type { McpCallDeps } from '#/service/deps';
import { ToolProblem } from '#/service/tool';
import type { ValidatedMcpToken } from '#/service/validated-token';

const MCP_SCOPES: readonly string[] = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];

// The admin-audience bearer an agent calls the admin API with, for the owner
// whose grant the presented MCP token names. It is minted in-process (no
// /token request, no client authentication), is no wider than `scope` and no
// longer-lived than the presented token, and is kept for this request only.
export async function exchangeForAdmin(
  deps: McpCallDeps,
  token: ValidatedMcpToken,
  scope: readonly string[],
): Promise<AdminBearer> {
  const held = new Set(token.scope);
  if (scope.length === 0 || !scope.every((s) => MCP_SCOPES.includes(s) && held.has(s))) {
    throw insufficientScopeProblem();
  }
  const key = `${token.grantId} ${[...scope].sort().join(' ')}`;
  const now = deps.now();
  const cached = deps.request.bearers.get(key);
  if (cached !== undefined && cached.expiresAt.getTime() > now.getTime()) return cached;

  try {
    const minted = await deps.mintAgentToken(token, {
      subjectGrantId: token.grantId,
      expectedSubjectId: token.subjectId,
      agentClientId: token.clientId,
      audience: deps.adminAudience,
      scope,
      notAfter: token.expiresAt,
      now,
    });
    const bearer: AdminBearer = { bearer: minted.accessToken, expiresAt: minted.expiresAt };
    deps.request.bearers.set(key, bearer);
    return bearer;
  } catch (error) {
    if (!(error instanceof AgentTokenRefused)) throw error;
    deps.logger.debug({ reason: error.reason, tenant: token.tenant.id }, 'agent token refused');
    throw new ToolProblem(
      'mcp:access_ended',
      'The access behind this connection has ended; sign in again',
      401,
    );
  }
}
