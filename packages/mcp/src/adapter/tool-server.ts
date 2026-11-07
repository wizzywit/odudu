import { McpServer } from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { announceTenant } from '#/service/tenant-announcement';
import type { RegisteredTool, ToolResult } from '#/service/tool';

const SERVER_VERSION = '1.0.0';

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
// The server says which tenant it serves (its name, title and instructions, and
// the start of every description); the catalogue itself names no tenant.
export function toolServer(
  tenant: string,
  tools: readonly RegisteredTool[],
  run: (tool: RegisteredTool, args: unknown) => Promise<ToolResult>,
  cacheHints?: CacheHints,
  note?: string,
): McpServer {
  const announcement = announceTenant(tenant);
  const server = new McpServer(
    { name: announcement.name, title: announcement.title, version: SERVER_VERSION },
    {
      instructions:
        note === undefined ? announcement.instructions : `${announcement.instructions} ${note}`,
      capabilities: { tools: { listChanged: false } },
      ...(cacheHints === undefined ? {} : { cacheHints }),
    },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: announcement.describe(tool.description),
        inputSchema: listedAs(tool.input),
        annotations: tool.annotations,
      },
      async (args: unknown) => asSdkResult(await run(tool, args)),
    );
  }
  return server;
}
