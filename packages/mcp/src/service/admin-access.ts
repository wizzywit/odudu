import { insufficientScopeProblem, type AdminAccess } from '@odudu-io/mcp-stdio/internal';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import type { ValidatedMcpToken } from '#/service/validated-token';

export type { AdminAccess };

// The one scope an admin call is made with: what the call needs and nothing
// wider, and only when the presented token holds it. A read takes `mcp:read`,
// or `mcp:write` for a token that holds only that, since the admin API admits
// a GET under either.
export function scopeFor(token: ValidatedMcpToken, access: AdminAccess): readonly string[] {
  const candidates = access === 'read' ? [MCP_READ_SCOPE, MCP_WRITE_SCOPE] : [MCP_WRITE_SCOPE];
  const held = candidates.find((scope) => token.scope.includes(scope));
  if (held === undefined) throw insufficientScopeProblem();
  return [held];
}
