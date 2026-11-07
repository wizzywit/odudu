import type { AdminCapability } from '@odudu/protocol-admin';
import type { z } from 'zod';
import type { BudgetKind } from '#/service/write-budget';

// The admin API methods a tool may use. Reads are GET; every other method is
// a write the admin API's agent allowlist names route by route.
export type AdminMethod = 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE';

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export type JsonObject = { readonly [K in string]: JsonValue };

// One admin request, before it has an address. `pattern` is an ADMIN_ROUTES
// pattern whose `:tenant` the caller fills from the principal, never from input;
// `params` are the other path parameters, raw, for the caller to encode. There
// is no header field: the only three inputs that become headers are `ifMatch`
// (one strong etag, on a PATCH, PUT or DELETE), `createOnly` (a PUT that must not
// replace, sent as `If-None-Match: *`) and `idempotencyKey` (on a POST).
// A body is a record the tool built from validated arguments, on a PATCH, POST
// or PUT; a tool never supplies bytes. `bodyCap` sets the body's byte limit.
export interface AdminRequestSpec {
  readonly method: AdminMethod;
  readonly pattern: string;
  readonly params: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string>>;
  readonly body?: JsonObject;
  readonly ifMatch?: string;
  readonly createOnly?: true;
  readonly idempotencyKey?: string;
  readonly bodyCap?: number;
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
  // The schema the admin route answers with, which `output` is built from.
  readonly response: z.ZodType;
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
