import type { AdminCapability } from '@odudu/protocol-admin';
import type { z } from 'zod';

// The admin API methods a tool may use. Reads are GET; the one write an
// agent holds is the PATCH of descriptive fields.
export type AdminMethod = 'GET' | 'PATCH';

// One admin request, before it has an address. `pattern` is an ADMIN_ROUTES
// pattern whose `:tenant` the caller fills from the principal and never from
// a tool's input; `params` are the other path parameters, raw, for the caller
// to encode. A read has no header or body, so none can be set from input.
export interface AdminRequestSpec {
  readonly method: AdminMethod;
  readonly pattern: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
}

export interface AdminResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
}

export interface AdminCaller {
  call(req: AdminRequestSpec): Promise<AdminResult>;
}

// Hints for a client's own approval UI; nothing in the server relies on them.
export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
}

export interface McpTool<I, O> {
  readonly name: string;
  readonly description: string;
  readonly routeKey: string;
  readonly capability: AdminCapability | null;
  readonly access: 'read' | 'write';
  readonly annotations: ToolAnnotations;
  readonly input: z.ZodType<I>;
  readonly output: z.ZodType<O>;
  readonly run: (caller: AdminCaller, input: I) => Promise<O>;
}

export type ToolData = Record<string, unknown>;

// A registered tool takes the arguments as the client sent them: `defineTool`
// validates them before anything else runs.
export type RegisteredTool = McpTool<unknown, ToolData>;

export interface ToolResult {
  readonly isError: boolean;
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent: ToolData;
}

// A refusal a tool reports: the admin API's problem, or one of this layer's
// own. Only these fields ever reach a client; the stack never does.
export class ToolProblem extends Error {
  readonly problemType: string;
  readonly status: number | null;
  readonly detail: string | undefined;

  constructor(problemType: string, title: string, status: number | null, detail?: string) {
    super(title);
    this.name = 'ToolProblem';
    this.problemType = problemType;
    this.status = status;
    this.detail = detail;
  }

  get title(): string {
    return this.message;
  }
}
