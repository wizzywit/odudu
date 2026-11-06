import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import { toolServer } from '#/adapter/tool-server';
import type { McpExchange } from '#/service/endpoint';
import type { RegisteredTool, ToolResult } from '#/service/tool';

export interface ExchangeParts {
  // The tools this exchange's principal may use, in the order `tools/list`
  // answers them. Asked for each time the SDK builds a server for a request:
  // `list` for the request that lists them, `call` for every other.
  tools(purpose: 'list' | 'call'): Promise<readonly RegisteredTool[]>;
  run(tool: RegisteredTool, args: unknown): Promise<ToolResult>;
  onerror(error: Error): void;
}

// A tools/list is for one principal and changes with their roles, so a client
// may keep it for a minute at most and never share it.
export const TOOLS_LIST_TTL_MS = 60_000;

function namesToolsList(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && 'method' in body && body.method === 'tools/list'
  );
}

// Serves MCP requests over the SDK's stateless handler: the 2026-07-28
// revision, and the 2025 `initialize` handshake without a session. The handler
// is built per request, so the tool callbacks close over this exchange's
// principal and nothing is shared between requests.
export function createMcpExchange(parts: ExchangeParts): McpExchange {
  return {
    async serve(req, res, body) {
      const purpose = namesToolsList(body) ? 'list' : 'call';
      const handler = createMcpHandler(
        async () =>
          toolServer(await parts.tools(purpose), (tool, args) => parts.run(tool, args), {
            'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'private' },
            'server/discover': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'private' },
          }),
        {
          legacy: 'stateless',
          onerror: (error) => {
            parts.onerror(error);
          },
        },
      );
      try {
        // `IncomingMessage` types `method` as possibly undefined, which the handler's
        // structural type does not take under exactOptionalPropertyTypes.
        await toNodeHandler(handler)(req as NodeIncomingMessageLike, res, body);
      } finally {
        await handler.close();
      }
    },
  };
}
