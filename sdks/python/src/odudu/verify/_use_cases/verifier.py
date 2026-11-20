"""Checks an access token for an API, as `@odudu-io/node` does.

`verify` raises `VerificationError` when the token is at fault and `KeyFetchError` when the
issuer's keys could not be read. Signature checking is CPU work of well under a millisecond, so
`AsyncVerifier` runs it on the event loop.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from types import TracebackType

import httpx

from odudu.verify._adapter.fetch import TIMEOUT_SECONDS
from odudu.verify._adapter.signature import verify_signature
from odudu.verify._services.access_token import (
    TokenHeader,
    check_claims,
    check_header,
    claimed_issuer,
    payload_of,
    read_claims,
)
from odudu.verify._services.configuration import check_audience, check_issuers, check_scope
from odudu.verify._services.errors import VerificationError
from odudu.verify._services.jwks import Jwk
from odudu.verify._services.token import VerifiedToken
from odudu.verify._use_cases.key_store import AsyncKeyStore, KeyStore

DEFAULT_JWKS_TTL_SECONDS = 300.0


class _Rules:
    """The settings both verifiers share, and every check that needs no I/O."""

    def __init__(
        self,
        issuers: Sequence[str],
        audience: str,
        required_scope: str | None,
        jwks_ttl: float,
        allow_insecure_issuers: bool,
    ) -> None:
        self.issuers = check_issuers(issuers, allow_insecure_issuers)
        self.audience = check_audience(audience)
        self.required_scope = check_scope(required_scope, "required_scope")
        if jwks_ttl <= 0:
            raise ValueError("jwks_ttl is a positive number of seconds")
        self.jwks_ttl = float(jwks_ttl)

    def before_keys(self, token: str) -> tuple[str, TokenHeader]:
        if not isinstance(token, str):
            raise VerificationError("malformed")
        issuer = claimed_issuer(token, self.issuers)
        return issuer, check_header(token)

    def after_keys(
        self, token: str, issuer: str, header: TokenHeader, jwk: Jwk | None, now: float
    ) -> VerifiedToken:
        if jwk is None:
            raise VerificationError("unknown_key")
        payload = payload_of(verify_signature(token, jwk, header.alg))
        check_claims(payload, issuer, self.audience, now)
        return read_claims(payload, self.issuers, self.required_scope)


class Verifier:
    """Verifies access tokens in threads. One instance serves a whole process.

    `issuers` are the issuers whose tokens the API accepts: a token's `iss` must equal one
    exactly, and keys are read for these issuers only. `audience` is what this API is called in a
    token's `aud`. A token that lacks `required_scope` is refused with a 403. An issuer's keys are
    kept for `jwks_ttl` seconds. Reading them, discovery and key set together, may take
    `fetch_timeout` seconds in all. `now` returns seconds since the epoch. `http_client`
    replaces the client that reads the keys; it is then yours to close.
    """

    def __init__(
        self,
        issuers: Sequence[str],
        audience: str,
        required_scope: str | None = None,
        jwks_ttl: float = DEFAULT_JWKS_TTL_SECONDS,
        *,
        now: Callable[[], float] = time.time,
        http_client: httpx.Client | None = None,
        allow_insecure_issuers: bool = False,
        fetch_timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        self._rules = _Rules(issuers, audience, required_scope, jwks_ttl, allow_insecure_issuers)
        self._now = now
        self._owned = http_client is None
        self._client = (
            httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False)
            if http_client is None
            else http_client
        )
        self._keys = KeyStore(
            self._rules.issuers,
            self._client,
            self._rules.jwks_ttl,
            now,
            fetch_timeout=fetch_timeout,
        )

    def verify(self, token: str) -> VerifiedToken:
        issuer, header = self._rules.before_keys(token)
        jwk = self._keys.key_for(issuer, header.kid)
        return self._rules.after_keys(token, issuer, header, jwk, self._now())

    def close(self) -> None:
        if self._owned:
            self._client.close()

    def __enter__(self) -> Verifier:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()


class AsyncVerifier:
    """Verifies access tokens in one event loop, with the same rules as `Verifier`."""

    def __init__(
        self,
        issuers: Sequence[str],
        audience: str,
        required_scope: str | None = None,
        jwks_ttl: float = DEFAULT_JWKS_TTL_SECONDS,
        *,
        now: Callable[[], float] = time.time,
        http_client: httpx.AsyncClient | None = None,
        allow_insecure_issuers: bool = False,
        fetch_timeout: float = TIMEOUT_SECONDS,
    ) -> None:
        self._rules = _Rules(issuers, audience, required_scope, jwks_ttl, allow_insecure_issuers)
        self._now = now
        self._owned = http_client is None
        self._client = (
            httpx.AsyncClient(timeout=TIMEOUT_SECONDS, follow_redirects=False)
            if http_client is None
            else http_client
        )
        self._keys = AsyncKeyStore(
            self._rules.issuers,
            self._client,
            self._rules.jwks_ttl,
            now,
            fetch_timeout=fetch_timeout,
        )

    async def verify(self, token: str) -> VerifiedToken:
        issuer, header = self._rules.before_keys(token)
        jwk = await self._keys.key_for(issuer, header.kid)
        return self._rules.after_keys(token, issuer, header, jwk, self._now())

    async def aclose(self) -> None:
        if self._owned:
            await self._client.aclose()

    async def __aenter__(self) -> AsyncVerifier:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self.aclose()
