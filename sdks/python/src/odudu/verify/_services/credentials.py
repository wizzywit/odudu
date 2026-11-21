"""Reading the `Authorization` header of a request (RFC 6750 section 2.1)."""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

# `Bearer` followed by one token68 (RFC 7235 section 2.1).
_TOKEN68 = re.compile(r"[A-Za-z0-9\-._~+/]+=*")


@dataclass(frozen=True)
class Credentials:
    """`token` holds a bearer token. `none`: nothing was sent, or a scheme this API does not
    take, and RFC 6750 section 3.1 wants a challenge with no error code. `malformed`: several
    `Authorization` headers, or a Bearer value that is not `Bearer <token>`.
    """

    kind: Literal["token", "none", "malformed"]
    token: str = ""


def read_credentials(values: Sequence[str]) -> Credentials:
    if not values:
        return Credentials("none")
    if len(values) > 1:
        return Credentials("malformed")
    only = values[0]
    scheme, space, token = only.partition(" ")
    if scheme.lower() != "bearer":
        return Credentials("none")
    if space == "" or _TOKEN68.fullmatch(token) is None:
        return Credentials("malformed")
    return Credentials("token", token)
