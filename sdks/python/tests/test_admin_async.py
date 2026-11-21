from __future__ import annotations

import asyncio
import uuid
from collections.abc import Awaitable, Callable

import httpx
import pytest
from conftest import run
from support import BASE_URL, TOKEN, Server, Sleeper, ok, problem, query, role_page

from odudu._generated.admin.api.default import (
    delete_admin_tenants_tenant_clients_id,
    get_admin_tenants_tenant_clients_id,
    get_admin_tenants_tenant_roles,
    post_admin_tenants_tenant_clients_id_secret,
    post_admin_tenants_tenant_subjects,
)
from odudu._generated.admin.models import PostAdminTenantsTenantSubjectsBody
from odudu._generated.admin.types import UNSET
from odudu.admin import AsyncAdminClient, ProblemError, aiterate_pages

SUBJECT = PostAdminTenantsTenantSubjectsBody(username="ada")
CREATED = {
    "id": "s1",
    "type": "user",
    "username": "ada",
    "email": None,
    "enabled": True,
    "created_at": "2026-01-01T00:00:00Z",
}
Token = str | Callable[[], str] | Callable[[], Awaitable[str]]


def admin(server: Server, sleeper: Sleeper | None = None, token: Token = TOKEN) -> AsyncAdminClient:
    return AsyncAdminClient(
        BASE_URL,
        "acme",
        token,
        transport=server.transport,
        asleep=(sleeper or Sleeper()).asleep,
    )


def test_the_tenant_is_filled_and_the_token_sent() -> None:
    server = Server([role_page(1)])
    response = run(admin(server).call(get_admin_tenants_tenant_roles.asyncio_detailed, limit=5))
    assert response.parsed is not None
    request = server.requests[0]
    assert request.url.path == "/admin/tenants/acme/roles"
    assert query(request) == {"limit": "5"}
    assert request.headers["authorization"] == f"Bearer {TOKEN}"


@pytest.mark.parametrize("segment", [".", ".."])
def test_a_dot_segment_is_refused(segment: str) -> None:
    server = Server([ok()])
    with pytest.raises(ValueError, match="path parameter"):
        run(admin(server).call(get_admin_tenants_tenant_clients_id.asyncio_detailed, segment))
    assert server.requests == []


def test_an_async_token_provider_is_called_for_every_request() -> None:
    calls: list[int] = []

    async def provider() -> str:
        calls.append(1)
        await asyncio.sleep(0)
        return f"t{len(calls)}"

    server = Server([role_page(0)])

    async def go() -> None:
        client = admin(server, token=provider)
        await client.call(get_admin_tenants_tenant_roles.asyncio_detailed)
        await client.call(get_admin_tenants_tenant_roles.asyncio_detailed)

    run(go())
    assert [r.headers["authorization"] for r in server.requests] == ["Bearer t1", "Bearer t2"]


def test_a_sync_token_provider_works_on_the_async_client() -> None:
    server = Server([role_page(0)])
    run(admin(server, token=lambda: "plain").call(get_admin_tenants_tenant_roles.asyncio_detailed))
    assert server.requests[0].headers["authorization"] == "Bearer plain"


def test_a_409_raises_a_problem_error() -> None:
    server = Server([problem(409, detail="The key is in use.")])
    with pytest.raises(ProblemError) as caught:
        run(admin(server).call(post_admin_tenants_tenant_subjects.asyncio_detailed, body=SUBJECT))
    assert (caught.value.status, caught.value.code) == (409, "idempotency-in-progress")
    assert caught.value.detail == "The key is in use."


def test_a_keyed_post_retry_reuses_the_key() -> None:
    server = Server([httpx.Response(503), httpx.Response(201, json=CREATED)])
    sleeper = Sleeper()
    run(
        admin(server, sleeper).call(
            post_admin_tenants_tenant_subjects.asyncio_detailed, body=SUBJECT
        )
    )
    first, second = server.requests
    assert uuid.UUID(first.headers["idempotency-key"]).version == 4
    assert second.headers["idempotency-key"] == first.headers["idempotency-key"]
    assert sleeper.waits == [0.2]


def test_a_post_the_document_does_not_mark_is_never_retried() -> None:
    server = Server([httpx.Response(503)])
    with pytest.raises(ProblemError):
        run(admin(server).call(post_admin_tenants_tenant_clients_id_secret.asyncio_detailed, "c"))
    assert len(server.requests) == 1
    assert "idempotency-key" not in server.requests[0].headers


