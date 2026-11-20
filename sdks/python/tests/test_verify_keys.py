"""Reading, keeping and refreshing an issuer's keys."""

from __future__ import annotations

import asyncio
import threading
import time

import httpx
import pytest
from verify_support import (
    API,
    ISSUER,
    Clock,
    IssuerServer,
    SigningKey,
    make_key,
    mint,
)

from odudu.verify import AsyncVerifier, KeyFetchError, VerificationError, Verifier
from odudu.verify._adapter.fetch import MAX_BYTES


@pytest.fixture(scope="module")
def first() -> SigningKey:
    return make_key("k1")


def verifier(
    server: IssuerServer, clock: Clock, ttl: float = 300, issuers: list[str] | None = None
) -> Verifier:
    return Verifier(issuers or [ISSUER], API, jwks_ttl=ttl, now=clock, http_client=server.client)


def test_it_finds_the_keys_through_the_discovery_document_and_keeps_them(
    first: SigningKey,
) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    verify = verifier(server, clock)
    token = mint(first)
    verify.verify(token)
    verify.verify(token)
    assert (server.discovery_requests, server.jwks_requests) == (1, 1)


def test_it_reads_both_again_once_the_ttl_has_passed(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    verify = verifier(server, clock, ttl=1000)
    token = mint(first)
    verify.verify(token)
    clock.now += 1001
    verify.verify(mint(first, now=clock.now))
    assert (server.discovery_requests, server.jwks_requests) == (2, 2)


def test_an_unknown_kid_refetches_the_keys_at_most_once_per_ten_seconds(
    first: SigningKey,
) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    verify = verifier(server, clock)
    verify.verify(mint(first))
    second, stranger = make_key("k2"), make_key("k3")
    server.keys = [first.jwk, second.jwk]

    clock.now += 9
    with pytest.raises(VerificationError) as refused:
        verify.verify(mint(second, now=clock.now))
    assert refused.value.reason == "unknown_key"
    assert server.jwks_requests == 1

    clock.now += 2
    assert verify.verify(mint(second, now=clock.now)).sub == "subject-1"
    assert server.jwks_requests == 2

    clock.now += 1
    hostile = mint(stranger, now=clock.now)
    with pytest.raises(VerificationError):
        verify.verify(hostile)
    assert server.jwks_requests == 2
    clock.now += 10
    with pytest.raises(VerificationError):
        verify.verify(mint(stranger, now=clock.now))
    assert server.jwks_requests == 3


def test_a_burst_of_unknown_kid_tokens_costs_one_fetch(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    verify = verifier(server, clock)
    verify.verify(mint(first))
    clock.now += 11
    stranger = mint(make_key("k9"), now=clock.now)
    for _ in range(20):
        with pytest.raises(VerificationError):
            verify.verify(stranger)
    assert server.jwks_requests == 2


def test_the_key_cache_holds_the_first_twenty_keys_of_an_issuer() -> None:
    keys = [make_key(f"k{i}") for i in range(21)]
    server, clock = IssuerServer(keys=[key.jwk for key in keys]), Clock()
    verify = verifier(server, clock)
    assert verify.verify(mint(keys[19])).sub == "subject-1"
    with pytest.raises(VerificationError) as refused:
        verify.verify(mint(keys[20]))
    assert refused.value.reason == "unknown_key"


def test_a_key_set_ignores_private_encryption_and_unnamed_keys(first: SigningKey) -> None:
    private = {**first.jwk, "kid": "private", "d": "AA"}
    encryption = {**first.jwk, "kid": "enc", "use": "enc"}
    unnamed = {key: value for key, value in first.jwk.items() if key != "kid"}
    server, clock = IssuerServer(keys=[private, encryption, unnamed, first.jwk]), Clock()
    verify = verifier(server, clock)
    assert verify.verify(mint(first)).sub == "subject-1"
    with pytest.raises(VerificationError) as refused:
        verify.verify(mint(SigningKey("private", first.private, private)))
    assert refused.value.reason == "unknown_key"


def test_a_jwks_endpoint_that_fails_is_a_key_fetch_error_not_a_token_fault(
    first: SigningKey,
) -> None:
    server, clock = IssuerServer(keys=[first.jwk], jwks_status=503), Clock()
    verify = verifier(server, clock)
    token = mint(first)
    with pytest.raises(KeyFetchError):
        verify.verify(token)
    assert server.jwks_requests == 1
    clock.now += 5
    with pytest.raises(KeyFetchError):
        verify.verify(token)
    assert server.jwks_requests == 1
    server.jwks_status = 200
    clock.now += 6
    assert verify.verify(mint(first, now=clock.now)).sub == "subject-1"


def test_a_discovery_document_that_names_another_issuer_is_refused(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk], discovery_issuer="https://other"), Clock()
    with pytest.raises(KeyFetchError):
        verifier(server, clock).verify(mint(first))


@pytest.mark.parametrize("declared", [True, False])
def test_an_oversized_jwks_document_is_refused(first: SigningKey, declared: bool) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    if declared:
        server.jwks_body = b"{}"
        server.jwks_headers = {"content-length": str(MAX_BYTES + 1)}
    else:
        server.jwks_body = b" " * (MAX_BYTES + 1)
    with pytest.raises(KeyFetchError):
        verifier(server, clock).verify(mint(first))


@pytest.mark.parametrize("body", [b"not json", b"[]", b'{"keys": "x"}', b'{"keys": {}}'])
def test_a_document_that_is_not_a_jwk_set_is_refused(first: SigningKey, body: bytes) -> None:
    server, clock = IssuerServer(keys=[first.jwk], jwks_body=body), Clock()
    with pytest.raises(KeyFetchError):
        verifier(server, clock).verify(mint(first))


def test_a_redirect_is_not_followed(first: SigningKey) -> None:
    server, clock = (
        IssuerServer(keys=[first.jwk], redirect_to="https://elsewhere.test/jwks"),
        Clock(),
    )
    with pytest.raises(KeyFetchError):
        verifier(server, clock).verify(mint(first))
    assert not any("elsewhere" in url for url in server.requested)


def test_a_failed_unknown_kid_refetch_keeps_known_keys_working(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    verify = verifier(server, clock)
    verify.verify(mint(first))
    server.jwks_status = 503
    clock.now += 11
    stranger = make_key("k7")
    with pytest.raises(VerificationError) as refused:
        verify.verify(mint(stranger, now=clock.now))
    assert refused.value.reason == "unknown_key"
    assert server.jwks_requests == 2
    assert verify.verify(mint(first, now=clock.now)).sub == "subject-1"
    clock.now += 1
    with pytest.raises(VerificationError):
        verify.verify(mint(stranger, now=clock.now))
    assert server.jwks_requests == 2


def test_stale_keys_serve_up_to_twice_the_ttl_when_a_refresh_fails(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    verify = verifier(server, clock, ttl=1000)
    verify.verify(mint(first))
    server.jwks_status = 503
    clock.now += 1001
    assert verify.verify(mint(first, now=clock.now)).sub == "subject-1"
    assert server.jwks_requests == 2
    clock.now += 500
    assert verify.verify(mint(first, now=clock.now)).sub == "subject-1"
    assert server.jwks_requests == 3
    clock.now += 600
    with pytest.raises(KeyFetchError):
        verify.verify(mint(first, now=clock.now))


def test_a_token_over_16_kib_is_refused_before_any_key_is_read(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk]), Clock()
    with pytest.raises(VerificationError) as refused:
        verifier(server, clock).verify("a" * 16_385)
    assert (refused.value.status, refused.value.code) == (401, "invalid_token")
    assert server.discovery_requests == 0


def test_two_issuers_are_each_read_for_their_own_tokens(first: SigningKey) -> None:
    other_issuer = "https://id.example.test/tenants/other"
    second = make_key("k2")
    one = IssuerServer(keys=[first.jwk])
    two = IssuerServer(keys=[second.jwk], issuer=other_issuer)

    def route(request: httpx.Request) -> httpx.Response:
        return (two if str(request.url).startswith(other_issuer) else one)(request)

    verify = Verifier(
        [ISSUER, other_issuer],
        API,
        now=Clock(),
        http_client=httpx.Client(transport=httpx.MockTransport(route)),
    )
    assert verify.verify(mint(first)).sub == "subject-1"
    assert verify.verify(mint(second, issuer=other_issuer)).sub == "subject-1"
    with pytest.raises(VerificationError) as refused:
        verify.verify(mint(second, issuer="https://elsewhere.test"))
    assert refused.value.reason == "wrong_issuer"
    assert (one.jwks_requests, two.jwks_requests) == (1, 1)


def test_a_burst_of_threads_makes_one_fetch(first: SigningKey) -> None:
    server, clock = IssuerServer(keys=[first.jwk], release=threading.Event()), Clock()
    verify = verifier(server, clock)
    token = mint(first)
    results: list[str] = []
    threads = [
        threading.Thread(target=lambda: results.append(verify.verify(token).sub)) for _ in range(12)
    ]
    for thread in threads:
        thread.start()
    time.sleep(0.2)
    assert server.release is not None
    server.release.set()
    for thread in threads:
        thread.join(10)
    assert results == ["subject-1"] * 12
    assert server.jwks_requests == 1


def test_a_burst_of_tasks_makes_one_fetch(first: SigningKey) -> None:
    async def scenario() -> tuple[list[str], int]:
        server = IssuerServer(keys=[first.jwk], async_release=asyncio.Event())
        async with AsyncVerifier(
            [ISSUER], API, now=Clock(), http_client=server.async_client
        ) as verify:
            token = mint(first)
            pending = asyncio.gather(*(verify.verify(token) for _ in range(12)))
            await asyncio.sleep(0.05)
            assert server.async_release is not None
            server.async_release.set()
            return [item.sub for item in await pending], server.jwks_requests

    subjects, requests = asyncio.run(scenario())
    assert subjects == ["subject-1"] * 12
    assert requests == 1


def test_the_async_verifier_limits_an_unknown_kid_refetch(first: SigningKey) -> None:
    async def scenario() -> list[int]:
        server, clock = IssuerServer(keys=[first.jwk]), Clock()
        counts: list[int] = []
        async with AsyncVerifier(
            [ISSUER], API, now=clock, http_client=server.async_client
        ) as verify:
            await verify.verify(mint(first))
            stranger = make_key("k4")
            for step in (9, 2):
                clock.now += step
                with pytest.raises(VerificationError):
                    await verify.verify(mint(stranger, now=clock.now))
                counts.append(server.jwks_requests)
        return counts

    assert asyncio.run(scenario()) == [1, 2]


def test_the_async_verifier_reports_a_key_fetch_error(first: SigningKey) -> None:
    async def scenario() -> None:
        server = IssuerServer(keys=[first.jwk], jwks_status=500)
        async with AsyncVerifier(
            [ISSUER], API, now=Clock(), http_client=server.async_client
        ) as verify:
            with pytest.raises(KeyFetchError):
                await verify.verify(mint(first))

    asyncio.run(scenario())


def test_the_clock_defaults_to_the_real_one(first: SigningKey) -> None:
    server = IssuerServer(keys=[first.jwk])
    verify = Verifier([ISSUER], API, http_client=server.client)
    assert verify.verify(mint(first, now=time.time())).sub == "subject-1"
