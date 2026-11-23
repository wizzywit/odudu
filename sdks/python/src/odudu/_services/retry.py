"""When a request is repeated and how long to wait first."""

from __future__ import annotations

import re

MAX_RETRIES = 2
BASE_DELAY_SECONDS = 0.2
MAX_DELAY_SECONDS = 5.0
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS", "PUT", "DELETE"})
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})
_SECONDS = re.compile(r"[0-9]+(?:\.[0-9]+)?")


def is_retryable_status(status: int) -> bool:
    """501 and 505 will not change on a repeat."""
    return status in _RETRYABLE_STATUSES


def may_retry(method: str, has_key: bool) -> bool:
    """A repeat is harmless for the methods HTTP defines as idempotent and for a call with a key."""
    return method.upper() in _SAFE_METHODS or has_key


def retry_delay_seconds(attempt: int, retry_after: str | None) -> float:
    """`Retry-After` seconds when the server names them, else doubling from 0.2; never over 5."""
    given = retry_after.strip() if retry_after is not None else ""
    wanted = float(given) if _SECONDS.fullmatch(given) else BASE_DELAY_SECONDS * 2**attempt
    return min(wanted, MAX_DELAY_SECONDS)
