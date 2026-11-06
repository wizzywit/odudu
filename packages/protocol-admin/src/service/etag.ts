import { createHash } from 'node:crypto';

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    // A plain `{}` accumulator treats an own `__proto__` key as a request
    // to set the prototype rather than a data property, so it vanishes
    // from the canonical form instead of being sorted into it. A
    // null-prototype object has no such setter, so every own key —
    // `__proto__` included — is written as data.
    const sorted: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
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

function members(ifMatch: string): string[] {
  return ifMatch.split(',').map((member) => member.trim());
}

// A header that is, or lists, the wildcard names no version, so it cannot
// stand for one that was read.
export function hasPrecondition(ifMatch: string | undefined): boolean {
  return ifMatch !== undefined && !members(ifMatch).includes('*');
}

/**
 * The precondition the design spec makes mandatory on a write that
 * replaces an authorization-bearing list whole: an absent `If-Match` is
 * `428`, not a silent last-write-wins that reinstates exactly what another
 * administrator has just removed. `*` matches whatever is stored, so it
 * counts as absent.
 */
export function requiredPrecondition(
  ifMatch: string | undefined,
  current: string,
): 'required' | 'failed' | 'ok' {
  if (!hasPrecondition(ifMatch)) return 'required';
  return matches(ifMatch, current) === 'match' ? 'ok' : 'failed';
}

// RFC 9110 §13.1.1: a comma-separated list of strong validators, or `*`
// for "if the resource exists", which already holds by the time `current`
// is in hand. A weak validator never matches.
export function matches(
  ifMatch: string | undefined,
  current: string,
): 'absent' | 'match' | 'mismatch' {
  if (ifMatch === undefined) return 'absent';
  return members(ifMatch).some((member) => member === '*' || member === current)
    ? 'match'
    : 'mismatch';
}
