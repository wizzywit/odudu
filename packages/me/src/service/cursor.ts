import { isUuid } from '@odudu/kernel';

// A position in one list, opaque to the client. Nothing in it is trusted: the
// query that reads it is by the token's own subject whatever it says, so a
// forged one can only move within that subject's rows, and it is refused
// unless it has the shape the list pages by.
const MAX_CURSOR_LENGTH = 512;

export type PagedBy = 'uuid' | 'text';

export type DecodedCursor =
  { readonly kind: 'ok'; readonly after: string } | { readonly kind: 'invalid' };

export function encodeCursor(collection: string, after: string): string {
  return Buffer.from(JSON.stringify([collection, after]), 'utf8').toString('base64url');
}

export function decodeCursor(collection: string, raw: string, pagedBy: PagedBy): DecodedCursor {
  const invalid = { kind: 'invalid' } as const;
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return invalid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return invalid;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) return invalid;
  const [named, after] = parsed as unknown[];
  if (named !== collection || typeof after !== 'string' || after.length === 0) return invalid;
  if (pagedBy === 'uuid' && !isUuid(after)) return invalid;
  return { kind: 'ok', after };
}

export type Start =
  { readonly kind: 'ok'; readonly after: string | undefined } | { readonly kind: 'invalid' };

// Where a list read begins: the beginning when no cursor came, else after the
// position the cursor names.
export function startAfter(collection: string, raw: string | undefined, pagedBy: PagedBy): Start {
  if (raw === undefined) return { kind: 'ok', after: undefined };
  return decodeCursor(collection, raw, pagedBy);
}

// The cursor of the page after this one, null where this is the last.
export function nextCursor(
  collection: string,
  hasMore: boolean,
  lastPosition: string | undefined,
): string | null {
  return hasMore && lastPosition !== undefined ? encodeCursor(collection, lastPosition) : null;
}
