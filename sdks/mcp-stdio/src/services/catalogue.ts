import { StdioError } from '#/services/stdio-error';
import type { ToolAnnotations } from '#/services/tool';
import type { BudgetKind } from '#/services/write-budget';

export type ToolKind = 'page' | 'value' | 'write';

// One tool as the generated file holds it: how to address its route, how to cut
// the answer, and the JSON Schema of what goes in and of what the route answers.
export interface CatalogueEntry {
  readonly name: string;
  readonly description: string;
  readonly scope: 'mcp:read' | 'mcp:write';
  readonly method: 'GET' | 'PATCH' | 'POST' | 'PUT' | 'DELETE';
  readonly pathTemplate: string;
  readonly kind: ToolKind;
  readonly annotations: ToolAnnotations;
  readonly pathParams: readonly string[];
  readonly bodyFields?: readonly string[];
  readonly spends?: BudgetKind;
  readonly etag?: true;
  readonly longText?: readonly string[];
  readonly tooLargeDetail?: string;
  readonly bodyCap?: number;
  readonly refusal?: string;
  readonly stale?: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface Catalogue {
  readonly tools: readonly CatalogueEntry[];
}

function refuse(reason: string): never {
  throw new StdioError('mcp_catalogue_invalid', `the tool catalogue ${reason}`);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return refuse(`${where} is not an object`);
  }
  return Object.fromEntries(Object.entries(value));
}

function text(entry: Record<string, unknown>, field: string, where: string): string {
  const value = entry[field];
  return typeof value === 'string' ? value : refuse(`${where} has no ${field} text`);
}

function oneOf<T extends string>(
  entry: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
  where: string,
): T {
  const value = entry[field];
  const found = allowed.find((candidate) => candidate === value);
  return found ?? refuse(`${where} has a ${field} that is not one of ${allowed.join(', ')}`);
}

function texts(entry: Record<string, unknown>, field: string, where: string): string[] {
  const value = entry[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return refuse(`${where} has a ${field} that is not a list of text`);
  }
  return value as string[];
}

function optionalText(entry: Record<string, unknown>, field: string, where: string) {
  return entry[field] === undefined ? {} : { [field]: text(entry, field, where) };
}

function annotationsOf(value: unknown, where: string): ToolAnnotations {
  const found = record(value, `${where} annotations`);
  const flag = (name: string): boolean =>
    typeof found[name] === 'boolean' ? found[name] : refuse(`${where} has no ${name} flag`);
  return {
    readOnlyHint: flag('readOnlyHint'),
    destructiveHint: flag('destructiveHint'),
    idempotentHint: flag('idempotentHint'),
  };
}

function optionalFields(entry: Record<string, unknown>, where: string) {
  const bodyCap = entry.bodyCap;
  if (bodyCap !== undefined && (typeof bodyCap !== 'number' || !Number.isSafeInteger(bodyCap))) {
    refuse(`${where} has a bodyCap that is not a whole number`);
  }
  return {
    ...(entry.bodyFields === undefined ? {} : { bodyFields: texts(entry, 'bodyFields', where) }),
    ...(entry.spends === undefined
      ? {}
      : { spends: oneOf(entry, 'spends', ['mutating', 'create'] as const, where) }),
    ...(entry.etag === true ? { etag: true as const } : {}),
    ...(entry.longText === undefined ? {} : { longText: texts(entry, 'longText', where) }),
    ...optionalText(entry, 'tooLargeDetail', where),
    ...(typeof bodyCap === 'number' ? { bodyCap } : {}),
    ...optionalText(entry, 'refusal', where),
    ...optionalText(entry, 'stale', where),
  };
}

function entryOf(value: unknown, index: number): CatalogueEntry {
  const where = `entry ${String(index)}`;
  const entry = record(value, where);
  const name = text(entry, 'name', where);
  const at = `tool ${name}`;
  const pathTemplate = text(entry, 'pathTemplate', at);
  if (!pathTemplate.startsWith('/')) refuse(`${at} has a path template that is not a path`);
  return {
    name,
    description: text(entry, 'description', at),
    scope: oneOf(entry, 'scope', ['mcp:read', 'mcp:write'] as const, at),
    method: oneOf(entry, 'method', ['GET', 'PATCH', 'POST', 'PUT', 'DELETE'] as const, at),
    pathTemplate,
    kind: oneOf(entry, 'kind', ['page', 'value', 'write'] as const, at),
    annotations: annotationsOf(entry.annotations, at),
    pathParams: texts(entry, 'pathParams', at),
    ...optionalFields(entry, at),
    inputSchema: record(entry.inputSchema, `${at} inputSchema`),
    outputSchema: record(entry.outputSchema, `${at} outputSchema`),
  };
}

// The generated file read for what it is: a list of tools, each with the fields
// a call needs, and nothing taken on trust from its shape.
export function parseCatalogue(value: unknown): Catalogue {
  const document = record(value, 'file');
  const tools = document.tools;
  if (!Array.isArray(tools)) return refuse('file has no tools list');
  return { tools: (tools as unknown[]).map(entryOf) };
}
