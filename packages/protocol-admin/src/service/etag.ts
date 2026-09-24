import { createHash } from 'node:crypto';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = canonicalize(record[key]);
    }
    return sorted;
  }
  return value;
}

export function etagOf(record: unknown): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(canonicalize(record)))
    .digest('hex');
  return `"${digest}"`;
}

export function matches(
  ifMatch: string | undefined,
  current: string,
): 'absent' | 'match' | 'mismatch' {
  if (ifMatch === undefined) return 'absent';
  return ifMatch === current && ifMatch !== '*' ? 'match' : 'mismatch';
}
