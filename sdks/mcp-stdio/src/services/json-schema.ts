import { z } from 'zod';

export type Parsed = { readonly ok: true; readonly value: unknown } | { readonly ok: false };

export interface Compiled {
  parse(value: unknown): Parsed;
}

const REFUSED: Parsed = { ok: false };

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(value));
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function compileAll(schemas: unknown): Compiled[] {
  return Array.isArray(schemas) ? schemas.map((schema: unknown) => compile(schema)) : [];
}

function firstOf(branches: readonly Compiled[]): Compiled {
  return {
    parse(value) {
      for (const branch of branches) {
        const parsed = branch.parse(value);
        if (parsed.ok) return parsed;
      }
      return REFUSED;
    },
  };
}

function arrayOf(schema: Record<string, unknown>): Compiled {
  const item = compile(schema.items);
  const min = numberOf(schema.minItems);
  const max = numberOf(schema.maxItems);
  return {
    parse(value) {
      if (!Array.isArray(value)) return REFUSED;
      if ((min !== undefined && value.length < min) || (max !== undefined && value.length > max)) {
        return REFUSED;
      }
      const out: unknown[] = [];
      for (const element of value as unknown[]) {
        const parsed = item.parse(element);
        if (!parsed.ok) return REFUSED;
        out.push(parsed.value);
      }
      return { ok: true, value: out };
    },
  };
}

function objectOf(schema: Record<string, unknown>): Compiled {
  const declared = record(schema.properties) ?? {};
  const members = new Map(Object.entries(declared).map(([key, item]) => [key, compile(item)]));
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  const rest =
    record(schema.additionalProperties) === undefined
      ? undefined
      : compile(schema.additionalProperties);
  const names = schema.propertyNames === undefined ? undefined : compile(schema.propertyNames);
  const max = numberOf(schema.maxProperties);
  return {
    parse(value) {
      const input = record(value);
      if (input === undefined) return REFUSED;
      if (max !== undefined && Object.keys(input).length > max) return REFUSED;
      if (required.some((key) => typeof key !== 'string' || !Object.hasOwn(input, key))) {
        return REFUSED;
      }
      // No prototype, and each member defined rather than assigned, so a key
      // such as `__proto__` is a member like any other.
      const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const [key, item] of Object.entries(input)) {
        if (names !== undefined && !names.parse(key).ok) return REFUSED;
        const member = members.get(key) ?? rest;
        // A member the schema does not name is not passed on.
        if (member === undefined) continue;
        const parsed = member.parse(item);
        if (!parsed.ok) return REFUSED;
        Object.defineProperty(out, key, {
          value: parsed.value,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return { ok: true, value: out };
    },
  };
}

function leafOf(schema: unknown): Compiled {
  const checker = z.fromJSONSchema(schema as Parameters<typeof z.fromJSONSchema>[0]);
  return {
    parse(value) {
      const parsed = checker.safeParse(value);
      return parsed.success ? { ok: true, value: parsed.data } : REFUSED;
    },
  };
}

// A reader for the JSON Schema `z.toJSONSchema` writes for a response. It does
// what a Zod object does with its answer: a member the schema does not name is
// left out of what it returns, which a schema validator reads as allowed and
// would pass on. Objects, arrays and unions are walked here; anything else
// is handed to Zod's own reader of JSON Schema.
export function compile(schema: unknown): Compiled {
  const node = record(schema);
  if (node === undefined) return leafOf(schema);
  const union = node.anyOf ?? node.oneOf;
  if (Array.isArray(union)) return firstOf(compileAll(union));
  if (node.type === 'array') return arrayOf(node);
  if (node.type === 'object' || node.properties !== undefined) return objectOf(node);
  return leafOf(schema);
}
