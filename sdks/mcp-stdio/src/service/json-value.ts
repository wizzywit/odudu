import type { JsonObject, JsonValue } from '#/service/tool';

// A value as JSON, or a refusal to send anything that is not: a tool builds a
// body only from values that survive a round trip through JSON unchanged.
export function jsonOf(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map((item): JsonValue => jsonOf(item));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]): [string, JsonValue] => [key, jsonOf(item)]),
    );
  }
  throw new Error('a write tool sends JSON values only');
}

// The same for a record, whose members are each such a value.
export function jsonObjectOf(value: object): JsonObject {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]): [string, JsonValue] => [key, jsonOf(item)]),
  );
}
