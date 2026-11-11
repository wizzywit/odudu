import { DEFAULT_LIMIT, MAX_LIMIT } from '@odudu/contracts/me';

// An over-large limit is a page size to bring down, not a request to refuse.
export function pageLimit(requested: number | undefined): number {
  return Math.min(requested ?? DEFAULT_LIMIT, MAX_LIMIT);
}

// A list is read one row past its limit; the extra row says whether a next
// page exists and is not returned.
export function splitPage<Row>(
  rows: readonly Row[],
  limit: number,
): { readonly items: readonly Row[]; readonly hasMore: boolean } {
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}
