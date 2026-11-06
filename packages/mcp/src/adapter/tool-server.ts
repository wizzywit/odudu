import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import type { RegisteredTool, ToolResult } from '#/service/tool';

const SERVER_INFO = { name: 'odudu', version: '1.0.0' } as const;

type CacheHints = NonNullable<ConstructorParameters<typeof McpServer>[1]>['cacheHints'];

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

function asSdkResult(result: ToolResult) {
  return {
    isError: result.isError,
    content: result.content.map((part) => ({ ...part })),
    structuredContent: result.structuredContent,
  };
}

// The server both transports serve: one tool per catalogue entry the principal
// may use, each answered by `run`. The list is built for one connection or
// request and never changes under a client, so no change is ever announced.
export function toolServer(
  tools: readonly RegisteredTool[],
  run: (tool: RegisteredTool, args: unknown) => Promise<ToolResult>,
  cacheHints?: CacheHints,
): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: { listChanged: false } },
    ...(cacheHints === undefined ? {} : { cacheHints }),
  });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: listedAs(tool.input),
        annotations: tool.annotations,
      },
      async (args: unknown) => asSdkResult(await run(tool, args)),
    );
  }
  return server;
}
