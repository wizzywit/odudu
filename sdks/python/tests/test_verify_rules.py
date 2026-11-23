"""The rules that need no keys: the challenge text, configuration, claims and credentials."""

from __future__ import annotations

import subprocess
import sys

import httpx
import pytest
from verify_support import API, ISSUER, Clock, IssuerServer, SigningKey, make_key, mint

from odudu.verify import VerificationError, Verifier
from odudu.verify._services.access_token import check_claims
from odudu.verify._services.credentials import read_credentials
from odudu.verify._services.errors import KeyFetchError
from odudu.verify._services.refusal import refusal_for


@pytest.fixture(scope="module")
def key() -> SigningKey:
    return make_key("k1")


def verifier(key: SigningKey, scope: str | None = None) -> Verifier:
    return Verifier(
        [ISSUER], API, scope, now=Clock(), http_client=IssuerServer(keys=[key.jwk]).client
    )


def test_an_invalid_token_is_a_401_with_the_node_challenge() -> None:
    error = VerificationError("bad_signature")
    assert (error.status, error.code) == (401, "invalid_token")
    assert error.challenge == (
        'Bearer error="invalid_token", error_description="The access token is invalid"'
    )


def test_an_expired_token_says_so_and_nothing_more() -> None:
    assert VerificationError("expired").challenge == (
        'Bearer error="invalid_token", error_description="The access token expired"'
    )


def test_a_missing_scope_is_a_403_whose_challenge_names_the_scope(key: SigningKey) -> None:
    with pytest.raises(VerificationError) as refused:
        verifier(key, "reports:write").verify(mint(key))
    assert refused.value.status == 403
    assert refused.value.challenge == (
        'Bearer error="insufficient_scope", '
        'error_description="The access token lacks the required scope", '
        'scope="reports:write"'
    )


def test_the_challenge_never_echoes_the_token(key: SigningKey) -> None:
    token = mint(key, audience="https://elsewhere.test")
    with pytest.raises(VerificationError) as refused:
        verifier(key).verify(token)
    shown = " ".join([refused.value.challenge, str(refused.value), repr(refused.value)])
    assert token.split(".")[1] not in shown
    assert "subject-1" not in shown


@pytest.mark.parametrize("typ", ["AT+JWT", "application/at+jwt", "JWT", None])
def test_a_typ_other_than_at_jwt_is_refused_exactly(key: SigningKey, typ: str | None) -> None:
    with pytest.raises(VerificationError) as refused:
        verifier(key).verify(mint(key, typ=typ))
    assert refused.value.reason == "wrong_type"


def test_an_id_token_and_a_me_audience_token_are_refused_at_an_api(key: SigningKey) -> None:
    with pytest.raises(VerificationError) as refused:
        verifier(key).verify(mint(key, typ="JWT"))
    assert refused.value.reason == "wrong_type"
    with pytest.raises(VerificationError) as refused:
        verifier(key).verify(mint(key, audience=[API, f"{ISSUER}/me"]))
    assert refused.value.reason == "me_audience"


def test_hs256_and_none_are_refused_before_a_key_is_looked_up(key: SigningKey) -> None:
    server = IssuerServer(keys=[key.jwk])
    verify = Verifier([ISSUER], API, now=Clock(), http_client=server.client)
    forged = _hmac_token()
    with pytest.raises(VerificationError) as refused:
        verify.verify(forged)
    assert refused.value.reason == "unsupported_algorithm"
    assert server.discovery_requests == 0


def _hmac_token() -> str:
    import jwt

    return jwt.encode(
        {"iss": ISSUER, "sub": "s", "aud": API, "exp": 1_800_000_100},
        "x" * 32,
        algorithm="HS256",
        headers={"typ": "at+jwt", "kid": "k1"},
    )


def test_a_key_of_another_type_than_the_algorithm_is_refused(key: SigningKey) -> None:
    server = IssuerServer(keys=[{**key.jwk, "alg": "RS256"}])
    verify = Verifier([ISSUER], API, now=Clock(), http_client=server.client)
    with pytest.raises(VerificationError):
        verify.verify(mint(key))


