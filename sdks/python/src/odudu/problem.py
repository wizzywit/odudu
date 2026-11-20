"""The error every response that is not a success becomes."""

from __future__ import annotations

import httpx

from odudu._services.problem import FieldError, ProblemInit

__all__ = ["FieldError", "ProblemError"]


class ProblemError(Exception):
    """Raised for every response that is not a 2xx, a redirect included.

    `code` is the part after `#` of the problem `type` (`about:blank#idempotency-in-progress`)
    on the admin API, and the `error` of a refusal on the account API. `response` carries the
    status and headers; its body is empty, because a body that is not a problem document is
    never kept.
    """

    def __init__(self, init: ProblemInit, response: httpx.Response) -> None:
        reason = init.detail or init.title or init.code
        super().__init__(
            f"HTTP {init.status}" if reason is None else f"HTTP {init.status}: {reason}"
        )
        self.status = init.status
        self.code = init.code
        self.title = init.title
        self.detail = init.detail
        self.type = init.type
        self.instance = init.instance
        self.errors = init.errors
        self.response = response
        self._init = init

    def __reduce__(self) -> tuple[type[ProblemError], tuple[ProblemInit, httpx.Response]]:
        return (type(self), (self._init, self.response))
