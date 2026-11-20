"""Reading a JSON document from an issuer without trusting its size, time or redirects."""

from __future__ import annotations

import json
import time
from collections.abc import Callable

import httpx

from odudu.verify._services.errors import KeyFetchError

TIMEOUT_SECONDS = 5.0
MAX_BYTES = 1_048_576


def _declared_too_large(response: httpx.Response) -> bool:
    try:
        return int(response.headers.get("content-length", "0")) > MAX_BYTES
    except ValueError:
        return False


Clock = Callable[[], float]


def _decode(url: str, status: int, body: bytes) -> object:
    if not 200 <= status < 300:
        raise KeyFetchError(f"could not read {url}: answered {status}")
    try:
        return json.loads(body)
    except (ValueError, TypeError, RecursionError, OverflowError):
        raise KeyFetchError(f"could not read {url}: not JSON") from None


def _expired(url: str) -> KeyFetchError:
    return KeyFetchError(f"could not read {url}: took too long")


def get_json(client: httpx.Client, url: str, clock: Clock = time.monotonic) -> object:
    """The document at `url`. A redirect is a failure, never followed.

    The whole read, body included, must finish within `TIMEOUT_SECONDS` of `clock`; httpx's own
    timeouts bound each phase, which a body that trickles in would otherwise stretch.
    """
    deadline = clock() + TIMEOUT_SECONDS
    try:
        with client.stream(
            "GET",
            url,
            headers={"accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
        ) as response:
            if _declared_too_large(response):
                raise KeyFetchError(f"could not read {url}: declared too large a document")
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                if clock() > deadline:
                    raise _expired(url)
                total += len(chunk)
                if total > MAX_BYTES:
                    raise KeyFetchError(f"could not read {url}: answered with too large a document")
                chunks.append(chunk)
            if clock() > deadline:
                raise _expired(url)
            return _decode(url, response.status_code, b"".join(chunks))
    except (httpx.HTTPError, httpx.InvalidURL) as error:
        raise KeyFetchError(f"could not read {url}: {type(error).__name__}") from None


async def aget_json(client: httpx.AsyncClient, url: str, clock: Clock = time.monotonic) -> object:
    deadline = clock() + TIMEOUT_SECONDS
    try:
        async with client.stream(
            "GET",
            url,
            headers={"accept": "application/json"},
            timeout=TIMEOUT_SECONDS,
            follow_redirects=False,
        ) as response:
            if _declared_too_large(response):
                raise KeyFetchError(f"could not read {url}: declared too large a document")
            chunks: list[bytes] = []
            total = 0
            async for chunk in response.aiter_bytes():
                if clock() > deadline:
                    raise _expired(url)
                total += len(chunk)
                if total > MAX_BYTES:
                    raise KeyFetchError(f"could not read {url}: answered with too large a document")
                chunks.append(chunk)
            if clock() > deadline:
                raise _expired(url)
            return _decode(url, response.status_code, b"".join(chunks))
    except (httpx.HTTPError, httpx.InvalidURL) as error:
        raise KeyFetchError(f"could not read {url}: {type(error).__name__}") from None
