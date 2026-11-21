"""Checking a token's signature with PyJWT and a key from the issuer's JWK Set."""

from __future__ import annotations

import json
from functools import lru_cache

try:
    import jwt
    from cryptography.hazmat.primitives.asymmetric.ec import EllipticCurvePublicKey
    from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
    from jwt.algorithms import ECAlgorithm, RSAAlgorithm
except ImportError as error:  # pragma: no cover - exercised only without the extra
    raise ImportError(
        "odudu.verify needs PyJWT and cryptography: pip install 'odudu[verify]'"
    ) from error

from odudu.verify._services.errors import VerificationError
from odudu.verify._services.jwks import Jwk, SigningAlgorithm

_KEY_TYPE = {"RS256": "RSA", "ES256": "EC"}

# Parsing a JWK into a key object costs about as much as the signature check it serves, and an
# issuer's keys change rarely. Keys are kept by the JWK's own text and the algorithm, so a
# replaced key set simply stops hitting; the least recently used key goes first. A key that
# fails to parse raises and is not kept.
_KEYS_KEPT = 256


@lru_cache(maxsize=_KEYS_KEPT)
def _public_key(jwk_text: str, alg: SigningAlgorithm) -> object:
    return RSAAlgorithm.from_jwk(jwk_text) if alg == "RS256" else ECAlgorithm.from_jwk(jwk_text)


def verify_signature(token: str, jwk: Jwk, alg: SigningAlgorithm) -> bytes:
    """The payload of a token signed by `jwk` with exactly `alg`.

    Only the signature is checked: PyJWT reads the real clock, so every claim is checked by
    `odudu.verify._services.access_token`, with the verifier's own.
    """
    if jwk.get("alg", alg) != alg:
        raise VerificationError("unsupported_algorithm")
    if jwk.get("kty") != _KEY_TYPE[alg]:
        raise VerificationError("malformed")
    try:
        key = _public_key(json.dumps(jwk, sort_keys=True), alg)
        if not isinstance(key, (RSAPublicKey, EllipticCurvePublicKey)):
            raise VerificationError("malformed")
        decoded = jwt.api_jws.decode_complete(token, key, algorithms=[alg])
    except jwt.InvalidSignatureError:
        raise VerificationError("bad_signature") from None
    except (jwt.PyJWTError, ValueError, TypeError):
        raise VerificationError("malformed") from None
    payload = decoded["payload"]
    return payload if isinstance(payload, bytes) else b""
