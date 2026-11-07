// Fixed rather than configurable: the `odudu mcp` command, the tenant
// export and the admin API's reserved-id guard all name it, so a renameable
// id could hide the client from any of them.
export const MCP_CLIENT_ID = 'odudu-mcp';

// RFC 8252 §7.3: a native app listens on an ephemeral loopback port, so the
// built-in client registers the two IP literals without one and
// `/authorize` accepts any port for them. Never `localhost`, whose
// resolution the app does not control (§8.3).
export const MCP_CLIENT_REDIRECT_URIS = ['http://127.0.0.1', 'http://[::1]'] as const;

export const MCP_CLIENT_NAME = 'Odudu MCP';

// Seconds. Its access tokens are for the admin API, so they live as long as
// the console's own.
export const MCP_CLIENT_LIFETIMES = {
  accessToken: 300,
  idToken: 300,
  refreshToken: 1_209_600,
} as const;

export const MCP_READ_SCOPE = 'mcp:read';
export const MCP_WRITE_SCOPE = 'mcp:write';

export const MCP_SCOPES: readonly string[] = [MCP_READ_SCOPE, MCP_WRITE_SCOPE];

export function isMcpScope(scope: string): boolean {
  return MCP_SCOPES.includes(scope);
}

export function holdsMcpScope(scopes: readonly string[]): boolean {
  return scopes.some(isMcpScope);
}
