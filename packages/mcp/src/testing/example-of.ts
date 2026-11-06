import type { z } from 'zod';

interface Def {
  readonly type: string;
  readonly [key: string]: unknown;
}

const STRINGS = [
  'example',
  '0192a0a0-0000-7000-8000-000000000000',
  '2026-01-01T00:00:00.000Z',
  'user@example.com',
  'https://example.com/path',
  '2026-01-01',
  'a'.repeat(64),
  '#1a2b3c',
  'en',
];
const NUMBERS = [1, 0, 5, 100];

function defOf(schema: z.ZodType): Def {
  return schema.def as unknown as Def;
}

function firstValid(schema: z.ZodType, candidates: readonly unknown[]): unknown {
  const found = candidates.find((candidate) => schema.safeParse(candidate).success);
  if (found === undefined) throw new Error(`no example satisfies a ${defOf(schema).type} schema`);
  return found;
}

function asSchema(value: unknown): z.ZodType {
  return value as z.ZodType;
}

// A value a contract schema accepts, built from the schema alone: objects
// carry every key, so a test can put text into any field it names.
export function exampleOf(schema: z.ZodType): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case 'object': {
      const shape = def.shape as Record<string, z.ZodType>;
      return Object.fromEntries(Object.entries(shape).map(([key, item]) => [key, exampleOf(item)]));
    }
    case 'array':
      return [exampleOf(asSchema(def.element))];
    case 'optional':
    case 'default':
    case 'readonly':
    case 'prefault':
      return exampleOf(asSchema(def.innerType));
    case 'nullable':
      return exampleOf(asSchema(def.innerType));
    case 'union':
      return exampleOf(asSchema((def.options as unknown[])[0]));
    case 'record':
      return {};
    case 'enum':
      return Object.values(def.entries as Record<string, unknown>)[0];
    case 'literal':
      return (def.values as unknown[])[0];
    case 'boolean':
      return true;
    case 'null':
      return null;
    case 'number':
    case 'int':
      return firstValid(schema, NUMBERS);
    case 'string':
      return firstValid(schema, STRINGS);
    case 'unknown':
    case 'any':
      return 'value';
    default:
      throw new Error(`exampleOf does not handle a ${def.type} schema`);
  }
}
