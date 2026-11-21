"""Reading a JSON document from an issuer without trusting its size, time or redirects."""

from __future__ import annotations

import json

import httpx

from odudu.verify._adapter.deadline import Deadline, Interrupt
from odudu.verify._services.errors import KeyFetchError

# The budget for one refresh: discovery and the key set together.
TIMEOUT_SECONDS = 5.0
MAX_BYTES = 1_048_576


def _declared_too_large(response: httpx.Response) -> bool:
    try:
        return int(response.headers.get("content-length", "0")) > MAX_BYTES
    except ValueError:
        return False


def _decode(url: str, status: int, body: bytes) -> object:
    if not 200 <= status < 300:
        raise KeyFetchError(f"could not read {url}: answered {status}")
    try:
        return json.loads(body)
    except (ValueError, TypeError, RecursionError, OverflowError):
        raise KeyFetchError(f"could not read {url}: not JSON") from None


def _expired(url: str) -> KeyFetchError:
    return KeyFetchError(f"could not read {url}: took too long")


def _timeout(deadline: Deadline) -> httpx.Timeout:
    return httpx.Timeout(max(deadline.remaining(), 0.001))


def get_json(
    client: httpx.Client, url: str, deadline: Deadline, interrupt: Interrupt | None = None
) -> object:
    """The document at `url`. A redirect is a failure, never followed.

    Bounded here: each httpx phase (connect, write, each read) by the time left, and the body's
    total time and size, checked as every chunk arrives. Not bounded here: time to the first byte
    of the headers when the server sends them a byte at a time; `run_within` (which also shuts
    the sockets through `interrupt`) and `asyncio.wait_for` bound the whole read.
    """
    try:
        with client.stream(
            "GET",
            url,
            headers={"accept": "application/json"},
            timeout=_timeout(deadline),
            follow_redirects=False,
            extensions=None if interrupt is None else {"trace": interrupt.trace},
        ) as response:
            if _declared_too_large(response):
                raise KeyFetchError(f"could not read {url}: declared too large a document")
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                if deadline.expired():
                    raise _expired(url)
                total += len(chunk)
                if total > MAX_BYTES:
                    raise KeyFetchError(f"could not read {url}: answered with too large a document")
                chunks.append(chunk)
            if deadline.expired():
                raise _expired(url)
            return _decode(url, response.status_code, b"".join(chunks))
    except (httpx.HTTPError, httpx.InvalidURL) as error:
        raise KeyFetchError(f"could not read {url}: {type(error).__name__}") from None


async def aget_json(client: httpx.AsyncClient, url: str, deadline: Deadline) -> object:
    try:
        async with client.stream(
            "GET",
            url,
            headers={"accept": "application/json"},
            timeout=_timeout(deadline),
            follow_redirects=False,
        ) as response:
            if _declared_too_large(response):
                raise KeyFetchError(f"could not read {url}: declared too large a document")
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                if deadline.expired():
                    raise _expired(url)
                total += len(chunk)
                if total > MAX_BYTES:
                    raise KeyFetchError(f"could not read {url}: answered with too large a document")
                chunks.append(chunk)
            if deadline.expired():
                raise _expired(url)
            return _decode(url, response.status_code, b"".join(chunks))
    except (httpx.HTTPError, httpx.InvalidURL) as error:
        raise KeyFetchError(f"could not read {url}: {type(error).__name__}") from None
