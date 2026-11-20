"""The transport every request of a client goes through.

It sits below `httpx.Client`, so it sees each request once with its final URL and headers: it
signs it, gives the calls the document marks an `Idempotency-Key`, repeats it when that is
harmless, and turns every response that is not a 2xx into a `ProblemError`. Redirects are never
followed (the client is built with `follow_redirects=False`), so a 3xx reaches here and raises.
"""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from odudu._adapter.body import aread_problem_text, read_problem_text
from odudu._services.idempotency import is_idempotent
from odudu._services.problem import ProblemInit, problem_from_body
from odudu._services.request import bearer
from odudu._services.retry import (
    MAX_RETRIES,
    is_retryable_status,
    may_retry,
    retry_delay_seconds,
)
from odudu.problem import ProblemError

SyncToken = str | Callable[[], str]
AsyncToken = str | Callable[[], str] | Callable[[], Awaitable[str]]

REDIRECT_MESSAGE = (
    "the server answered with a redirect; redirects are not followed so the token is never "
    "sent elsewhere"
)
_CREDENTIAL_HEADERS = ("authorization", "idempotency-key")
_BODY_HEADERS = ("content-encoding", "content-length", "transfer-encoding")


@dataclass(frozen=True)
class Policy:
    """What is fixed for a client: where it may send, and which calls take a key."""

    base_url: httpx.URL
    idempotent: frozenset[tuple[str, str]]
    new_key: Callable[[], str]

    def check_origin(self, request: httpx.Request) -> None:
        url, base = request.url, self.base_url
        if (url.scheme, url.host, url.port) != (base.scheme, base.host, base.port):
            raise ValueError("a request may only go to the origin the client was made for")

    def sign(self, request: httpx.Request, token: object) -> None:
        """Overwrites any `Authorization` the call carried, and adds a key where one belongs."""
        request.headers["Authorization"] = bearer(token)
        if "idempotency-key" not in request.headers and self._takes_key(request):
            request.headers["Idempotency-Key"] = self.new_key()

    def _takes_key(self, request: httpx.Request) -> bool:
        path = request.url.raw_path.split(b"?", 1)[0].decode("ascii")
        prefix = self.base_url.raw_path.decode("ascii").rstrip("/")
        return is_idempotent(request.method, path.removeprefix(prefix), self.idempotent)


def _without_credentials(request: httpx.Request) -> list[tuple[str, str]]:
    return [
        (key, value)
        for key, value in request.headers.multi_items()
        if key.lower() not in _CREDENTIAL_HEADERS
    ]


def _problem(request: httpx.Request, response: httpx.Response, init: ProblemInit) -> ProblemError:
    headers = [(k, v) for k, v in response.headers.multi_items() if k.lower() not in _BODY_HEADERS]
    # The request the error carries is a copy without the credentials it was sent with.
    sent = httpx.Request(request.method, request.url, headers=_without_credentials(request))
    return ProblemError(init, httpx.Response(response.status_code, headers=headers, request=sent))


def _may_retry(request: httpx.Request) -> bool:
    return may_retry(request.method, "idempotency-key" in request.headers)


class SyncTransport(httpx.BaseTransport):
    def __init__(
        self,
        inner: httpx.BaseTransport,
        policy: Policy,
        token: SyncToken,
        sleep: Callable[[float], None],
    ) -> None:
        self._inner, self._policy, self._token, self._sleep = inner, policy, token, sleep

    def _resolve_token(self) -> object:
        if not callable(self._token):
            return self._token
        token = self._token()
        if inspect.isawaitable(token):
            if inspect.iscoroutine(token):
                token.close()
            raise TypeError("the token function returned an awaitable: use the async client")
        return token

    def _to_problem(self, request: httpx.Request, response: httpx.Response) -> ProblemError:
        try:
            if 300 <= response.status_code < 400:
                init = ProblemInit(status=response.status_code, detail=REDIRECT_MESSAGE)
            else:
                init = problem_from_body(response.status_code, read_problem_text(response))
        finally:
            response.close()
        return _problem(request, response, init)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self._policy.check_origin(request)
        self._policy.sign(request, self._resolve_token())
        retries = MAX_RETRIES if _may_retry(request) else 0
        for attempt in range(retries + 1):
            last = attempt >= retries
            retry_after: str | None = None
            try:
                response = self._inner.handle_request(request)
            except httpx.TransportError:
                if last:
                    raise
            else:
                if response.is_success:
                    return response
                if last or not is_retryable_status(response.status_code):
                    raise self._to_problem(request, response)
                retry_after = response.headers.get("retry-after")
                response.close()
            self._sleep(retry_delay_seconds(attempt, retry_after))
        raise RuntimeError("the retry loop ended without an answer")

    def close(self) -> None:
        self._inner.close()


class AsyncTransport(httpx.AsyncBaseTransport):
    def __init__(
        self,
        inner: httpx.AsyncBaseTransport,
        policy: Policy,
        token: AsyncToken,
        asleep: Callable[[float], Awaitable[None]],
    ) -> None:
        self._inner, self._policy, self._token, self._asleep = inner, policy, token, asleep

    async def _resolve_token(self) -> object:
        if not callable(self._token):
            return self._token
        token = self._token()
        return await token if inspect.isawaitable(token) else token

    async def _to_problem(self, request: httpx.Request, response: httpx.Response) -> ProblemError:
        try:
            if 300 <= response.status_code < 400:
                init = ProblemInit(status=response.status_code, detail=REDIRECT_MESSAGE)
            else:
                init = problem_from_body(response.status_code, await aread_problem_text(response))
        finally:
            await response.aclose()
        return _problem(request, response, init)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self._policy.check_origin(request)
        self._policy.sign(request, await self._resolve_token())
        retries = MAX_RETRIES if _may_retry(request) else 0
        for attempt in range(retries + 1):
            last = attempt >= retries
            retry_after: str | None = None
            try:
                response = await self._inner.handle_async_request(request)
            except httpx.TransportError:
                if last:
                    raise
            else:
                if response.is_success:
                    return response
                if last or not is_retryable_status(response.status_code):
                    raise await self._to_problem(request, response)
                retry_after = response.headers.get("retry-after")
                await response.aclose()
            await self._asleep(retry_delay_seconds(attempt, retry_after))
        raise RuntimeError("the retry loop ended without an answer")

    async def aclose(self) -> None:
        await self._inner.aclose()
