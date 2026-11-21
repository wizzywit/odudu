import { directCallerTools, TOOLS, type RegisteredTool } from '@odudu/mcp';
import { z } from 'zod';

// What a client with no copy of the server's tool code needs of each tool a
// direct caller may serve: how to address the route, how to cut the answer,
// and the schemas that check what goes in and what comes back.
interface Entry {
  readonly name: string;
  readonly description: string;
  readonly scope: 'mcp:read' | 'mcp:write';
  readonly method: string;
  readonly pathTemplate: string;
  readonly kind: 'page' | 'value' | 'write';
  readonly annotations: RegisteredTool['annotations'];
  readonly pathParams: readonly string[];
  readonly bodyFields?: readonly string[];
  readonly spends?: string;
  readonly etag?: true;
  readonly longText?: readonly string[];
  readonly tooLargeDetail?: string;
  readonly bodyCap?: number;
  readonly refusal?: string;
  readonly stale?: string;
  readonly inputSchema: unknown;
  readonly outputSchema: unknown;
}

function split(routeKey: string): { method: string; pathTemplate: string } {
  const space = routeKey.indexOf(' ');
  return { method: routeKey.slice(0, space), pathTemplate: routeKey.slice(space + 1) };
}

// The dialect is named once, on the input schema a client lists; the output
// schema is only read by the package itself.
function withoutDialect(schema: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema).filter(([key]) => key !== '$schema'));
}

function entryOf(tool: RegisteredTool): Entry {
  const { wire } = tool;
  if (wire === undefined) {
    throw new Error(`${tool.name} has logic of its own and cannot be carried as data`);
  }
  const { method, pathTemplate } = split(tool.routeKey);
  return {
    name: tool.name,
    description: tool.description,
    scope: tool.access === 'read' ? 'mcp:read' : 'mcp:write',
    method,
    pathTemplate,
    kind: wire.kind,
    annotations: tool.annotations,
    pathParams: wire.pathParams,
    ...(tool.bodyFields === undefined ? {} : { bodyFields: tool.bodyFields }),
    ...(tool.spends === undefined ? {} : { spends: tool.spends }),
    ...(wire.kind === 'value' && wire.etag ? { etag: true as const } : {}),
    ...(wire.kind === 'value' && wire.longText.length > 0 ? { longText: wire.longText } : {}),
    ...(tool.tooLargeDetail === undefined ? {} : { tooLargeDetail: tool.tooLargeDetail }),
    ...(wire.kind === 'write' && wire.bodyCap !== undefined ? { bodyCap: wire.bodyCap } : {}),
    ...(wire.kind === 'write' ? { refusal: wire.refusal, stale: wire.stale } : {}),
    inputSchema: z.toJSONSchema(tool.input, { io: 'input' }),
    outputSchema: withoutDialect(z.toJSONSchema(tool.response, { io: 'output' })),
  };
}

// The catalogue file's text. The order is the tools' own (sorted by name) and
// nothing in it depends on the day or the machine, so the same source gives the
// same bytes.
export function catalogueText(): string {
  const tools = directCallerTools(TOOLS).map(entryOf);
  return `${JSON.stringify({ tools }, null, 2)}\n`;
}
