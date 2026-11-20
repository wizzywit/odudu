"""Settings that could never work are refused when the verifier is made."""

from __future__ import annotations

import re
from collections.abc import Sequence

MAX_ISSUERS = 256

# RFC 6749 section 3.3: space-separated tokens of %x21 / %x23-5B / %x5D-7E. A scope lands in a
# `WWW-Authenticate` challenge, so one that could break a header or a quoted string is refused.
_SCOPE = re.compile(r"[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*")


def check_issuers(issuers: Sequence[str], allow_insecure: bool) -> tuple[str, ...]:
    """The configured issuers, compared with a token's `iss` as written."""
    if isinstance(issuers, str):
        raise TypeError("issuers is a sequence of issuer strings, not one string")
    chosen = tuple(issuers)
    if not chosen:
        raise ValueError("a verifier needs at least one issuer")
    if len(chosen) > MAX_ISSUERS:
        raise ValueError(f"a verifier takes at most {MAX_ISSUERS} issuers")
    for issuer in chosen:
        if not isinstance(issuer, str):
            raise TypeError("every issuer is a string")
        if issuer.endswith("/"):
            raise ValueError(
                f"the issuer {issuer} has a trailing slash; write it as the server does"
            )
        if not allow_insecure and not issuer.startswith("https://"):
            raise ValueError(
                f"the issuer {issuer} is not https; set allow_insecure_issuers for a development "
                "server"
            )
    return chosen


def check_audience(audience: str) -> str:
    if not isinstance(audience, str) or audience == "":
        raise ValueError("a verifier needs the API audience")
    return audience


def check_scope(scope: str | None, name: str) -> str | None:
    if scope is not None and _SCOPE.fullmatch(scope) is None:
        raise ValueError(
            f"{name} must be scope tokens (RFC 6749 section 3.3) separated by single spaces"
        )
    return scope
