"""Which keys of an issuer's JWK Set may verify a token, and what its documents must say."""

from __future__ import annotations

import base64
import binascii
from typing import Literal

from odudu.verify._services.errors import KeyFetchError

SigningAlgorithm = Literal["RS256", "ES256"]
SIGNING_ALGORITHMS: tuple[SigningAlgorithm, ...] = ("RS256", "ES256")
# A key set of more than this many keys is cut to its first 20.
MAX_KEYS_PER_ISSUER = 20
_MIN_RSA_BITS = 2048

Jwk = dict[str, object]


def _rsa_bits(key: Jwk) -> int:
    modulus = key.get("n")
    if not isinstance(modulus, str):
        return 0
    try:
        raw = base64.urlsafe_b64decode(modulus + "=" * (-len(modulus) % 4))
    except (binascii.Error, ValueError):
        return 0
    return len(raw.lstrip(b"\x00")) * 8


def _is_usable(key: object) -> bool:
    """Public, for signing, of a kind the server signs with, and named.

    Stricter than `@odudu-io/node`: an RSA key under 2048 bits and an EC key that is not on
    P-256 are not usable here, so a token naming one is `unknown_key` (401) where Node answers
    `malformed` (401). The cap of 20 keys counts the usable keys only, in document order.
    """
    if not isinstance(key, dict):
        return False
    kid = key.get("kid")
    if not isinstance(kid, str) or kid == "":
        return False
    kty = key.get("kty")
    if kty not in ("RSA", "EC") or "d" in key:
        return False
    if key.get("use", "sig") != "sig":
        return False
    if key.get("alg", "RS256" if kty == "RSA" else "ES256") not in SIGNING_ALGORITHMS:
        return False
    if kty == "EC":
        return key.get("crv") == "P-256"
    return _rsa_bits(key) >= _MIN_RSA_BITS


def keys_by_kid(document: object) -> dict[str, Jwk] | None:
    """The usable keys of a JWK Set document by `kid`, the first 20 of them.

    Anything else in the set is ignored rather than failing the whole set. None when the
    document is not a JWK Set.
    """
    if not isinstance(document, dict):
        return None
    listed = document.get("keys")
    if not isinstance(listed, list):
        return None
    keys: dict[str, Jwk] = {}
    for key in listed:
        if _is_usable(key) and isinstance(key, dict):
            kid = str(key["kid"])
            if kid not in keys and len(keys) < MAX_KEYS_PER_ISSUER:
                keys[kid] = key
    return keys


def jwks_uri_of(issuer: str, document: object) -> str:
    """The `jwks_uri` of a configured issuer's discovery document.

    The document must name that issuer (OpenID Connect Discovery section 4.3); one that names
    another is not that issuer's.
    """
    if (
        not isinstance(document, dict)
        or document.get("issuer") != issuer
        or not isinstance(document.get("jwks_uri"), str)
    ):
        raise KeyFetchError(f"the discovery document of {issuer} names no jwks_uri of its own")
    uri = str(document["jwks_uri"])
    # Keys fetched over plain http can be swapped on the way; only an http issuer, which
    # `check_issuers` lets through for development, may name one.
    if not uri.startswith("https://") and not issuer.startswith("http://"):
        raise KeyFetchError(f"the jwks_uri of {issuer} is not an https address")
    return uri
