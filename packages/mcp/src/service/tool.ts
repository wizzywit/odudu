import type { AdminCapability } from '@odudu/protocol-admin';
import {
  ToolProblem,
  type AdminCaller,
  type AdminMethod,
  type AdminRequestSpec,
  type AdminResult,
  type BudgetKind,
  type JsonObject,
  type JsonValue,
  type ProblemError,
  type ToolAnnotations,
  type ToolData,
  type ToolResult,
} from '@odudu-io/mcp-stdio/internal';
import type { z } from 'zod';

// The request, result and problem types are the stdio client's own, so that
// the endpoint and the client speak of a tool call in the same terms.
export { ToolProblem };
export type {
  AdminCaller,
  AdminMethod,
  AdminRequestSpec,
  AdminResult,
  JsonObject,
  JsonValue,
  ProblemError,
  ToolAnnotations,
  ToolData,
  ToolResult,
};

// How a tool is built from its route, for the catalogue a client with no
// copy of this package reads: the three shapes the tools a direct caller may
// serve take, and the fields of each that are not in the schemas.
export type ToolWire =
  | { readonly kind: 'page'; readonly pathParams: readonly string[] }
  | {
      readonly kind: 'value';
      readonly pathParams: readonly string[];
      readonly etag: boolean;
      readonly longText: readonly string[];
    }
  | {
      readonly kind: 'write';
      readonly mode: 'amend' | 'create' | 'put' | 'delete';
      readonly pathParams: readonly string[];
      readonly refusal: string;
      readonly stale: string;
      readonly bodyCap?: number;
    };

export interface McpTool<I, O> {
  readonly name: string;
  readonly description: string;
  readonly routeKey: string;
  readonly capability: AdminCapability | null;
  readonly access: 'read' | 'write';
  // For a write: which budget one call of it spends.
  readonly spends?: BudgetKind;
  // For a tool that creates in one call and replaces in another: whether the
  // validated arguments make this call a create, which spends the create budget.
  readonly createsWhen?: (input: unknown) => boolean;
  // What to say when the answer passes the result cap, for a tool whose rows
  // cannot be narrowed with a limit or a filter.
  readonly tooLargeDetail?: string;
  // For a write: the body fields the tool may send, each one the admin API's
  // agent allowlist admits for its route.
  readonly bodyFields?: readonly string[];
  readonly annotations: ToolAnnotations;
  // Who may be offered the tool: every agent (the default) or the console
  // assistant alone, which answers a write with a card the person decides. The
  // MCP endpoint, a direct caller and the SDK catalogue never list or serve one
  // of the assistant's.
  readonly audience?: 'all' | 'assistant';
  // Left out by a tool with logic of its own, which no catalogue file can carry.
  readonly wire?: ToolWire;
  // The schema the admin route answers with, which `output` is built from.
  readonly response: z.ZodType;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly run: (caller: AdminCaller, input: I) => Promise<O>;
}

// A registered tool takes the arguments as the client sent them: `defineTool`
// validates them before anything else runs.
export type RegisteredTool = McpTool<unknown, ToolData>;
