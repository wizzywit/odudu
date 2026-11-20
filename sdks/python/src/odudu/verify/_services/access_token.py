"""The checks on an access token (RFC 9068) that need no key, and those on its claims."""

from __future__ import annotations

import base64
import binascii
import json
import math
import re
from collections.abc import Sequence
from dataclasses import dataclass

from odudu.verify._services.errors import VerificationError
from odudu.verify._services.jwks import SigningAlgorithm
from odudu.verify._services.token import VerifiedToken

# RFC 9068 section 4 allows `at+jwt` and `application/at+jwt`, and RFC 7515 section 4.1.9 makes
# the media type case-insensitive. The server compares the header with `at+jwt` exactly and
# refuses the rest, and so does this.
AT_JWT_MEDIA_TYPE = "at+jwt"
# Seconds of leeway on `exp` and `nbf`.
CLOCK_TOLERANCE_SECONDS = 5
# A token longer than this is refused before it is decoded.
MAX_TOKEN_LENGTH = 16_384

_SEGMENT = re.compile(r"[A-Za-z0-9_-]*")


@dataclass(frozen=True)
class TokenHeader:
    alg: SigningAlgorithm
    kid: str


def _reject_constant(name: str) -> object:
    raise ValueError(name)


def _loads(raw: bytes) -> dict[str, object]:
    """A JSON object, with no `NaN` or `Infinity`, which JSON does not have."""
    try:
        decoded = json.loads(raw, parse_constant=_reject_constant)
    except (ValueError, TypeError, RecursionError, OverflowError):
        raise VerificationError("malformed") from None
    if not isinstance(decoded, dict):
        raise VerificationError("malformed")
    return {str(key): value for key, value in decoded.items()}


def _algorithm(value: object) -> SigningAlgorithm | None:
    if value == "RS256":
        return "RS256"
    if value == "ES256":
        return "ES256"
    return None


def _segment(token: str, index: int) -> dict[str, object]:
    """One dot-separated segment of a compact JWS, decoded as a JSON object."""
    parts = token.split(".")
    if len(parts) != 3 or any(_SEGMENT.fullmatch(part) is None for part in parts):
        raise VerificationError("malformed")
    text = parts[index]
    try:
        raw = base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))
    except (binascii.Error, ValueError):
        raise VerificationError("malformed") from None
    return _loads(raw)


def claimed_issuer(token: str, issuers: Sequence[str]) -> str:
    """The issuer a token claims, read before anything is trusted.

    It only selects among the configured issuers: it is never fetched or used as an address.
    """
    if len(token) > MAX_TOKEN_LENGTH:
        raise VerificationError("malformed")
    iss = _segment(token, 1).get("iss")
    for issuer in issuers:
        if issuer == iss:
            return issuer
    raise VerificationError("wrong_issuer")


def check_header(token: str) -> TokenHeader:
    """A token that is an access token, signed with an algorithm the server uses, naming its key.

    `none` and every HMAC are refused here, before a key is looked up.
    """
    header = _segment(token, 0)
    # RFC 7515 section 4.1.11: a verifier must refuse a `crit` it does not understand, and an
    # access token never needs one. Not every PyJWT release checks it, so this does.
    if "crit" in header:
        raise VerificationError("malformed")
    if header.get("typ") != AT_JWT_MEDIA_TYPE:
        raise VerificationError("wrong_type")
    alg = _algorithm(header.get("alg"))
    if alg is None:
        raise VerificationError("unsupported_algorithm")
    kid = header.get("kid")
    if not isinstance(kid, str) or kid == "":
        raise VerificationError("invalid_header")
    return TokenHeader(alg=alg, kid=kid)


def payload_of(raw: bytes) -> dict[str, object]:
    """The claims of a token whose signature has been verified."""
    return _loads(raw)


def _number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        number = float(value)
    except OverflowError:
        return None
    return number if math.isfinite(number) else None


def _audiences(value: object) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str)]
    return []


def check_claims(payload: dict[str, object], issuer: str, audience: str, now: float) -> None:
    """`exp`, `iss`, `aud`, `iat` and `nbf` as `jose` checks them, in its order, with the same
    tolerance. The status, code and challenge always match; so does the reason.

    `now` is seconds since the epoch; the check works on whole seconds.
    """
    if "exp" not in payload:
        raise VerificationError("invalid_claims")
    if payload.get("iss") != issuer:
        raise VerificationError("wrong_issuer")
    if audience not in _audiences(payload.get("aud")):
        raise VerificationError("wrong_audience")
    seconds = math.floor(now)
    if "iat" in payload and _number(payload["iat"]) is None:
        raise VerificationError("invalid_claims")
    if "nbf" in payload:
        nbf = _number(payload["nbf"])
        if nbf is None:
            raise VerificationError("invalid_claims")
        if nbf > seconds + CLOCK_TOLERANCE_SECONDS:
            raise VerificationError("not_yet_valid")
    exp = _number(payload["exp"])
    if exp is None:
        raise VerificationError("invalid_claims")
    if exp <= seconds - CLOCK_TOLERANCE_SECONDS:
        raise VerificationError("expired")


def _names_me_audience(audience: Sequence[str], issuers: Sequence[str]) -> bool:
    """The "me" API's audience is the issuer's address plus `/me`.

    A token for it names it beside its issuer; an API that is not that one refuses any token
    that names it, as the server does at every door but the "me" API.
    """
    return any(f"{issuer}/me" in audience for issuer in issuers)


def read_claims(
    payload: dict[str, object], issuers: Sequence[str], required_scope: str | None
) -> VerifiedToken:
    """What the verified claims say, once they are known to be well formed."""
    audience = _audiences(payload.get("aud"))
    if _names_me_audience(audience, issuers):
        raise VerificationError("me_audience")
    sub = payload.get("sub")
    if not isinstance(sub, str) or sub == "":
        raise VerificationError("invalid_claims")
    raw_scope = payload.get("scope", "")
    if not isinstance(raw_scope, str):
        raise VerificationError("invalid_claims")
    scope = tuple(part for part in raw_scope.split(" ") if part != "")
    if required_scope is not None and required_scope not in scope:
        raise VerificationError("insufficient_scope", required_scope)
    client_id = payload.get("client_id")
    return VerifiedToken(
        sub=sub,
        client_id=client_id if isinstance(client_id, str) else None,
        scope=scope,
        audience=tuple(audience),
        claims=dict(payload),
    )
