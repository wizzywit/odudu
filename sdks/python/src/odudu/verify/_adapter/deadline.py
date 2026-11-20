"""One time budget shared by the reads of a single refresh, and a way to enforce it."""

from __future__ import annotations

import threading
import time
from collections.abc import Callable
from concurrent.futures import Future
from concurrent.futures import TimeoutError as FutureTimeout
from typing import TypeVar

from odudu.verify._services.errors import KeyFetchError

T = TypeVar("T")


class Deadline:
    """A moment on a monotonic clock, `budget` seconds after it was made."""

    def __init__(self, budget: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.budget = budget
        self.clock = clock
        self.at = clock() + budget

    def remaining(self) -> float:
        return self.at - self.clock()

    def expired(self) -> bool:
        return self.remaining() <= 0


def run_within(work: Callable[[], T], deadline: Deadline) -> T:
    """The result of `work`, or a `KeyFetchError` once `deadline` has passed.

    `work` runs in its own daemon thread, because a blocking socket read cannot be interrupted
    from the caller's thread, and httpx's timeouts start again with every byte received, so a
    server that trickles its headers would hold the caller for as long as it likes. When the
    deadline passes the caller is released at once; the thread is abandoned and ends when the
    server closes, when httpx's own phase timeout fires, or when h11 refuses more than 16 KiB of
    headers. It only reads: the caller applies its result, so a late finish changes nothing.
    """
    future: Future[T] = Future()

    def target() -> None:
        try:
            future.set_result(work())
        except BaseException as error:  # noqa: BLE001 - handed to the waiting caller
            future.set_exception(error)

    threading.Thread(target=target, daemon=True, name="odudu-verify-fetch").start()
    try:
        return future.result(timeout=max(deadline.remaining(), 0.0))
    except FutureTimeout:
        raise KeyFetchError("could not read the issuer's keys: took too long") from None
