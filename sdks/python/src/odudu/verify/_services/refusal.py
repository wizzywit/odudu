"""The answer for a request that is not let through."""

from __future__ import annotations

import json
from dataclasses import dataclass

from odudu.verify._services.errors import KeyFetchError, VerificationError


@dataclass(frozen=True)
class Refusal:
    """What a web helper writes: a status, lower-case headers and a JSON body."""

    status: int
    headers: dict[str, str]
    body: str


def _refusal(status: int, error: str, description: str, extra: dict[str, str]) -> Refusal:
    return Refusal(
        status=status,
        headers={"content-type": "application/json", "cache-control": "no-store", **extra},
        body=json.dumps({"error": error, "error_description": description}, separators=(",", ":")),
    )


def no_credentials() -> Refusal:
    """RFC 6750 section 3.1: no error code when the request carried no credentials."""
    return _refusal(
        401, "unauthorized", "An access token is required", {"www-authenticate": "Bearer"}
    )


def bad_request() -> Refusal:
    return _refusal(
        400,
        "invalid_request",
        "The Authorization header is malformed",
        {"www-authenticate": 'Bearer error="invalid_request"'},
    )


def keys_unavailable() -> Refusal:
    """The API is well; it cannot check tokens until the issuer's keys can be read."""
    return _refusal(
        503,
        "temporarily_unavailable",
        "Access tokens cannot be checked right now",
        {"retry-after": "10"},
    )


def server_error() -> Refusal:
    return _refusal(500, "server_error", "The request could not be handled", {})


def refusal_for(error: VerificationError | KeyFetchError) -> Refusal:
    """The refusal for an error the verifier raised. Any other error is not this package's."""
    if isinstance(error, VerificationError):
        return _refusal(
            error.status, error.code, error.description, {"www-authenticate": error.challenge}
        )
    return keys_unavailable()