def test_the_verified_token_reads_the_claims(key: SigningKey) -> None:
    token = verifier(key).verify(mint(key, scope="openid  reports:read"))
    assert (token.sub, token.client_id, token.scope) == (
        "subject-1",
        "client-1",
        ("openid", "reports:read"),
    )
    assert token.audience == (API,)
    assert "subject-1" in repr(token)
    assert "claims" not in repr(token)


@pytest.mark.parametrize("claims", [{"scope": 7}, {"sub": ""}, {"sub": 5}, {"exp": "later"}])
def test_claims_of_the_wrong_shape_are_invalid(key: SigningKey, claims: dict[str, object]) -> None:
    with pytest.raises(VerificationError) as refused:
        verifier(key).verify(mint(key, claims=claims))
    assert refused.value.reason == "invalid_claims"


def test_the_clock_tolerance_is_five_seconds() -> None:
    base = {"iss": ISSUER, "aud": API}
    check_claims({**base, "exp": 100}, ISSUER, API, 104.9)
    with pytest.raises(VerificationError):
        check_claims({**base, "exp": 100}, ISSUER, API, 105)
    check_claims({**base, "exp": 200, "nbf": 105}, ISSUER, API, 100)
    with pytest.raises(VerificationError):
        check_claims({**base, "exp": 200, "nbf": 106}, ISSUER, API, 100)


@pytest.mark.parametrize(
    ("values", "kind"),
    [
        ([], "none"),
        (["Basic abc"], "none"),
        (["Bearer"], "malformed"),
        (["Bearer "], "malformed"),
        (["Bearer a b"], "malformed"),
        (["Bearer  abc"], "malformed"),
        (["Bearer a", "Bearer b"], "malformed"),
        (["bearer abc.def-ghi_jkl=="], "token"),
    ],
)
def test_the_authorization_header_is_read_as_rfc_6750_asks(values: list[str], kind: str) -> None:
    assert read_credentials(values).kind == kind


def test_the_refusals_match_the_node_middleware() -> None:
    unavailable = refusal_for(KeyFetchError("x"))
    assert (unavailable.status, unavailable.headers["retry-after"]) == (503, "10")
    refused = refusal_for(VerificationError("expired"))
    assert refused.body == (
        '{"error":"invalid_token","error_description":"The access token expired"}'
    )
    assert refused.headers["cache-control"] == "no-store"


@pytest.mark.parametrize(
    ("issuers", "error"),
    [
        ("https://id.example.test", TypeError),
        ([], ValueError),
        (["https://id.example.test/"], ValueError),
        (["http://id.example.test"], ValueError),
        ([f"https://id.example.test/{i}" for i in range(257)], ValueError),
    ],
)
def test_issuers_that_could_never_work_are_refused(
    issuers: list[str] | str, error: type[Exception]
) -> None:
    with pytest.raises(error):
        Verifier(issuers, API)


def test_a_development_issuer_needs_the_insecure_switch() -> None:
    Verifier(["http://localhost:3000"], API, allow_insecure_issuers=True).close()


@pytest.mark.parametrize("scope", ["", "a b", "a  b", 'a"b', "a\\b", " a", "a ", "a\tb"])
def test_a_scope_that_could_break_a_header_is_refused(scope: str) -> None:
    with pytest.raises(ValueError, match="required_scope"):
        Verifier([ISSUER], API, scope)


def test_an_empty_audience_and_a_zero_ttl_are_refused() -> None:
    with pytest.raises(ValueError, match="audience"):
        Verifier([ISSUER], "")
    with pytest.raises(ValueError, match="jwks_ttl"):
        Verifier([ISSUER], API, jwks_ttl=0)


def test_a_verifier_that_made_its_client_closes_it_and_one_given_stays_open() -> None:
    given = httpx.Client()
    Verifier([ISSUER], API, http_client=given).close()
    assert not given.is_closed
    given.close()
    owned = Verifier([ISSUER], API)
    owned.close()


def test_importing_the_admin_client_does_not_load_the_verifier_libraries() -> None:
    script = (
        "import sys, odudu, odudu.admin, odudu.me\n"
        "loaded = [m for m in ('jwt', 'cryptography', 'odudu.verify') if m in sys.modules]\n"
        "sys.exit(1 if loaded else 0)\n"
    )
    done = subprocess.run([sys.executable, "-c", script], check=False)  # noqa: S603
    assert done.returncode == 0
