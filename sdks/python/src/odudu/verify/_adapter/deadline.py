"""One time budget shared by the reads of a single refresh, and a way to enforce it."""

from __future__ import annotations

import contextlib
import socket
import threading
import time
from collections.abc import Callable, Mapping
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


def _shut(connection: socket.socket) -> None:
    with contextlib.suppress(OSError):
        connection.shutdown(socket.SHUT_RDWR)


class Interrupt:
    """Shuts down the sockets a read has opened, so a read blocked on one fails at once.

    Closing an httpx client from another thread does not wake a thread blocked in `recv`;
    `shutdown` does. The sockets are found through httpcore's `trace` request extension, which
    reports each connection as it is made. Only the sockets of a read made with `trace` are
    known: a custom transport that does not report them is cut off from the caller but its
    worker is left to httpx's own timeouts.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._cut = False
        self._sockets: list[socket.socket] = []

    def trace(self, event: str, info: Mapping[str, object]) -> None:
        if not event.endswith(".complete"):
            return
        if not event.startswith(("connection.connect_tcp", "connection.start_tls")):
            return
        getter = getattr(info.get("return_value"), "get_extra_info", None)
        connection = getter("socket") if callable(getter) else None
        if not isinstance(connection, socket.socket):
            return
        with self._lock:
            if not self._cut:
                self._sockets.append(connection)
                return
        _shut(connection)

    def cut(self) -> None:
        with self._lock:
            self._cut = True
            held, self._sockets = self._sockets, []
        for connection in held:
            _shut(connection)


def run_within(work: Callable[[], T], deadline: Deadline, interrupt: Interrupt) -> T:
    """The result of `work`, or a `KeyFetchError` once `deadline` has passed.

    `work` runs in its own daemon thread, because a blocking socket read cannot be interrupted
    from the caller's thread, and httpx's timeouts start again with every byte received, so a
    server that trickles its headers would hold the caller for as long as it likes. When the
    deadline passes the caller is released at once and `interrupt` shuts the worker's sockets, so
    its blocked read fails and the thread ends, returning the connection to the pool. It only
    reads: the caller applies its result, so a late finish changes nothing.
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
        interrupt.cut()
        raise KeyFetchError("could not read the issuer's keys: took too long") from None
