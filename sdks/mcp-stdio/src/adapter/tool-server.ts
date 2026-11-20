import { McpServer } from '@modelcontextprotocol/server';
import { announceTenant } from '#/service/tenant-announcement';
import type { RegisteredTool, ToolResult } from '#/service/tool';

const SERVER_VERSION = '1.0.0';

// The SDK lists a tool by the JSON Schema its input holds and would also
// validate the arguments with it. Here it only lists: the arguments go to the
// tool as sent, and the tool's own schema, the one listed, refuses what it does
// not take, so a refusal has one wording.
function listedAs(schema: Readonly<Record<string, unknown>>) {
  const listed = { ...schema };
  return {
    '~standard': {
      version: 1 as const,
      vendor: 'odudu',
      validate: (value: unknown) => ({ value }),
      jsonSchema: { input: () => listed, output: () => listed },
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

// The server the stdio transport serves: one tool per catalogue entry the person
// may use, each answered by `run`. The list is built for one connection and never
// changes under a client, so no change is ever announced. The server says which
// tenant it serves (its name, title and instructions, and the start of every
// description); the catalogue itself names no tenant.
export function toolServer(
  tenant: string,
  tools: readonly RegisteredTool[],
  run: (tool: RegisteredTool, args: unknown) => Promise<ToolResult>,
  note?: string,
): McpServer {
  const announcement = announceTenant(tenant);
  const server = new McpServer(
    { name: announcement.name, title: announcement.title, version: SERVER_VERSION },
    {
      instructions:
        note === undefined ? announcement.instructions : `${announcement.instructions} ${note}`,
      capabilities: { tools: { listChanged: false } },
    },
  );
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: announcement.describe(tool.description),
        inputSchema: listedAs(tool.inputSchema),
        annotations: tool.annotations,
      },
      async (args: unknown) => asSdkResult(await run(tool, args)),
    );
  }
  return server;
}
