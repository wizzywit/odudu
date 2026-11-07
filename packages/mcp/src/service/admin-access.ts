import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import { ToolProblem, type AdminMethod } from '#/service/tool';
import type { ValidatedMcpToken } from '#/service/validated-token';

export type AdminAccess = 'read' | 'write';

// A GET asks for a write token when `asWriter` says it is the first half of a
// write, so a token that may not write is refused before anything is read.
export function accessOf(method: AdminMethod, asWriter?: true): AdminAccess {
  return method === 'GET' && asWriter !== true ? 'read' : 'write';
}

export function insufficientScopeProblem(): ToolProblem {
  return new ToolProblem(
    'mcp:insufficient_scope',
    'The access token does not carry the scope this call needs',
    403,
  );
}

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
