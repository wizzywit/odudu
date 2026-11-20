"""Judges the credentials of one request for a web helper."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from odudu.verify._services.credentials import read_credentials
from odudu.verify._services.errors import KeyFetchError, VerificationError
from odudu.verify._services.refusal import Refusal, bad_request, no_credentials, refusal_for
from odudu.verify._services.token import VerifiedToken


class SyncVerifier(Protocol):
    def verify(self, token: str) -> VerifiedToken: ...


class AsyncTokenVerifier(Protocol):
    async def verify(self, token: str) -> VerifiedToken: ...


@dataclass(frozen=True)
class Outcome:
    """Either the verified token, or the refusal to send."""

    auth: VerifiedToken | None = None
    refusal: Refusal | None = None


def _beyond_scope(auth: VerifiedToken, scope: str | None) -> VerificationError | None:
    if scope is not None and scope not in auth.scope:
        return VerificationError("insufficient_scope", scope)
    return None


def authenticate(
    verifier: SyncVerifier, authorization: Sequence[str], scope: str | None
) -> Outcome:
    """A refusal is the answer to send. An error that is neither the token's fault nor the keys'
    is raised.
    """
    credentials = read_credentials(authorization)
    if credentials.kind == "none":
        return Outcome(refusal=no_credentials())
    if credentials.kind == "malformed":
        return Outcome(refusal=bad_request())
    try:
        auth = verifier.verify(credentials.token)
        missing = _beyond_scope(auth, scope)
        if missing is not None:
            raise missing
    except (VerificationError, KeyFetchError) as error:
        return Outcome(refusal=refusal_for(error))
    return Outcome(auth=auth)


async def aauthenticate(
    verifier: AsyncTokenVerifier, authorization: Sequence[str], scope: str | None
) -> Outcome:
    credentials = read_credentials(authorization)
    if credentials.kind == "none":
        return Outcome(refusal=no_credentials())
    if credentials.kind == "malformed":
        return Outcome(refusal=bad_request())
    try:
        auth = await verifier.verify(credentials.token)
        missing = _beyond_scope(auth, scope)
        if missing is not None:
            raise missing
    except (VerificationError, KeyFetchError) as error:
        return Outcome(refusal=refusal_for(error))
    return Outcome(auth=auth)
