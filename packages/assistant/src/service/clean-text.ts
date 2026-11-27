import type { JsonValue } from '@odudu/mcp';

const MAX_DEPTH = 32;
const REPLACEMENT = '�';
// NUL, and a surrogate with no partner: PostgreSQL refuses either in jsonb and in
// text, so one in a model's answer would fail the write of a whole batch. With the
// `u` flag a pair is one code point and is not matched, only a lone half is.
const UNSTORABLE = /\u0000|[\uD800-\uDFFF]/gu;

export function cleanText(text: string): string {
  return text.replace(UNSTORABLE, REPLACEMENT);
}

/** The value with every string, and every member name, made storable. */
export function cleanJson(value: JsonValue, depth = 0): JsonValue {
  if (typeof value === 'string') return cleanText(value);
  if (typeof value !== 'object' || value === null) return value;
  if (depth >= MAX_DEPTH) return REPLACEMENT;
  if (Array.isArray(value)) return (value as JsonValue[]).map((item) => cleanJson(item, depth + 1));
  const out: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value)) out[cleanText(key)] = cleanJson(item, depth + 1);
  return out;
}
