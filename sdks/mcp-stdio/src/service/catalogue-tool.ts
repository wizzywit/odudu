import { z } from 'zod';
import { problemOf } from '#/service/call-tool';
import type { CatalogueEntry } from '#/service/catalogue';
import { isEtag } from '#/service/etag-shape';
import { compile, type Compiled } from '#/service/json-schema';
import { jsonOf } from '#/service/json-value';
import { cleanData, type CleanStats } from '#/service/sanitize';
import {
  ToolProblem,
  type AdminCaller,
  type AdminRequestSpec,
  type AdminResult,
  type JsonObject,
  type JsonValue,
  type RegisteredTool,
  type ToolData,
} from '#/service/tool';

// The longest string a tool takes as an argument: longer than any id, filter
// or cursor the admin API accepts, short enough that a call cannot be used to
// carry a payload.
export const INPUT_STRING_CAP = 1_024;

// What a write's body may take when the tool names no cap of its own. It sits
// under the request cap, so a combination of fields each within bounds is
// refused as an argument and never as a failure.
const BODY_BUDGET_BYTES = 60_000;

const UNEXPECTED = 'The admin API answered something this tool does not understand';
// The admin API's cursors are base64url segments joined by a dot. One with any
// other character is not one of them.
const OPAQUE = /^[A-Za-z0-9_.-]+$/u;

function unexpected(): ToolProblem {
  return new ToolProblem('mcp:unexpected_response', UNEXPECTED, null);
}

function invalidArguments(detail: string): ToolProblem {
  return new ToolProblem('mcp:invalid_arguments', 'The arguments are not valid', 400, detail);
}

function issueText(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
    .join('; ');
}

function longStrings(input: Record<string, unknown>): string | undefined {
  const found = Object.entries(input).find(
    ([, item]) => typeof item === 'string' && item.length > INPUT_STRING_CAP,
  );
  return found === undefined
    ? undefined
    : `${found[0]}: at most ${String(INPUT_STRING_CAP)} characters`;
}

function bodyOf(fields: readonly string[], input: Record<string, unknown>): JsonObject {
  return Object.fromEntries(
    fields.flatMap((field): [string, JsonValue][] => {
      const value = input[field];
      return value === undefined ? [] : [[field, jsonOf(value)]];
    }),
  );
}

// The checks the schema cannot carry, driven by the entry's own fields: a read
// takes no string past the cap, and a write names at least one field to amend
// and holds its body within the cap.
function crossCheck(entry: CatalogueEntry, input: Record<string, unknown>): string | undefined {
  if (entry.kind !== 'write') return longStrings(input);
  const fields = entry.bodyFields ?? [];
  const body = bodyOf(fields, input);
  if (Object.keys(body).length === 0) return `name at least one of ${fields.join(', ')}`;
  const cap = entry.bodyCap ?? BODY_BUDGET_BYTES;
  return Buffer.byteLength(JSON.stringify(body)) > cap ? 'the text is too long in all' : undefined;
}

type Checked =
  | { readonly ok: true; readonly args: Record<string, unknown> }
  | { readonly ok: false; readonly detail: string };

function validatorOf(entry: CatalogueEntry): (raw: unknown) => Checked {
  const checker = z.fromJSONSchema(entry.inputSchema);
  return (raw) => {
    const parsed = checker.safeParse(raw);
    if (!parsed.success) return { ok: false, detail: issueText(parsed.error) };
    const args = asRecord(parsed.data);
    const reason = crossCheck(entry, args);
    return reason === undefined ? { ok: true, args } : { ok: false, detail: reason };
  };
}

function scalar(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new Error('a read tool takes strings, numbers and booleans');
}

function readRequest(entry: CatalogueEntry, input: Record<string, unknown>): AdminRequestSpec {
  const params: Record<string, string> = {};
  const query: Record<string, string> = {};
  for (const [field, value] of Object.entries(input)) {
    if (value === undefined) continue;
    (entry.pathParams.includes(field) ? params : query)[field] = scalar(value);
  }
  return { method: 'GET', pattern: entry.pathTemplate, params, query };
}

async function okResult(caller: AdminCaller, request: AdminRequestSpec): Promise<AdminResult> {
  const result = await caller.call(request);
  if (result.status < 200 || result.status >= 300) throw problemOf(result);
  return result;
}

function parsedAs(compiled: Compiled, value: unknown): unknown {
  const parsed = compiled.parse(value);
  if (!parsed.ok) throw unexpected();
  return parsed.value;
}

function flagged(stats: CleanStats): { truncated?: true } {
  return stats.truncated ? { truncated: true } : {};
}

// The cursor goes back to the admin API as the client sends it, so it is never
// cleaned or cut: one that cannot be sent back is refused instead.
function cursorOf(next: unknown): { next_cursor?: string } {
  if (next === undefined) return {};
  if (typeof next !== 'string' || next.length > INPUT_STRING_CAP || !OPAQUE.test(next)) {
    throw new ToolProblem(
      'mcp:unexpected_response',
      'The admin API answered a cursor that is not one to pass back',
      null,
    );
  }
  return { next_cursor: next };
}

