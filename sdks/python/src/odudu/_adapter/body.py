"""Reading a refusal's body without trusting its size."""

from __future__ import annotations

import httpx

MAX_PROBLEM_BYTES = 64 * 1024


def _decode(chunks: list[bytes]) -> str | None:
    try:
        return b"".join(chunks).decode("utf-8")
    except UnicodeDecodeError:
        return None


def read_problem_text(response: httpx.Response) -> str | None:
    """The decoded body as text, or None when it is longer than a problem document ever is."""
    chunks: list[bytes] = []
    size = 0
    try:
        for chunk in response.iter_bytes():
            size += len(chunk)
            if size > MAX_PROBLEM_BYTES:
                return None
            chunks.append(chunk)
    except httpx.DecodingError:
        return None
    return _decode(chunks)


async def aread_problem_text(response: httpx.Response) -> str | None:
    chunks: list[bytes] = []
    size = 0
    try:
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > MAX_PROBLEM_BYTES:
                return None
            chunks.append(chunk)
    except httpx.DecodingError:
        return None
    return _decode(chunks)
