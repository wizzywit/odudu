import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { decodeCursor, encodeCursor, filterDigest } from '#/service/cursor';
import { type IdPageOutcome, type IdPageRequest } from '#/usecase/id-page';

/** Where a most-recent-first listing resumes: strictly older than this row. */
export interface RecentPosition {
  readonly at: Date;
  readonly id: string;
}

// The cursor packs the composite key the tuple comparison resumes from,
// as the audit listing's does: `created_at` alone is not unique.
export function resumeBefore(
  request: IdPageRequest,
): { kind: 'invalid' } | { kind: 'ok'; before: RecentPosition | undefined } {
  if (request.cursor === undefined) return { kind: 'ok', before: undefined };
  const decoded = decodeCursor(
    request.cursorKey,
    request.collection,
    request.tenantId,
    filterDigest(request.filters),
    request.cursor,
  );
  if (decoded.kind === 'invalid') return decoded;
  const separator = decoded.after.lastIndexOf('|');
  const at = new Date(decoded.after.slice(0, separator));
  const id = decoded.after.slice(separator + 1);
  if (separator === -1 || Number.isNaN(at.getTime()) || id.length === 0) return { kind: 'invalid' };
  return { kind: 'ok', before: { at, id } };
}

/** `(createdAt, id) < before`, the condition a page past the first adds. */
export function olderThan(createdAt: AnyColumn, id: AnyColumn, before: RecentPosition): SQL {
  return sql`(${createdAt}, ${id}) < (${before.at.toISOString()}::timestamptz, ${before.id}::uuid)`;
}

/** `rows` fetched newest first with one row past `limit`, cut to a page and its cursor. */
export function recentPage<T extends { readonly id: string; readonly createdAt: Date }>(
  request: IdPageRequest,
  rows: readonly T[],
): IdPageOutcome<T> {
  const hasMore = rows.length > request.limit;
  const items = rows.slice(0, request.limit);
  const last = items[items.length - 1];
  const next =
    hasMore && last !== undefined
      ? encodeCursor(request.cursorKey, {
          after: `${last.createdAt.toISOString()}|${last.id}`,
          collection: request.collection,
          tenantId: request.tenantId,
          filters: filterDigest(request.filters),
        })
      : null;
  return { kind: 'ok', items, next };
}
