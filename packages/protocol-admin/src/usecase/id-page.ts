import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';

/** A listing keyset-paged by row id alone, as every unsearched listing here is. */
export interface IdPageRequest {
  readonly collection: string;
  readonly tenantId: string;
  readonly filters: Readonly<Record<string, string | undefined>>;
  readonly limit: number;
  readonly cursor: string | undefined;
  readonly cursorKey: Uint8Array;
}

export type IdPageOutcome<T> =
  { kind: 'invalid_cursor' } | { kind: 'ok'; items: T[]; next: string | null };

/** The id to resume after, or `invalid` for a cursor minted for another listing. */
export function resumeAfter(
  request: IdPageRequest,
): { kind: 'invalid' } | { kind: 'ok'; after: string | undefined } {
  if (request.cursor === undefined) return { kind: 'ok', after: undefined };
  const decoded = decodeCursor(
    request.cursorKey,
    request.collection,
    request.tenantId,
    filterDigest(request.filters),
    request.cursor,
  );
  return decoded.kind === 'invalid' ? decoded : { kind: 'ok', after: decoded.after };
}

/** `rows` fetched in id order with one row past `limit`, cut to a page and its cursor. */
export function idPage<T extends { readonly id: string }>(
  request: IdPageRequest,
  rows: readonly T[],
): IdPageOutcome<T> {
  const hasMore = rows.length > request.limit;
  const items = rows.slice(0, request.limit);
  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(request.cursorKey, {
          after: last.id,
          collection: request.collection,
          tenantId: request.tenantId,
          filters: filterDigest(request.filters),
        })
      : null;
  return { kind: 'ok', items, next };
}