def test_a_get_retries_a_503_and_honours_retry_after_capped_at_five_seconds() -> None:
    server = Server([httpx.Response(503, headers={"retry-after": "30"}), role_page(0)])
    sleeper = Sleeper()
    run(admin(server, sleeper).call(get_admin_tenants_tenant_roles.asyncio_detailed))
    assert len(server.requests) == 2
    assert sleeper.waits == [5.0]


def test_retries_stop_after_two() -> None:
    server = Server([httpx.Response(502)])
    sleeper = Sleeper()
    with pytest.raises(ProblemError):
        run(admin(server, sleeper).call(get_admin_tenants_tenant_roles.asyncio_detailed))
    assert len(server.requests) == 3
    assert sleeper.waits == [0.2, 0.4]


def test_a_network_error_is_retried_for_a_delete() -> None:
    server = Server([httpx.ConnectError("down"), httpx.Response(204)])
    run(admin(server).call(delete_admin_tenants_tenant_clients_id.asyncio_detailed, "c-1"))
    assert len(server.requests) == 2


def test_a_redirect_is_an_error_and_is_not_followed() -> None:
    server = Server(
        [httpx.Response(307, headers={"location": "https://evil.example.com/steal"}), ok()]
    )
    with pytest.raises(ProblemError) as caught:
        run(admin(server).call(get_admin_tenants_tenant_roles.asyncio_detailed))
    assert caught.value.status == 307
    assert len(server.requests) == 1


def test_a_caller_authorization_never_wins_and_another_origin_is_refused() -> None:
    server = Server([role_page(0)])

    async def go() -> None:
        client = admin(server)
        await client.http.get("/admin/tenants/acme/roles", headers={"Authorization": "x"})
        with pytest.raises(ValueError, match="origin"):
            await client.http.get("https://evil.example.com/x")

    run(go())
    assert [r.headers["authorization"] for r in server.requests] == [f"Bearer {TOKEN}"]


def test_a_non_json_gateway_page_is_not_echoed() -> None:
    server = Server([httpx.Response(502, text="<html>secret-host.internal</html>")])
    with pytest.raises(ProblemError) as caught:
        run(admin(server).call(get_admin_tenants_tenant_roles.asyncio_detailed))
    assert caught.value.detail is None
    assert "secret-host" not in str(caught.value) + repr(caught.value) + caught.value.response.text


def test_iteration_follows_cursors_and_stops_at_max_items() -> None:
    server = Server([role_page(3, "c3", 0), role_page(3, "c6", 3), role_page(3, None, 6)])
    client = admin(server)

    async def call(page: object) -> object:
        return await client.call(
            get_admin_tenants_tenant_roles.asyncio_detailed,
            limit=page.limit,  # type: ignore[attr-defined]
            cursor=page.cursor or UNSET,  # type: ignore[attr-defined]
        )

    async def collect() -> list[object]:
        return [role async for role in aiterate_pages(call, page_limit=3, max_items=5)]

    roles = run(collect())
    assert len(roles) == 5
    assert [query(r)["limit"] for r in server.requests] == ["3", "2"]
    assert [query(r).get("cursor") for r in server.requests] == [None, "c3"]


def test_iteration_stops_on_a_cursor_that_did_not_move_and_raises_problem_errors() -> None:
    server = Server([role_page(1, "same", 0), role_page(1, "same", 1), role_page(1, "same", 2)])
    client = admin(server)

    async def call(page: object) -> object:
        return await client.call(
            get_admin_tenants_tenant_roles.asyncio_detailed,
            cursor=page.cursor or UNSET,  # type: ignore[attr-defined]
        )

    async def collect() -> list[object]:
        return [role async for role in aiterate_pages(call)]

    assert len(run(collect())) == 2
    failing = Server([problem(500, detail="boom")])
    client = admin(failing)

    async def boom() -> None:
        async for _ in aiterate_pages(call):
            pass

    with pytest.raises(ProblemError):
        run(boom())


def test_async_iteration_bounds_must_be_positive_integers() -> None:
    async def call(page: object) -> object:
        return None

    with pytest.raises(ValueError, match="positive integer"):
        aiterate_pages(call, page_limit=0)
