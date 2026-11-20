"""The clients both APIs share; `odudu.admin` and `odudu.me` bind them to a document."""

from __future__ import annotations

import inspect
import uuid
from collections.abc import Awaitable, Callable
from functools import lru_cache
from types import TracebackType
from typing import Protocol, TypeVar

import httpx
from typing_extensions import Self

from odudu._adapter.transport import AsyncToken, AsyncTransport, Policy, SyncToken, SyncTransport
from odudu._services.request import (
    bearer,
    refuse_dot_segments,
    validate_base_url,
    validate_tenant,
)

R = TypeVar("R")

DEFAULT_TIMEOUT_SECONDS = 30.0
_CREDENTIAL_MESSAGE = "token must be a string or a function that returns one"


class _SyncBindable(Protocol):
    def set_httpx_client(self, client: httpx.Client) -> object: ...


class _AsyncBindable(Protocol):
    def set_async_httpx_client(self, async_client: httpx.AsyncClient) -> object: ...


@lru_cache(maxsize=512)
def _takes_tenant(operation: Callable[..., object]) -> bool:
    return "tenant" in inspect.signature(operation).parameters


def _arguments(
    tenant: str,
    operation: Callable[..., object],
    arguments: tuple[object, ...],
    keywords: dict[str, object],
) -> tuple[object, ...]:
    if "client" in keywords or "tenant" in keywords:
        raise TypeError("a call cannot name its own client or tenant: the client owns both")
    refuse_dot_segments(arguments)
    return (tenant, *arguments) if _takes_tenant(operation) else arguments


def _check_token(token: object) -> None:
    if callable(token):
        return
    if not isinstance(token, str):
        raise TypeError(_CREDENTIAL_MESSAGE)
    bearer(token)


class SyncClient:
    """The calls of one tenant, made synchronously.

    `call(operation, *args, **kwargs)` runs a generated `sync_detailed` function: the client
    supplies the tenant, the `client` argument, the token and the transport, so a call names
    only what the operation itself takes. The operation's own argument types are not checked
    statically through `call`; its return type is kept.
    """

    def __init__(
        self,
        generated: _SyncBindable,
        idempotent: frozenset[tuple[str, str]],
        base_url: str,
        tenant: str,
        token: SyncToken,
        transport: httpx.BaseTransport | None,
        sleep: Callable[[float], None],
        timeout: float,
    ) -> None:
        self._base_url = validate_base_url(base_url)
        self._tenant = validate_tenant(tenant)
        _check_token(token)
        policy = Policy(httpx.URL(self._base_url), idempotent, lambda: str(uuid.uuid4()))
        inner = transport if transport is not None else httpx.HTTPTransport()
        self._http = httpx.Client(
            base_url=self._base_url,
            transport=SyncTransport(inner, policy, token, sleep),
            follow_redirects=False,
            timeout=timeout,
        )
        generated.set_httpx_client(self._http)
        self._generated = generated

    @property
    def http(self) -> httpx.Client:
        """The configured `httpx.Client`, for an endpoint no generated operation covers.

        It signs, retries and raises like a generated call, and refuses another origin.
        """
        return self._http

    @property
    def tenant(self) -> str:
        return self._tenant

    def call(self, operation: Callable[..., R], /, *args: object, **kwargs: object) -> R:
        positional = _arguments(self._tenant, operation, args, kwargs)
        return operation(*positional, client=self._generated, **kwargs)

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        error_type: type[BaseException] | None,
        error: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


class AsyncClient:
    """The calls of one tenant, made with `await`: the same as `SyncClient` over `asyncio_detailed`.

    The token may be a function that returns text or one that returns an awaitable of text.
    """

    def __init__(
        self,
        generated: _AsyncBindable,
        idempotent: frozenset[tuple[str, str]],
        base_url: str,
        tenant: str,
        token: AsyncToken,
        transport: httpx.AsyncBaseTransport | None,
        asleep: Callable[[float], Awaitable[None]],
        timeout: float,
    ) -> None:
        self._base_url = validate_base_url(base_url)
        self._tenant = validate_tenant(tenant)
        _check_token(token)
        policy = Policy(httpx.URL(self._base_url), idempotent, lambda: str(uuid.uuid4()))
        inner = transport if transport is not None else httpx.AsyncHTTPTransport()
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            transport=AsyncTransport(inner, policy, token, asleep),
            follow_redirects=False,
            timeout=timeout,
        )
        generated.set_async_httpx_client(self._http)
        self._generated = generated

    @property
    def http(self) -> httpx.AsyncClient:
        """The configured `httpx.AsyncClient`, for an endpoint no generated operation covers."""
        return self._http

    @property
    def tenant(self) -> str:
        return self._tenant

    async def call(
        self,
        operation: Callable[..., Awaitable[R]],
        /,
        *args: object,
        **kwargs: object,
    ) -> R:
        positional = _arguments(self._tenant, operation, args, kwargs)
        return await operation(*positional, client=self._generated, **kwargs)

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        error_type: type[BaseException] | None,
        error: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()
