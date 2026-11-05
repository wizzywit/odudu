export const MCP_READ_SCOPE = 'mcp:read';
export const MCP_WRITE_SCOPE = 'mcp:write';

const MCP_SCOPES: readonly string[] = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];

export function isMcpScope(scope: string): boolean {
  return MCP_SCOPES.includes(scope);
}

export function holdsMcpScope(scope: readonly string[]): boolean {
  return scope.some(isMcpScope);
}

// An MCP scope means something only at the MCP endpoint and the admin API it
// calls for the person; at any other audience it would be a scope no resource
// there defines (RFC 9068 §2.2.3). Every other scope is judged elsewhere.
export function scopeAllowedAt(
  scope: string,
  audience: string,
  mcpAudience: string,
  adminAudience: string,
): boolean {
  if (!MCP_SCOPES.includes(scope)) return true;
  return audience === mcpAudience || audience === adminAudience;
}

// A token carries every audience it names, so a scope has to be allowed at
// each of them; an MCP scope with no audience would reach no resource that
// defines it.
export function scopesCoherentWithAudience(
  scopes: readonly string[],
  audiences: readonly string[],
  mcpAudience: string,
  adminAudience: string,
): boolean {
  return scopes.every((scope) =>
    !MCP_SCOPES.includes(scope)
      ? true
      : audiences.length > 0 &&
        audiences.every((audience) => scopeAllowedAt(scope, audience, mcpAudience, adminAudience)),
  );
}

// What authorization-server metadata advertises: the tenant's own scopes and
// the two every tenant can be asked for at the MCP audience.
export function withMcpScopes(scopes: readonly string[]): string[] {
  return [...new Set([...scopes, ...MCP_SCOPES])].sort();
}

export const MCP_WRITE_MAX_TTL_SECONDS = 600;

// A write is made on a token that dies in ten minutes at most; a tenant or
// client setting may only lower that.
export function capLifetimeForScope(ttlSeconds: number, scope: readonly string[]): number {
  return scope.includes(MCP_WRITE_SCOPE)
    ? Math.min(ttlSeconds, MCP_WRITE_MAX_TTL_SECONDS)
    : ttlSeconds;
}

// A grant holding mcp:write is never refreshable: the holder re-authorizes.
export function refreshAllowedForScope(scope: readonly string[]): boolean {
  return !scope.includes(MCP_WRITE_SCOPE);
}

// What an admin-audience token minted for an agent lives, at most. It is
// minted per tool call, so a short life costs one signature and bounds what a
// leaked token is worth.
export const AGENT_TOKEN_MAX_TTL_SECONDS = 300;
