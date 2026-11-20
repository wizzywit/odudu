"""Hostile tokens and documents, the fetch deadline, and the order claims are judged in."""

from __future__ import annotations

import asyncio
import base64
import threading
import time
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
    SlowServer,
    extra,
    make_key,
    mint,
)

from odudu.verify import AsyncVerifier, KeyFetchError, VerificationError, Verifier
from odudu.verify._adapter.deadline import Deadline
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


def test_a_huge_integer_exp_is_invalid_not_an_error(key: SigningKey) -> None:
    assert reason(key, mint(key, claims={"exp": 10**400})) == "invalid_claims"


@pytest.mark.parametrize("nbf", [10**400, "x", None, True])
def test_an_nbf_that_is_not_a_number_is_not_yet_valid_as_in_node(
    key: SigningKey, nbf: object
) -> None:
    assert reason(key, mint(key, claims={"nbf": nbf})) == "not_yet_valid"


@pytest.mark.parametrize("token", [None, 7, b"abc", ["a"]])
def test_a_token_that_is_not_a_string_is_malformed(key: SigningKey, token: Any) -> None:
    assert reason(key, token) == "malformed"
    with pytest.raises(VerificationError) as refused:
        asyncio.run(_averify(key, token))
    assert refused.value.reason == "malformed"


async def _averify(key: SigningKey, token: Any) -> object:
    server = IssuerServer(keys=[key.jwk])
    async with AsyncVerifier([ISSUER], API, now=Clock(), http_client=server.async_client) as v:
        return await v.verify(token)


def test_unusable_keys_do_not_consume_the_cap_and_are_unknown(key: SigningKey) -> None:
    short: dict[str, object] = {
        "kty": "RSA",
        "n": b64(b"\x01" * 128),
        "e": "AQAB",
        "alg": "RS256",
        "use": "sig",
    }
    other_curve: dict[str, object] = {
        "kty": "EC",
        "crv": "P-384",
        "x": "AA",
        "y": "AA",
        "alg": "ES256",
    }
    unusable = [{**(short if i % 2 else other_curve), "kid": f"bad{i}"} for i in range(24)]
    usable = [make_key(f"k{i}") for i in range(21)]
    server = IssuerServer(keys=[*unusable, *(u.jwk for u in usable)])
    verify = Verifier([ISSUER], API, now=Clock(), http_client=server.client)
    assert verify.verify(mint(usable[19])).sub == "subject-1"
    for name, bad in (("bad1", unusable[1]), ("bad0", unusable[0]), ("k20", None)):
        signer = usable[20] if bad is None else SigningKey(name, key.private, bad)
        with pytest.raises(VerificationError) as refused:
            verify.verify(mint(signer))
        assert refused.value.reason == "unknown_key"


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


def test_fastapi_body_shape_for_a_missing_scope(key: SigningKey) -> None:
    extra("fastapi")
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from odudu.verify import VerifiedToken
    from odudu.verify.fastapi import require_token

    server = IssuerServer(keys=[key.jwk])
    guard = require_token(
        AsyncVerifier([ISSUER], API, now=Clock(), http_client=server.async_client),
        scope="reports:write",
    )
    app = FastAPI()

    @app.get("/x")
    async def route(_: VerifiedToken = Depends(guard)) -> dict[str, str]:  # noqa: B008
        return {}

    with TestClient(app) as client:
        answer = client.get("/x", headers={"Authorization": f"Bearer {mint(key)}"})
    assert answer.status_code == 403
    assert answer.json() == {
        "detail": {
            "error": "insufficient_scope",
            "error_description": "The access token lacks the required scope",
        }
    }


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
        get_json(client, f"{ISSUER}/jwks", Deadline(5.0, clock))
    clock.now = 0.0
    assert (
        get_json(
            httpx.Client(transport=trickling(clock, 0.1, 3)), f"{ISSUER}/jwks", Deadline(5.0, clock)
        )
        == {}
    )


def test_the_async_fetch_has_the_same_deadline() -> None:
    clock = Clock(0.0)

    async def scenario() -> None:
        client = httpx.AsyncClient(transport=trickling(clock))
        with pytest.raises(KeyFetchError, match="too long"):
            await aget_json(client, f"{ISSUER}/jwks", Deadline(5.0, clock))

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


BUDGET = 1.0


@pytest.fixture(params=["trickle", "stall"])
def slow(request: pytest.FixtureRequest) -> Iterator[SlowServer]:
    server = SlowServer(str(request.param))
    yield server
    server.close()


def test_a_server_that_trickles_or_stalls_is_cut_at_the_budget(
    key: SigningKey, slow: SlowServer
) -> None:
    verify = Verifier(
        [slow.issuer],
        API,
        now=Clock(),
        http_client=httpx.Client(trust_env=False),
        allow_insecure_issuers=True,
        fetch_timeout=BUDGET,
    )
    token = mint(key, issuer=slow.issuer)
    started = time.monotonic()
    with pytest.raises(KeyFetchError):
        verify.verify(token)
    assert time.monotonic() - started < BUDGET + 1
    # The refresh lock was released: a second call is answered from memory at once.
    started = time.monotonic()
    with pytest.raises(KeyFetchError):
        verify.verify(token)
    assert time.monotonic() - started < 0.5


def test_the_async_verifier_cuts_a_trickling_or_stalled_server_at_the_budget(
    key: SigningKey, slow: SlowServer
) -> None:
    async def scenario() -> tuple[float, float]:
        async with AsyncVerifier(
            [slow.issuer],
            API,
            now=Clock(),
            http_client=httpx.AsyncClient(trust_env=False),
            allow_insecure_issuers=True,
            fetch_timeout=BUDGET,
        ) as verify:
            token = mint(key, issuer=slow.issuer)
            timings = []
            for _ in range(2):
                started = time.monotonic()
                with pytest.raises(KeyFetchError):
                    await verify.verify(token)
                timings.append(time.monotonic() - started)
            return timings[0], timings[1]

    first, second = asyncio.run(scenario())
    assert first < BUDGET + 1
    assert second < 0.5


def test_discovery_and_the_key_set_share_one_budget(key: SigningKey) -> None:
    clock = Clock(0.0)

    def answer(request: httpx.Request) -> httpx.Response:
        clock.now += 3.0
        if request.url.path.endswith("openid-configuration"):
            return httpx.Response(200, json={"issuer": ISSUER, "jwks_uri": f"{ISSUER}/jwks"})
        return httpx.Response(200, json={"keys": [key.jwk]})

    store = KeyStore(
        [ISSUER], httpx.Client(transport=httpx.MockTransport(answer)), 300.0, Clock(), clock, 5.0
    )
    with pytest.raises(KeyFetchError):
        store.key_for(ISSUER, "k1")
