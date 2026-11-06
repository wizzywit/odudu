import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { toNodeHandler, type NodeIncomingMessageLike } from '@modelcontextprotocol/node';
import type { z } from 'zod';
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

const SERVER_INFO = { name: 'odudu', version: '1.0.0' } as const;

// The SDK lists a tool by the JSON Schema its input converts to and would also
// validate the arguments with it. Here it only lists: the arguments go to the
// tool as sent, and the tool's own schema, the one listed, refuses what it does
// not take, so a refusal has one wording and one row in the audit trail.
function listedAs(schema: z.ZodType) {
  const std = schema['~standard'];
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'odudu',
      validate: (value: unknown) => ({ value }),
      jsonSchema: std.jsonSchema,
    },
  };
}

function namesToolsList(body: unknown): boolean {
  return (
    typeof body === 'object' && body !== null && 'method' in body && body.method === 'tools/list'
  );
}

function asSdkResult(result: ToolResult) {
  return {
    isError: result.isError,
    content: result.content.map((part) => ({ ...part })),
    structuredContent: result.structuredContent,
  };
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
        async () => {
          const server = new McpServer(SERVER_INFO, {
            // The list is built for one request and never changes under a
            // client, so no change is ever announced.
            capabilities: { tools: { listChanged: false } },
            cacheHints: {
              'tools/list': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'private' },
              'server/discover': { ttlMs: TOOLS_LIST_TTL_MS, cacheScope: 'private' },
            },
          });
          for (const tool of await parts.tools(purpose)) {
            server.registerTool(
              tool.name,
              {
                description: tool.description,
                inputSchema: listedAs(tool.input),
                annotations: tool.annotations,
              },
              async (args: unknown) => asSdkResult(await parts.run(tool, args)),
            );
          }
          return server;
        },
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
