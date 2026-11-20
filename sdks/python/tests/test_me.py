from __future__ import annotations

import httpx
import pytest
from conftest import run
from support import BASE_URL, TOKEN, Server, Sleeper, consent_page, query

from odudu._generated.me.api.default import (
    delete_tenants_tenant_me_sessions_id,
    get_tenants_tenant_me_consents,
)
from odudu._generated.me.types import UNSET
from odudu.me import AsyncMeClient, MeClient, ProblemError, aiterate_pages, iterate_pages


def me(server: Server) -> MeClient:
    return MeClient(BASE_URL, "acme", TOKEN, transport=server.transport, sleep=Sleeper())


def test_the_tenant_is_filled_into_the_me_path() -> None:
    server = Server([consent_page(1)])
    me(server).call(get_tenants_tenant_me_consents.sync_detailed)
    assert server.requests[0].url.path == "/tenants/acme/me/consents"
    assert server.requests[0].headers["authorization"] == f"Bearer {TOKEN}"


def test_the_error_code_of_a_me_refusal_is_its_error_field() -> None:
    body = {"error": "invalid_token", "error_description": "The token expired."}
    server = Server([httpx.Response(401, json=body)])
    with pytest.raises(ProblemError) as caught:
        me(server).call(get_tenants_tenant_me_consents.sync_detailed)
    assert caught.value.status == 401
    assert caught.value.code == "invalid_token"
    assert caught.value.detail == "The token expired."


def test_iteration_follows_next_cursor() -> None:
    server = Server([consent_page(2, "n2"), consent_page(1, None)])
    client = me(server)

    def call(page: object) -> object:
        return client.call(
            get_tenants_tenant_me_consents.sync_detailed,
            limit=page.limit,  # type: ignore[attr-defined]
            cursor=page.cursor or UNSET,  # type: ignore[attr-defined]
        )

    assert len(list(iterate_pages(call))) == 3
    assert [query(r).get("cursor") for r in server.requests] == [None, "n2"]


def test_no_me_operation_takes_an_idempotency_key() -> None:
    server = Server([httpx.Response(503), httpx.Response(204)])
    me(server).call(delete_tenants_tenant_me_sessions_id.sync_detailed, "s-1")
    assert len(server.requests) == 2
    assert all("idempotency-key" not in r.headers for r in server.requests)


def test_the_async_client_fills_the_tenant_and_iterates() -> None:
    server = Server([consent_page(2, "n2"), consent_page(1, None)])
    client = AsyncMeClient(BASE_URL, "acme", TOKEN, transport=server.transport)

    async def call(page: object) -> object:
        return await client.call(
            get_tenants_tenant_me_consents.asyncio_detailed,
            limit=page.limit,  # type: ignore[attr-defined]
            cursor=page.cursor or UNSET,  # type: ignore[attr-defined]
        )

    async def collect() -> list[object]:
        return [item async for item in aiterate_pages(call)]

    assert len(run(collect())) == 3
    assert server.requests[0].url.path == "/tenants/acme/me/consents"