function schemaOf(entry: CatalogueEntry, member: string): unknown {
  const properties = entry.outputSchema.properties;
  if (typeof properties !== 'object' || properties === null) return undefined;
  return Object.fromEntries(Object.entries(properties))[member];
}

function pageRun(entry: CatalogueEntry) {
  const response = compile(entry.outputSchema);
  const rows = compile(schemaOf(entry, 'items'));
  return async (caller: AdminCaller, input: Record<string, unknown>): Promise<ToolData> => {
    const result = await okResult(caller, readRequest(entry, input));
    const body = parsedAs(response, result.body) as { items: unknown; next?: unknown };
    const stats: CleanStats = { truncated: false };
    const data = parsedAs(rows, cleanData(body.items, stats));
    return { data, ...cursorOf(body.next), ...flagged(stats) };
  };
}

function valueRun(entry: CatalogueEntry) {
  const response = compile(entry.outputSchema);
  const long = entry.longText ?? [];
  return async (caller: AdminCaller, input: Record<string, unknown>): Promise<ToolData> => {
    const result = await okResult(caller, readRequest(entry, input));
    const stats: CleanStats = { truncated: false };
    const body = parsedAs(response, result.body);
    const data = parsedAs(response, cleanData(body, stats, { longText: long }));
    const etag = result.headers.etag;
    return { data, ...(entry.etag === true && isEtag(etag) ? { etag } : {}), ...flagged(stats) };
  };
}

function writeRequest(entry: CatalogueEntry, input: Record<string, unknown>): AdminRequestSpec {
  const params = Object.fromEntries(
    entry.pathParams.map((name): [string, string] => {
      const value = input[name];
      if (typeof value !== 'string') throw new Error(`${name} is a string once validated`);
      return [name, value];
    }),
  );
  const ifMatch = input.if_match;
  return {
    method: entry.method,
    pattern: entry.pathTemplate,
    params,
    query: {},
    body: bodyOf(entry.bodyFields ?? [], input),
    ...(typeof ifMatch === 'string' ? { ifMatch } : {}),
    ...(entry.bodyCap === undefined ? {} : { bodyCap: entry.bodyCap }),
  };
}

function refusedAs(result: AdminResult, entry: CatalogueEntry): ToolProblem {
  const problem = problemOf(result);
  if (result.status === 412) {
    return new ToolProblem(problem.problemType, problem.title, 412, entry.stale);
  }
  if (result.status === 403 && problem.detail === 'insufficient_scope') {
    return new ToolProblem(problem.problemType, problem.title, 403, entry.refusal);
  }
  return problem;
}

function writeRun(entry: CatalogueEntry) {
  const response = compile(entry.outputSchema);
  return async (caller: AdminCaller, input: Record<string, unknown>): Promise<ToolData> => {
    const result = await caller.call(writeRequest(entry, input));
    if (result.status < 200 || result.status >= 300) throw refusedAs(result, entry);
    const stats: CleanStats = { truncated: false };
    const data = parsedAs(response, cleanData(parsedAs(response, result.body), stats));
    const etag = result.headers.etag;
    return { data, ...(isEtag(etag) ? { etag } : {}), ...flagged(stats) };
  };
}

function runOf(entry: CatalogueEntry) {
  if (entry.kind === 'page') return pageRun(entry);
  if (entry.kind === 'value') return valueRun(entry);
  return writeRun(entry);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

// A tool as a client calls it: the arguments arrive untyped and are checked
// first, so nothing is sent to the admin API for a call the schema refuses, and
// what the route answers is read against its declared response last.
export function toolOf(entry: CatalogueEntry): RegisteredTool {
  const validate = validatorOf(entry);
  const run = runOf(entry);
  return {
    name: entry.name,
    description: entry.description,
    routeKey: `${entry.method} ${entry.pathTemplate}`,
    access: entry.scope === 'mcp:read' ? 'read' : 'write',
    ...(entry.spends === undefined ? {} : { spends: entry.spends }),
    ...(entry.tooLargeDetail === undefined ? {} : { tooLargeDetail: entry.tooLargeDetail }),
    ...(entry.bodyFields === undefined ? {} : { bodyFields: entry.bodyFields }),
    annotations: entry.annotations,
    inputSchema: entry.inputSchema,
    input: {
      safeParse(raw) {
        const checked = validate(raw);
        return checked.ok
          ? { success: true, data: checked.args }
          : { success: false, detail: checked.detail };
      },
    },
    run: async (caller, raw) => {
      const checked = validate(raw);
      if (!checked.ok) throw invalidArguments(checked.detail);
      return run(caller, checked.args);
    },
  };
}
