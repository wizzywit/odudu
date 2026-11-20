"""A FastAPI dependency that lets a request through only with a verified access token.

```python
verifier = AsyncVerifier(["https://id.example.com/tenants/acme"], "https://api.example.com")

@app.get("/reports")
async def reports(token: VerifiedToken = Depends(require_token(verifier, scope="reports:read"))):
    ...
```

A refusal is an `HTTPException` carrying the `WWW-Authenticate` challenge, so FastAPI sends it as
its own error response, `{"detail": {"error": ..., "error_description": ...}}`.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request

from odudu.verify._services.configuration import check_scope
from odudu.verify._services.refusal import Refusal
from odudu.verify._services.token import VerifiedToken
from odudu.verify._use_cases.authenticate import AsyncTokenVerifier, aauthenticate

__all__ = ["require_token"]


def _exception(refusal: Refusal) -> HTTPException:
    headers = {name: value for name, value in refusal.headers.items() if name != "content-type"}
    return HTTPException(status_code=refusal.status, detail=_detail(refusal), headers=headers)


def _detail(refusal: Refusal) -> dict[str, str]:
    decoded = json.loads(refusal.body)
    return {str(key): str(value) for key, value in decoded.items()}


def require_token(
    verifier: AsyncTokenVerifier, scope: str | None = None
) -> Callable[[Request], Awaitable[VerifiedToken]]:
    """A dependency that returns the verified token, or answers 400, 401, 403 or 503.

    `scope` is a scope the route needs; without it the route answers 403.
    """
    check_scope(scope, "scope")

    async def dependency(request: Request) -> VerifiedToken:
        outcome = await aauthenticate(verifier, request.headers.getlist("authorization"), scope)
        if outcome.refusal is not None:
            raise _exception(outcome.refusal)
        if outcome.auth is None:  # pragma: no cover - an outcome holds one of the two
            raise HTTPException(status_code=500)
        return outcome.auth

    return dependency
