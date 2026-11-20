import { MCP_READ_SCOPE, MCP_WRITE_SCOPE } from '#/service/scopes';
import type { CallableTool } from '#/service/tool';

// Whether a call of this tool could succeed for a token holding `scope`: the
// scope admits its access (a read under either scope, a write under `mcp:write`).
// A tool whose route has no `:tenant` spans tenants and is listed only in the
// system tenant. A tool that would be refused is not listed; calling it by name
// is refused at the admin API as before, which also judges the owner's
// capabilities.
export function toolVisible(
  tool: Pick<CallableTool, 'access' | 'routeKey'>,
  scope: readonly string[],
  inSystemTenant: boolean,
): boolean {
  if (!tool.routeKey.includes(':tenant') && !inSystemTenant) return false;
  const scopes = tool.access === 'read' ? [MCP_READ_SCOPE, MCP_WRITE_SCOPE] : [MCP_WRITE_SCOPE];
  return scopes.some((held) => scope.includes(held));
}

export function visibleTools<T extends CallableTool>(
  tools: readonly T[],
  scope: readonly string[],
  inSystemTenant: boolean,
): T[] {
  return tools.filter((tool) => toolVisible(tool, scope, inSystemTenant));
}

// What a caller that reaches the admin API with its own token may be offered.
// A write that is not an amendment adds or removes a row (a create, a PUT that
// may create, a DELETE), and the write budget that bounds those is spent by the
// MCP endpoint on the grant behind each call. The admin door admits such a write
// to a token the endpoint signed alone, so a tool that makes one is not listed,
// or served, here.
export function directCallerTools<T extends CallableTool>(tools: readonly T[]): T[] {
  return tools.filter((tool) => tool.access === 'read' || tool.routeKey.startsWith('PATCH '));
}
