"""The admin API: sync and async clients over `odudu._generated.admin`."""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable

import httpx

from odudu._adapter.transport import AsyncToken, SyncToken
from odudu._client import DEFAULT_TIMEOUT_SECONDS, AsyncClient, SyncClient
from odudu._generated.admin.client import AuthenticatedClient
from odudu._generated.admin_idempotent import IDEMPOTENT_OPERATIONS
from odudu._services.pagination import PageRequest
from odudu._use_cases.iterate import aiterate_pages, iterate_pages
from odudu.problem import FieldError, ProblemError

__all__ = [
    "AdminClient",
    "AsyncAdminClient",
    "FieldError",
    "PageRequest",
    "ProblemError",
    "aiterate_pages",
    "iterate_pages",
]


def _generated() -> AuthenticatedClient:
    # The transport signs every request, so the generated client's own token is never used.
    return AuthenticatedClient(base_url="https://unused.invalid", token="unused")  # noqa: S106


class AdminClient(SyncClient):
    """The admin API of one tenant, called synchronously; see `SyncClient.call`."""

    def __init__(
        self,
        base_url: str,
        tenant: str,
        token: SyncToken,
        *,
        transport: httpx.BaseTransport | None = None,
        sleep: Callable[[float], None] = time.sleep,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        super().__init__(
            _generated(), IDEMPOTENT_OPERATIONS, base_url, tenant, token, transport, sleep, timeout
        )


class AsyncAdminClient(AsyncClient):
    """The admin API of one tenant, called with `await`; see `AsyncClient.call`."""

    def __init__(
        self,
        base_url: str,
        tenant: str,
        token: AsyncToken,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        asleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        super().__init__(
            _generated(), IDEMPOTENT_OPERATIONS, base_url, tenant, token, transport, asleep, timeout
        )
