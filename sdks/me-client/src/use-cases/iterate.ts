import { isLastPage, nextCursor, pageRequest, resolveBounds } from '#/services/pagination';
import type { IterateOptions, Page, PageRequest } from '#/types';

/**
 * Walks a list by cursor, one request per page, and ends after `maxItems` items
 * however many the server holds:
 *
 *     for await (const client of iterate((page) =>
 *       api.GET('/admin/tenants/{tenant}/clients', { params: { query: page } }),
 *     )) { ... }
 */
export async function* iterate<T>(
  listCall: (page: PageRequest) => Promise<{ data: Page<T> }>,
  options: IterateOptions = {},
): AsyncGenerator<T, void, undefined> {
  const bounds = resolveBounds(options);
  let collected = 0;
  let cursor: string | undefined;
  while (collected < bounds.maxItems) {
    const { data } = await listCall(pageRequest(bounds, collected, cursor));
    const items = data.items.slice(0, bounds.maxItems - collected);
    yield* items;
    collected += items.length;
    const next = nextCursor(data);
    if (isLastPage(items.length, next, cursor)) return;
    cursor = next;
  }
}
