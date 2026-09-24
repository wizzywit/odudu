import { DEFAULT_LIMIT, MAX_LIMIT } from '@odudu/contracts/admin';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export { DEFAULT_LIMIT, MAX_LIMIT };

const LIMIT_PATTERN = /^[1-9][0-9]*$/;

export function coerceLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  if (!LIMIT_PATTERN.test(raw)) {
    throw new RangeError(`limit must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return Math.min(Number(raw), MAX_LIMIT);
}

// Built from the request's own validated query rather than the two fields
// every list happened to have when this was first written — a filter added
// to one listing (`search`, on subjects) carries into its own `next` link
// for free instead of needing this rewritten at the same time.
export function nextPageUrl(
  path: string,
  query: Readonly<Record<string, string | number | undefined>>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  return `${path}?${params.toString()}`;
}

export interface CursorPayload {
  readonly after: string;
  readonly collection: string;
  readonly tenantId: string;
}

// Distinct from the KEK a caller passes as `key` — a cursor tag and an
// encrypted secret must never share key material.
function hmacKey(key: Uint8Array): Buffer {
  return createHash('sha256').update(key).update('odudu-admin-cursor-v1').digest();
}

function tag(key: Uint8Array, payload: string): Buffer {
  return createHmac('sha256', hmacKey(key)).update(payload).digest();
}

export function encodeCursor(key: Uint8Array, c: CursorPayload): string {
  const payload = JSON.stringify(c);
  const framed = `${Buffer.from(payload, 'utf8').toString('base64url')}.${tag(key, payload).toString('base64url')}`;
  return framed;
}

export function decodeCursor(
  key: Uint8Array,
  collection: string,
  tenantId: string,
  raw: string,
): { kind: 'ok'; after: string } | { kind: 'invalid' } {
  const parts = raw.split('.');
  if (parts.length !== 2) return { kind: 'invalid' };
  const payloadPart = parts[0];
  const tagPart = parts[1];
  if (payloadPart === undefined || tagPart === undefined) return { kind: 'invalid' };

  let payload: string;
  let expected: Buffer;
  let received: Buffer;
  try {
    payload = Buffer.from(payloadPart, 'base64url').toString('utf8');
    received = Buffer.from(tagPart, 'base64url');
    expected = tag(key, payload);
  } catch {
    return { kind: 'invalid' };
  }

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return { kind: 'invalid' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: 'invalid' };
  }
  if (typeof parsed !== 'object' || parsed === null) return { kind: 'invalid' };

  const candidate = parsed as Record<string, unknown>;
  if (
    typeof candidate.after !== 'string' ||
    candidate.collection !== collection ||
    candidate.tenantId !== tenantId
  ) {
    return { kind: 'invalid' };
  }

  return { kind: 'ok', after: candidate.after };
}
