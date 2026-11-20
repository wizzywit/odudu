"""The rules of walking a list by cursor."""

from __future__ import annotations

from dataclasses import dataclass

DEFAULT_PAGE_LIMIT = 50
DEFAULT_MAX_ITEMS = 10_000


@dataclass(frozen=True)
class PageRequest:
    """What one request of an iteration asks for. `cursor` is None for the first page."""

    limit: int
    cursor: str | None = None


@dataclass(frozen=True)
class Bounds:
    page_limit: int
    max_items: int


def _positive_integer(name: str, value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{name} must be a positive integer")
    return value


def resolve_bounds(page_limit: object, max_items: object) -> Bounds:
    return Bounds(
        page_limit=_positive_integer("page_limit", page_limit),
        max_items=_positive_integer("max_items", max_items),
    )


def page_request(bounds: Bounds, collected: int, cursor: str | None) -> PageRequest:
    """Never more than a page, and never more than the items still wanted."""
    return PageRequest(limit=min(bounds.page_limit, bounds.max_items - collected), cursor=cursor)


def page_of(result: object) -> object:
    """The page itself, whether a call returned it or a detailed response holding it."""
    if hasattr(result, "parsed"):
        result = result.parsed
    if not hasattr(result, "items"):
        raise TypeError("the call did not return a page of items")
    return result


def items_of(page: object) -> list[object]:
    items = getattr(page, "items", None)
    if not isinstance(items, list):
        raise TypeError("the call did not return a page of items")
    return items


def next_cursor(page: object) -> str | None:
    """The cursor of the next page: `next_` on the admin API, `next_cursor` on the account API."""
    for name in ("next_", "next_cursor"):
        value = getattr(page, name, None)
        if isinstance(value, str) and value != "":
            return value
    return None


def is_last_page(items: int, next_: str | None, cursor: str | None) -> bool:
    """Ends on an empty page, no cursor or an unmoved cursor, so a faulty server cannot loop it."""
    return items == 0 or next_ is None or next_ == cursor
