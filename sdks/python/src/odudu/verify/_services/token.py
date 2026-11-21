"""What a verified access token carries."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class VerifiedToken:
    """The claims of a token that passed every check.

    `claims` is left out of the repr, because it can hold personal data.
    """

    sub: str
    client_id: str | None
    scope: tuple[str, ...]
    audience: tuple[str, ...]
    claims: dict[str, object] = field(repr=False)
