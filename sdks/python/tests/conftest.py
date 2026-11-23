from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import TypeVar

T = TypeVar("T")


def run(awaitable: Awaitable[T]) -> T:
    async def runner() -> T:
        return await awaitable

    return asyncio.run(runner())
