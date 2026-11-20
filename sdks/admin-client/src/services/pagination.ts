import type { IterateOptions, Page, PageRequest } from '#/types';

const DEFAULT_PAGE_LIMIT = 50;
const DEFAULT_MAX_ITEMS = 10_000;

export interface Bounds {
  pageLimit: number;
  maxItems: number;
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

export function resolveBounds(options: IterateOptions): Bounds {
  return {
    pageLimit: positiveInteger('pageLimit', options.pageLimit ?? DEFAULT_PAGE_LIMIT),
    maxItems: positiveInteger('maxItems', options.maxItems ?? DEFAULT_MAX_ITEMS),
  };
}

/** Never more than a page, and never more than the items still wanted. */
export function pageRequest(
  bounds: Bounds,
  collected: number,
  cursor: string | undefined,
): PageRequest {
  const limit = Math.min(bounds.pageLimit, bounds.maxItems - collected);
  return cursor === undefined ? { limit } : { limit, cursor };
}

export function nextCursor(page: Page<unknown>): string | undefined {
  const next = page.next ?? page.next_cursor;
  return next === null || next === undefined || next === '' ? undefined : next;
}

/** Iteration ends on an empty page, on no cursor and on a cursor that did not move, so a faulty server cannot loop it. */
export function isLastPage(
  items: number,
  next: string | undefined,
  cursor: string | undefined,
): boolean {
  return items === 0 || next === undefined || next === cursor;
}
