import type { BudgetKind } from '#/services/write-budget';

// The admin API methods a tool may use. Reads are GET; every other method is
// a write the admin API's agent allowlist names route by route.
export type AdminMethod = 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE';

export type JsonValue = string | number | boolean | null | readonly JsonValue[] | JsonObject;

export type JsonObject = { readonly [K in string]: JsonValue };

// One admin request, before it has an address. `pattern` is a route pattern
// whose `:tenant` the caller fills from its own configuration, never from input;
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
  // A GET made with the access of the write that follows it.
  readonly asWriter?: true;
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

// Hints for a client's own approval UI; nothing relies on them.
export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
}

export type ToolData = Record<string, unknown>;

export interface ToolResult {
  readonly isError: boolean;
  readonly content: readonly { readonly type: 'text'; readonly text: string }[];
  readonly structuredContent: ToolData;
}

// One field a refusal names, as the admin API's own `errors` list does: the
// path from the request body, why, and for a template or stylesheet where.
export interface ProblemError {
  readonly path: string;
  readonly message: string;
  readonly code?: string | undefined;
  readonly detail?: string | undefined;
  readonly line?: number | null | undefined;
  readonly column?: number | null | undefined;
}

// A refusal a tool reports: the admin API's problem, or one of this layer's
// own. Only these fields ever reach a client; the stack never does.
export class ToolProblem extends Error {
  readonly problemType: string;
  readonly status: number | null;
  readonly detail: string | undefined;
  // The fields at fault, for a tool whose refusal is useless without them.
  readonly errors: readonly ProblemError[] | undefined;

  constructor(
    problemType: string,
    title: string,
    status: number | null,
    detail?: string,
    errors?: readonly ProblemError[],
  ) {
    super(title);
    this.name = 'ToolProblem';
    this.problemType = problemType;
    this.status = status;
    this.detail = detail;
    this.errors = errors;
  }

  get title(): string {
    return this.message;
  }
}

export type ParseResult =
  | { readonly success: true; readonly data: unknown }
  | { readonly success: false; readonly detail?: string };

// What a call of a tool needs of it, whether the tool is read from the
// catalogue file or written in code: the server's endpoint runs its own tools
// through the same call.
export interface CallableTool {
  readonly name: string;
  readonly routeKey: string;
  readonly access: 'read' | 'write';
  // For a write: which budget one call of it spends.
  readonly spends?: BudgetKind;
  // Whether the validated arguments make this call a create, which also spends
  // the create budget.
  readonly createsWhen?: (input: unknown) => boolean;
  // What to say when the answer passes the result cap, for a tool whose rows
  // cannot be narrowed with a limit or a filter.
  readonly tooLargeDetail?: string;
  readonly input: { safeParse(raw: unknown): ParseResult };
  // Takes the arguments as the client sent them: the tool checks them first.
  readonly run: (caller: AdminCaller, input: unknown) => Promise<ToolData>;
}

// A tool as the stdio server lists and serves it.
export interface RegisteredTool extends CallableTool {
  readonly description: string;
  readonly annotations: ToolAnnotations;
  // For a write: the body fields the tool may send.
  readonly bodyFields?: readonly string[];
  readonly inputSchema: Readonly<Record<string, unknown>>;
}
