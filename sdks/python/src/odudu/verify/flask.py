"""A Flask decorator that lets a request through only with a verified access token.

```python
verifier = Verifier(["https://id.example.com/tenants/acme"], "https://api.example.com")

@app.get("/reports")
@require_token(verifier, scope="reports:read")
def reports():
    token = current_token()
    ...
```

A refusal is the same JSON answer `@odudu-io/node`'s middleware sends, with the
`WWW-Authenticate` challenge.
"""

from __future__ import annotations

from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

from flask import Response, g, request

from odudu.verify._services.configuration import check_scope
from odudu.verify._services.refusal import Refusal
from odudu.verify._services.token import VerifiedToken
from odudu.verify._use_cases.authenticate import SyncVerifier, authenticate

__all__ = ["current_token", "require_token"]

P = ParamSpec("P")
R = TypeVar("R")
_ATTRIBUTE = "odudu_token"


def _response(refusal: Refusal) -> Response:
    return Response(refusal.body, status=refusal.status, headers=refusal.headers)


def require_token(
    verifier: SyncVerifier, scope: str | None = None
) -> Callable[[Callable[P, R]], Callable[P, R | Response]]:
    """Runs the view only for a verified token, which `current_token()` returns.

    `scope` is a scope the route needs; without it the route answers 403.
    """
    check_scope(scope, "scope")

    def decorate(view: Callable[P, R]) -> Callable[P, R | Response]:
        @wraps(view)
        def guarded(*args: P.args, **kwargs: P.kwargs) -> R | Response:
            outcome = authenticate(verifier, request.headers.getlist("Authorization"), scope)
            if outcome.refusal is not None:
                return _response(outcome.refusal)
            setattr(g, _ATTRIBUTE, outcome.auth)
            return view(*args, **kwargs)

        return guarded

    return decorate


def current_token() -> VerifiedToken:
    """The token `require_token` verified. Raises on a request it did not see."""
    token = getattr(g, _ATTRIBUTE, None)
    if not isinstance(token, VerifiedToken):
        raise RuntimeError("current_token was called on a request require_token did not see")
    return token
