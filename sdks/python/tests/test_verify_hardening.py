"""Hostile tokens and documents, the fetch deadline, and the order claims are judged in."""

from __future__ import annotations

import asyncio
import base64
import threading
from collections.abc import AsyncIterator, Iterator
from typing import Any

import httpx
import jwt
import pytest
from verify_support import (
    API,
    ISSUER,
    NOW,
    Clock,
    IssuerServer,
    SigningKey,
    extra,
    make_key,
    mint,
)

from odudu.verify import AsyncVerifier, KeyFetchError, VerificationError, Verifier
from odudu.verify._adapter.fetch import aget_json, get_json
from odudu.verify._use_cases.key_store import AsyncKeyStore, KeyStore


@pytest.fixture(scope="module")
def key() -> SigningKey:
    return make_key("k1")


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


DEEP = b64(b"[" * 12000)


def verifier(key: SigningKey, server: IssuerServer | None = None) -> Verifier:
    server = server or IssuerServer(keys=[key.jwk])
    return Verifier([ISSUER], API, now=Clock(), http_client=server.client)


def reason(key: SigningKey, token: str) -> str:
    with pytest.raises(VerificationError) as refused:
        verifier(key).verify(token)
    return refused.value.reason


@pytest.mark.parametrize("crit", [["foo"], []])
def test_a_header_with_crit_is_malformed(key: SigningKey, crit: list[str]) -> None:
    token = jwt.encode(
        {"iss": ISSUER, "sub": "s", "aud": API, "exp": int(NOW) + 300},
        key.private,
        algorithm="ES256",
        headers={"typ": "at+jwt", "kid": "k1", "crit": crit, "foo": 1},
    )
    assert reason(key, token) == "malformed"


def test_a_deeply_nested_header_or_payload_is_malformed_not_an_error(key: SigningKey) -> None:
    head, payload, signature = mint(key).split(".")
    assert reason(key, f"{DEEP}.{payload}.{signature}") == "malformed"
    assert reason(key, f"{head}.{DEEP}.{signature}") == "malformed"


def test_a_deeply_nested_jwks_body_is_a_key_fetch_error(key: SigningKey) -> None:
    server = IssuerServer(keys=[key.jwk], jwks_body=b"[" * 12000)
    with pytest.raises(KeyFetchError):
        verifier(key, server).verify(mint(key))


def test_the_web_helpers_answer_401_for_a_deeply_nested_token(key: SigningKey) -> None:
    extra("fastapi")
    extra("flask")
    import flask
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from odudu.verify import VerifiedToken
    from odudu.verify.fastapi import require_token as fastapi_require
    from odudu.verify.flask import require_token as flask_require

    head, _, signature = mint(key).split(".")
    headers = {"Authorization": f"Bearer {head}.{DEEP}.{signature}"}
    server = IssuerServer(keys=[key.jwk])
    app = FastAPI()
    guard = fastapi_require(
        AsyncVerifier([ISSUER], API, now=Clock(), http_client=server.async_client)
    )

    @app.get("/x")
    async def route(_: VerifiedToken = Depends(guard)) -> dict[str, str]:  # noqa: B008
        return {}

    with TestClient(app) as client:
        assert client.get("/x", headers=headers).status_code == 401
    web = flask.Flask(__name__)

    @web.get("/x")
    @flask_require(Verifier([ISSUER], API, now=Clock(), http_client=server.client))
    def view() -> dict[str, str]:
        return {}

    assert web.test_client().get("/x", headers=headers).status_code == 401


@pytest.mark.parametrize("claim", ["exp", "nbf"])
def test_a_huge_integer_claim_is_invalid_not_an_error(key: SigningKey, claim: str) -> None:
    assert reason(key, mint(key, claims={claim: 10**400})) == "invalid_claims"


def test_a_signature_with_padding_is_malformed(key: SigningKey) -> None:
    assert reason(key, mint(key) + "==") == "malformed"


