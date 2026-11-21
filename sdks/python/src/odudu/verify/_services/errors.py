"""What a refused token and an unreadable key set look like."""

from __future__ import annotations

from typing import Literal

VerificationCode = Literal["invalid_token", "insufficient_scope"]

# Which check refused the token. For logs and tests; it is never put in the challenge, so a
# caller learns no more than the code and a fixed description.
Reason = Literal[
    "malformed",
    "invalid_header",
    "wrong_type",
    "unsupported_algorithm",
    "wrong_issuer",
    "unknown_key",
    "bad_signature",
    "expired",
    "not_yet_valid",
    "wrong_audience",
    "me_audience",
    "invalid_claims",
    "insufficient_scope",
]

_INVALID = "The access token is invalid"
_DESCRIPTION: dict[Reason, str] = {
    "malformed": _INVALID,
    "invalid_header": _INVALID,
    "wrong_type": _INVALID,
    "unsupported_algorithm": _INVALID,
    "wrong_issuer": _INVALID,
    "unknown_key": _INVALID,
    "bad_signature": _INVALID,
    "expired": "The access token expired",
    "not_yet_valid": _INVALID,
    "wrong_audience": _INVALID,
    "me_audience": _INVALID,
    "invalid_claims": _INVALID,
    "insufficient_scope": "The access token lacks the required scope",
}


def quoted(value: str) -> str:
    """A quoted-string value of a challenge parameter (RFC 7230 section 3.2.6)."""
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


class VerificationError(Exception):
    """The token is at fault: answer 401, or 403 for a missing scope.

    `challenge` is the `WWW-Authenticate` value to send with the response (RFC 6750 section 3.1).
    """

    status: int
    code: VerificationCode
    reason: Reason
    description: str
    challenge: str

    def __init__(self, reason: Reason, required_scope: str | None = None) -> None:
        description = _DESCRIPTION[reason]
        super().__init__(description)
        self.reason = reason
        self.description = description
        self.code = "insufficient_scope" if reason == "insufficient_scope" else "invalid_token"
        self.status = 403 if reason == "insufficient_scope" else 401
        parts = [f"error={quoted(self.code)}", f"error_description={quoted(description)}"]
        if required_scope is not None and reason == "insufficient_scope":
            parts.append(f"scope={quoted(required_scope)}")
        self.challenge = "Bearer " + ", ".join(parts)


class KeyFetchError(Exception):
    """The issuer's keys could not be read, so the token has not been judged.

    The API answers 503, not 401, so a client does not discard a token that is fine.
    """
