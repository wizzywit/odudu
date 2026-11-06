import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import { ToolProblem, type AdminMethod } from '#/service/tool';
import type { ValidatedMcpToken } from '#/service/validated-token';

export type AdminAccess = 'read' | 'write';

export function accessOf(method: AdminMethod): AdminAccess {
  return method === 'GET' ? 'read' : 'write';
}

const SCOPE_OF: Record<AdminAccess, string> = {
  read: MCP_READ_SCOPE,
  write: MCP_WRITE_SCOPE,
};

export function insufficientScopeProblem(): ToolProblem {
  return new ToolProblem(
    'mcp:insufficient_scope',
    'The access token does not carry the scope this call needs',
    403,
  );
}

// The one scope an admin call is made with: what the call needs and nothing
// else, and only when the presented token holds it.
export function scopeFor(token: ValidatedMcpToken, access: AdminAccess): readonly string[] {
  const needed = SCOPE_OF[access];
  if (!token.scope.includes(needed)) throw insufficientScopeProblem();
  return [needed];
}
