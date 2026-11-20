"""When an issuer's keys are read again, and what is remembered between reads."""

from __future__ import annotations

from dataclasses import dataclass

from odudu.verify._services.errors import KeyFetchError
from odudu.verify._services.jwks import Jwk

# An issuer's keys are read again for an unknown `kid` no sooner than this after they were last
# read, and a failed read is repeated no sooner either.
REFETCH_INTERVAL_SECONDS = 10.0
# The last key set read successfully answers for this many times the TTL when a read fails.
STALE_TTL_FACTOR = 2


@dataclass
class KeyEntry:
    """The outcome of one read of an issuer's key set: its keys, or why there are none."""

    started_at: float
    expires_at: float
    keys: dict[str, Jwk] | None = None
    failure: str | None = None

    def lookup(self, kid: str) -> Jwk | None:
        if self.keys is None:
            raise KeyFetchError(self.failure or "the issuer's keys could not be read")
        return self.keys.get(kid)


@dataclass
class DiscoveryEntry:
    expires_at: float
    uri: str | None = None
    failure: str | None = None


@dataclass
class IssuerState:
    """What is kept for one issuer. Written only while that issuer's lock is held."""

    discovery: DiscoveryEntry | None = None
    current: KeyEntry | None = None
    # The last key set read successfully and when it stops being served.
    good: tuple[dict[str, Jwk], float] | None = None


def may_refetch(started_at: float, now: float) -> bool:
    return now - started_at >= REFETCH_INTERVAL_SECONDS


def is_fresh(entry: KeyEntry | None, now: float) -> bool:
    return entry is not None and entry.expires_at > now


def after_success(state: IssuerState, keys: dict[str, Jwk], now: float, ttl: float) -> KeyEntry:
    state.good = (keys, now + ttl * STALE_TTL_FACTOR)
    entry = KeyEntry(started_at=now, expires_at=now + ttl, keys=keys)
    state.current = entry
    return entry


def after_failure(state: IssuerState, reason: str, now: float, ttl: float) -> KeyEntry:
    """A failed read is answered with the last good key set while it is under twice the TTL old.

    The failure is remembered for 10 s either way, so it is answered from memory for a while
    instead of driving a request per token.
    """
    remembered = now + min(ttl, REFETCH_INTERVAL_SECONDS)
    if state.good is not None and state.good[1] > now:
        entry = KeyEntry(started_at=now, expires_at=remembered, keys=state.good[0])
    else:
        entry = KeyEntry(started_at=now, expires_at=remembered, failure=reason)
    state.current = entry
    return entry


def discovery_succeeded(state: IssuerState, uri: str, now: float, ttl: float) -> None:
    state.discovery = DiscoveryEntry(expires_at=now + ttl, uri=uri)


def discovery_failed(state: IssuerState, reason: str, now: float, ttl: float) -> None:
    state.discovery = DiscoveryEntry(
        expires_at=now + min(ttl, REFETCH_INTERVAL_SECONDS), failure=reason
    )
