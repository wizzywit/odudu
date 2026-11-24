import { createHash } from 'node:crypto';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object' && value !== null) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

// JSON with every object's keys in code-unit order, so two spellings of one
// value serialise to the same bytes.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value));
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
