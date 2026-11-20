"""An issuer's keys, read through its discovery document and kept.

The issuer comes from the caller's configured list, never from a token, and the key URL from the
issuer's own document. A request whose key is held does no I/O and takes no lock. A refresh holds
its issuer's lock, so a burst of requests that all need it make one read.
"""

from __future__ import annotations

import asyncio
import threading
import time
from collections.abc import Callable, Sequence

import httpx

from odudu.verify._adapter.fetch import aget_json, get_json
from odudu.verify._services.errors import KeyFetchError
from odudu.verify._services.jwks import Jwk, jwks_uri_of, keys_by_kid
from odudu.verify._services.key_cache import (
    IssuerState,
    KeyEntry,
    after_failure,
    after_success,
    discovery_failed,
    discovery_succeeded,
    is_fresh,
    may_refetch,
)

Clock = Callable[[], float]
_UNREADABLE = "the issuer's keys could not be read"


def _not_a_key_set(issuer: str) -> KeyFetchError:
    return KeyFetchError(f"the key set of {issuer} is not a JWK Set")


class KeyStore:
    """For the threads of a synchronous server."""

    def __init__(
        self,
        issuers: Sequence[str],
        client: httpx.Client,
        ttl: float,
        now: Clock,
        monotonic: Clock = time.monotonic,
    ) -> None:
        self._monotonic = monotonic
        self._client = client
        self._ttl = ttl
        self._now = now
        self._states = {issuer: IssuerState() for issuer in issuers}
        self._locks = {issuer: threading.Lock() for issuer in issuers}

    def _jwks_uri(self, issuer: str, state: IssuerState) -> str:
        now = self._now()
        held = state.discovery
        if held is not None and held.expires_at > now:
            if held.uri is None:
                raise KeyFetchError(held.failure or _UNREADABLE)
            return held.uri
        try:
            uri = jwks_uri_of(
                issuer,
                get_json(
                    self._client, f"{issuer}/.well-known/openid-configuration", self._monotonic
                ),
            )
        except KeyFetchError as error:
            discovery_failed(state, str(error), now, self._ttl)
            raise
        discovery_succeeded(state, uri, now, self._ttl)
        return uri

    def _read(self, issuer: str, state: IssuerState) -> dict[str, Jwk]:
        keys = keys_by_kid(get_json(self._client, self._jwks_uri(issuer, state), self._monotonic))
        if keys is None:
            raise _not_a_key_set(issuer)
        return keys

    def _refresh(self, issuer: str, seen: KeyEntry | None) -> KeyEntry:
        """A new read, unless another thread has made one since `seen` was taken."""
        state = self._states[issuer]
        with self._locks[issuer]:
            current = state.current
            if current is not seen and current is not None and is_fresh(current, self._now()):
                return current
            started = self._now()
            try:
                keys = self._read(issuer, state)
            except KeyFetchError as error:
                return after_failure(state, str(error), started, self._ttl)
            return after_success(state, keys, started, self._ttl)

    def key_for(self, issuer: str, kid: str) -> Jwk | None:
        """The key of `issuer` named `kid`, or None when the issuer has no such key.

        Raises `KeyFetchError` when the keys cannot be read.
        """
        state = self._states[issuer]
        entry = state.current
        if entry is None or not is_fresh(entry, self._now()):
            entry = self._refresh(issuer, entry)
        found = entry.lookup(kid)
        if found is not None:
            return found
        latest = state.current
        if latest is not None and latest is not entry and is_fresh(latest, self._now()):
            return latest.lookup(kid)
        if not may_refetch(entry.started_at, self._now()):
            return None
        return self._refresh(issuer, entry).lookup(kid)


class AsyncKeyStore:
    """For the tasks of one event loop."""

    def __init__(
        self,
        issuers: Sequence[str],
        client: httpx.AsyncClient,
        ttl: float,
        now: Clock,
        monotonic: Clock = time.monotonic,
    ) -> None:
        self._monotonic = monotonic
        self._client = client
        self._ttl = ttl
        self._now = now
        self._states = {issuer: IssuerState() for issuer in issuers}
        self._locks = {issuer: asyncio.Lock() for issuer in issuers}

    async def _jwks_uri(self, issuer: str, state: IssuerState) -> str:
        now = self._now()
        held = state.discovery
        if held is not None and held.expires_at > now:
            if held.uri is None:
                raise KeyFetchError(held.failure or _UNREADABLE)
            return held.uri
        try:
            document = await aget_json(
                self._client, f"{issuer}/.well-known/openid-configuration", self._monotonic
            )
            uri = jwks_uri_of(issuer, document)
        except KeyFetchError as error:
            discovery_failed(state, str(error), now, self._ttl)
            raise
        discovery_succeeded(state, uri, now, self._ttl)
        return uri

    async def _read(self, issuer: str, state: IssuerState) -> dict[str, Jwk]:
        uri = await self._jwks_uri(issuer, state)
        keys = keys_by_kid(await aget_json(self._client, uri, self._monotonic))
        if keys is None:
            raise _not_a_key_set(issuer)
        return keys

    async def _refresh(self, issuer: str, seen: KeyEntry | None) -> KeyEntry:
        state = self._states[issuer]
        async with self._locks[issuer]:
            current = state.current
            if current is not seen and current is not None and is_fresh(current, self._now()):
                return current
            started = self._now()
            try:
                keys = await self._read(issuer, state)
            except KeyFetchError as error:
                return after_failure(state, str(error), started, self._ttl)
            return after_success(state, keys, started, self._ttl)

    async def key_for(self, issuer: str, kid: str) -> Jwk | None:
        state = self._states[issuer]
        entry = state.current
        if entry is None or not is_fresh(entry, self._now()):
            entry = await self._refresh(issuer, entry)
        found = entry.lookup(kid)
        if found is not None:
            return found
        latest = state.current
        if latest is not None and latest is not entry and is_fresh(latest, self._now()):
            return latest.lookup(kid)
        if not may_refetch(entry.started_at, self._now()):
            return None
        return (await self._refresh(issuer, entry)).lookup(kid)
