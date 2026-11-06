import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import type { AdminMethod } from '#/service/tool';
import type { ValidatedMcpToken } from '#/service/validated-token';

export type AdminAccess = 'read' | 'write';

export function accessOf(method: AdminMethod): AdminAccess {
  return method === 'GET' ? 'read' : 'write';
}

const SCOPE_OF: Record<AdminAccess, string> = {
  read: MCP_READ_SCOPE,
  write: MCP_WRITE_SCOPE,
};

// The one scope an admin call is made with: what the call needs and nothing
// else, and only when the presented token holds it. Null means the token is
// too narrow for the call.
export function scopeFor(token: ValidatedMcpToken, access: AdminAccess): readonly string[] | null {
  const needed = SCOPE_OF[access];
  return token.scope.includes(needed) ? [needed] : null;
}
