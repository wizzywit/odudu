"""Which calls the API takes an `Idempotency-Key` for."""

from __future__ import annotations

import re
from functools import lru_cache

_PARAMETER = re.compile(r"\{[^}/]+\}")


@lru_cache(maxsize=512)
def _pattern(template: str) -> re.Pattern[str]:
    literals = _PARAMETER.split(template)
    return re.compile("[^/]+".join(re.escape(part) for part in literals))


def is_idempotent(method: str, path: str, operations: frozenset[tuple[str, str]]) -> bool:
    """Whether the request path, as sent, is one of the operations the document marks.

    A path parameter matches one non-empty segment. `path` is the encoded path without the
    query and without any base path of the server.
    """
    verb = method.upper()
    return any(
        verb == marked and _pattern(template).fullmatch(path) is not None
        for marked, template in operations
    )