@pytest.mark.parametrize(
    ("claims", "audience", "expected"),
    [
        ({"iat": "x"}, API, "invalid_claims"),
        ({"iat": "x", "exp": int(NOW) - 100}, API, "invalid_claims"),
        ({"exp": int(NOW) - 100}, "https://x", "wrong_audience"),
        ({"nbf": int(NOW) + 100, "exp": int(NOW) - 100}, API, "not_yet_valid"),
        ({"nbf": int(NOW) + 100, "exp": "x"}, API, "not_yet_valid"),
        ({"exp": "x"}, "https://x", "wrong_audience"),
    ],
)
def test_claims_are_judged_in_the_order_jose_judges_them(
    key: SigningKey, claims: dict[str, object], audience: str, expected: str
) -> None:
    assert reason(key, mint(key, audience=audience, claims=claims)) == expected


def test_a_token_with_no_exp_is_invalid_before_the_audience_is_looked_at(
    key: SigningKey,
) -> None:
    token = jwt.encode(
        {"iss": ISSUER, "sub": "s", "aud": "https://x"},
        key.private,
        algorithm="ES256",
        headers={"typ": "at+jwt", "kid": "k1"},
    )
    assert reason(key, token) == "invalid_claims"


def test_flask_refuses_a_coroutine_view_when_it_is_decorated(key: SigningKey) -> None:
    extra("flask")
    from odudu.verify.flask import require_token

    async def view() -> str:
        return "x"

    with pytest.raises(TypeError, match="async"):
        require_token(verifier(key))(view)


class Trickle(httpx.SyncByteStream, httpx.AsyncByteStream):
    """A body that arrives a chunk at a time, each one taking `step` seconds on `clock`."""

    def __init__(self, clock: Clock, step: float, chunks: int) -> None:
        self.clock, self.step, self.chunks = clock, step, chunks

    def __iter__(self) -> Iterator[bytes]:
        for _ in range(self.chunks):
            self.clock.now += self.step
            yield b" "
        yield b"{}"

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self:
            yield chunk


def trickling(clock: Clock, step: float = 3.0, chunks: int = 10) -> httpx.MockTransport:
    return httpx.MockTransport(
        lambda request: httpx.Response(200, stream=Trickle(clock, step, chunks))
    )


def test_a_body_that_trickles_past_the_deadline_is_a_key_fetch_error() -> None:
    clock = Clock(0.0)
    client = httpx.Client(transport=trickling(clock))
    with pytest.raises(KeyFetchError, match="too long"):
        get_json(client, f"{ISSUER}/jwks", clock)
    clock.now = 0.0
    assert get_json(httpx.Client(transport=trickling(clock, 0.1, 3)), f"{ISSUER}/jwks", clock) == {}


def test_the_async_fetch_has_the_same_deadline() -> None:
    clock = Clock(0.0)

    async def scenario() -> None:
        client = httpx.AsyncClient(transport=trickling(clock))
        with pytest.raises(KeyFetchError, match="too long"):
            await aget_json(client, f"{ISSUER}/jwks", clock)

    asyncio.run(scenario())


def test_the_lock_is_free_after_a_fetch_that_ran_out_of_time() -> None:
    clock = Clock(0.0)
    store = KeyStore([ISSUER], httpx.Client(transport=trickling(clock)), 300.0, Clock(), clock)
    with pytest.raises(KeyFetchError):
        store.key_for(ISSUER, "k1")
    lock: Any = store._locks[ISSUER]
    assert isinstance(lock, type(threading.Lock()))
    assert lock.acquire(blocking=False)
    lock.release()


def test_the_async_lock_is_free_after_a_fetch_that_ran_out_of_time() -> None:
    clock = Clock(0.0)

    async def scenario() -> bool:
        store = AsyncKeyStore(
            [ISSUER], httpx.AsyncClient(transport=trickling(clock)), 300.0, Clock(), clock
        )
        with pytest.raises(KeyFetchError):
            await store.key_for(ISSUER, "k1")
        return not store._locks[ISSUER].locked()

    assert asyncio.run(scenario())
