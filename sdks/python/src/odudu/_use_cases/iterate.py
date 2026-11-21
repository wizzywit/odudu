"""Walking a list by cursor, one request per page."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable, Iterator

from odudu._services.pagination import (
    DEFAULT_MAX_ITEMS,
    DEFAULT_PAGE_LIMIT,
    Bounds,
    PageRequest,
    is_last_page,
    items_of,
    next_cursor,
    page_of,
    page_request,
    resolve_bounds,
)


def _walk(call: Callable[[PageRequest], object], bounds: Bounds) -> Iterator[object]:
    collected = 0
    cursor: str | None = None
    while collected < bounds.max_items:
        page = page_of(call(page_request(bounds, collected, cursor)))
        items = items_of(page)[: bounds.max_items - collected]
        yield from items
        collected += len(items)
        following = next_cursor(page)
        if is_last_page(len(items), following, cursor):
            return
        cursor = following


async def _awalk(
    call: Callable[[PageRequest], Awaitable[object]], bounds: Bounds
) -> AsyncIterator[object]:
    collected = 0
    cursor: str | None = None
    while collected < bounds.max_items:
        page = page_of(await call(page_request(bounds, collected, cursor)))
        items = items_of(page)[: bounds.max_items - collected]
        for item in items:
            yield item
        collected += len(items)
        following = next_cursor(page)
        if is_last_page(len(items), following, cursor):
            return
        cursor = following


def iterate_pages(
    call: Callable[[PageRequest], object],
    page_limit: int = DEFAULT_PAGE_LIMIT,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> Iterator[object]:
    """Yields the items of a list, requesting one page at a time and at most `max_items` in all.

    `call` receives the `PageRequest` to make and returns the page or the detailed response
    holding it. A refusal raises `ProblemError` out of the iteration.
    """
    return _walk(call, resolve_bounds(page_limit, max_items))


def aiterate_pages(
    call: Callable[[PageRequest], Awaitable[object]],
    page_limit: int = DEFAULT_PAGE_LIMIT,
    max_items: int = DEFAULT_MAX_ITEMS,
) -> AsyncIterator[object]:
    """The asynchronous `iterate_pages`: `async for item in aiterate_pages(call)`."""
    return _awalk(call, resolve_bounds(page_limit, max_items))
