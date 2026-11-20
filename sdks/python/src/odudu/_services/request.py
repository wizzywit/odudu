"""What a client refuses before it sends anything."""

from __future__ import annotations

from collections.abc import Sequence
from urllib.parse import urlsplit


def validate_base_url(base_url: object) -> str:
    """Refuses what would send a token somewhere unintended: a relative or non-http(s) URL."""
    if isinstance(base_url, str):
        try:
            parts = urlsplit(base_url)
            usable = parts.scheme in ("http", "https") and bool(parts.hostname)
        except ValueError:
            usable = False
        if usable:
            return base_url
    raise ValueError("base_url must be an absolute http(s) URL")


def _is_safe_segment(value: str) -> bool:
    if value in ("", ".", ".."):
        return False
    return not any(ord(char) <= 0x1F or char in ("\x7f", "/", "\\", "%") for char in value)


def validate_tenant(tenant: object) -> str:
    if isinstance(tenant, str) and _is_safe_segment(tenant):
        return tenant
    raise ValueError(
        "tenant must be a name: not empty, not . or .., and without /, \\, % or control characters"
    )


def refuse_dot_segments(arguments: Sequence[object]) -> None:
    """A path id of `.` or `..` would be resolved by the HTTP layer into another resource."""
    for value in arguments:
        if value in (".", ".."):
            raise ValueError('a path parameter must not be "." or ".."')


def bearer(token: object) -> str:
    """The `Authorization` value for a token, which must be usable as a header value."""
    if (
        not isinstance(token, str)
        or token == ""
        or any(ord(char) <= 0x1F or ord(char) == 0x7F for char in token)
    ):
        raise ValueError("token must be a non-empty string without control characters")
    return f"Bearer {token}"
