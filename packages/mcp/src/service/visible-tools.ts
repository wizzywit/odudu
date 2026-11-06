import { ADMIN_ROUTES } from '@odudu/protocol-admin';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '@odudu/protocol-oidc';
import { type RegisteredTool } from '#/service/tool';

const ALSO_ADMITS: ReadonlyMap<string, readonly string[]> = new Map(
  ADMIN_ROUTES.map((route) => [`${route.method} ${route.pattern}`, route.alsoAdmits ?? []]),
);

// Whether a call of this tool could succeed for the token and its owner: the
// scope admits its access (a read under either scope, a write under `mcp:write`)
// and the owner holds its capability or one the route admits besides it. A tool
// that would be refused is not listed; calling it by name is refused at the
// admin API as before. A tool whose route has no `:tenant` spans tenants and is
// listed only in the system tenant. `capabilities` is null where the owner is
// not judged, for a call the admin API refuses and records if the owner lacks it.
export function toolVisible(
  tool: Pick<RegisteredTool, 'access' | 'capability' | 'routeKey'>,
  scope: readonly string[],
  capabilities: ReadonlySet<string> | null,
  inSystemTenant: boolean,
): boolean {
  if (!tool.routeKey.includes(':tenant') && !inSystemTenant) return false;
  const scopes = tool.access === 'read' ? [MCP_READ_SCOPE, MCP_WRITE_SCOPE] : [MCP_WRITE_SCOPE];
  if (!scopes.some((held) => scope.includes(held))) return false;
  if (tool.capability === null || capabilities === null) return true;
  if (capabilities.has(tool.capability)) return true;
  return (ALSO_ADMITS.get(tool.routeKey) ?? []).some((also) => capabilities.has(also));
}

export function visibleTools(
  tools: readonly RegisteredTool[],
  scope: readonly string[],
  capabilities: ReadonlySet<string> | null,
  inSystemTenant: boolean,
): RegisteredTool[] {
  return tools.filter((tool) => toolVisible(tool, scope, capabilities, inSystemTenant));
}
