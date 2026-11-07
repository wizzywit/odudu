import { createHash } from 'node:crypto';
import { type ThemeBody } from '@odudu/domain-theme';

const PARTS = ['tokens', 'stylesheet', 'templates', 'assets'] as const;

// JSON with the keys of every object in order, so the same content has one text
// whether it came from a request or from a jsonb column.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function digestOf(text: string) {
  return {
    bytes: Buffer.byteLength(text),
    sha256: createHash('sha256').update(text).digest('hex'),
  };
}

// What a draft save changed, for the audit row: the parts that differ, each with
// the length and SHA-256 of its stored form before and after. Never the text, so
// the row stays small however large the draft is; it proves what changed and
// does not bring it back.
export function draftChange(
  scope: 'tenant' | 'client',
  before: ThemeBody | null,
  after: ThemeBody,
) {
  const changed: Record<
    string,
    { before: ReturnType<typeof digestOf> | null; after: ReturnType<typeof digestOf> }
  > = {};
  for (const part of PARTS) {
    const now = canonical(after[part]);
    const was = before === null ? null : canonical(before[part]);
    if (was !== now)
      changed[part] = { before: was === null ? null : digestOf(was), after: digestOf(now) };
  }
  return { scope, changed };
}
