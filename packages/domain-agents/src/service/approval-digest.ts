import { createHash } from 'node:crypto';

const MAX_DEPTH = 64;

function notPlain(what: string): never {
  throw new Error(`canonicalJson: ${what} is not plain JSON data`);
}

function canonical(value: unknown, ancestors: unknown[]): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return notPlain(String(value));
    if (Object.is(value, -0)) return notPlain('negative zero');
    return value;
  }
  if (typeof value !== 'object') return notPlain(typeof value);
  if (ancestors.length >= MAX_DEPTH) {
    throw new Error(`canonicalJson: structure is deeper than ${String(MAX_DEPTH)} levels`);
  }
  if (ancestors.includes(value)) throw new Error('canonicalJson: structure contains a cycle');
  const path = [...ancestors, value];
  if (Array.isArray(value)) {
    return Array.from({ length: value.length }, (_, i) => canonical(value[i], path));
  }
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) notPlain('an object that is not a plain one');
  if (Object.getOwnPropertySymbols(value).length > 0) notPlain('an object with a symbol key');
  // No prototype, so a `__proto__` member is an own key like any other.
  const sorted = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    sorted[key] = canonical((value as Record<string, unknown>)[key], path);
  }
  return sorted;
}

// JSON with every object's keys in code-unit order, so two spellings of one
// value serialise to the same bytes. Anything JSON would drop or collapse
// (undefined, NaN, a Date, a cycle) throws rather than share a digest.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value, []));
}

export interface ApprovalDigestInput {
  name: string;
  input: unknown;
  tenantId: string;
  ownerSubjectId: string;
  instanceId: string | null;
}

// Names the exact action an approval covers; the fields are members of one
// object, so text moved between them changes the digest.
export function approvalDigest(input: ApprovalDigestInput): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
