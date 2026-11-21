from __future__ import annotations

import re
import uuid
from collections.abc import Callable

import httpx
import pytest
from support import (
    BASE_URL,
    TOKEN,
    Server,
    Sleeper,
    ok,
    problem,
    query,
    role_page,
)

from odudu._generated.admin.api.default import (
    delete_admin_tenants_tenant_clients_id,
    get_admin_tenants,
    get_admin_tenants_tenant_clients_id,
    get_admin_tenants_tenant_roles,
    post_admin_tenants_tenant_clients_id_secret,
    post_admin_tenants_tenant_subjects,
)
from odudu._generated.admin.models import PostAdminTenantsTenantSubjectsBody
from odudu._generated.admin.types import UNSET
from odudu.admin import AdminClient, ProblemError, iterate_pages

SUBJECT = PostAdminTenantsTenantSubjectsBody(username="ada")
CREATED = {
    "id": "s1",
    "type": "user",
    "username": "ada",
    "email": None,
    "enabled": True,
    "created_at": "2026-01-01T00:00:00Z",
}


def admin(
    server: Server, sleeper: Sleeper | None = None, token: str | Callable[[], str] = TOKEN
) -> AdminClient:
    return AdminClient(
        BASE_URL, "acme", token, transport=server.transport, sleep=sleeper or Sleeper()
    )


def test_the_tenant_is_filled_into_the_path_and_the_token_is_sent() -> None:
    server = Server([role_page(1)])
    response = admin(server).call(get_admin_tenants_tenant_roles.sync_detailed, limit=5)
    assert response.parsed is not None
    request = server.requests[0]
    assert request.url.path == "/admin/tenants/acme/roles"
    assert query(request) == {"limit": "5"}
    assert request.headers["authorization"] == f"Bearer {TOKEN}"


def test_a_path_id_follows_the_tenant() -> None:
    server = Server([httpx.Response(204)])
    admin(server).call(delete_admin_tenants_tenant_clients_id.sync_detailed, "c-1")
    assert server.requests[0].method == "DELETE"
    assert server.requests[0].url.path == "/admin/tenants/acme/clients/c-1"


@pytest.mark.parametrize("segment", [".", ".."])
def test_a_dot_segment_as_a_path_id_is_refused_before_any_request(segment: str) -> None:
    server = Server([ok()])
    with pytest.raises(ValueError, match="path parameter"):
        admin(server).call(get_admin_tenants_tenant_clients_id.sync_detailed, segment)
    assert server.requests == []


def test_a_call_cannot_name_its_own_client() -> None:
    server = Server([ok()])
    with pytest.raises(TypeError, match="client"):
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed, client=object())
    assert server.requests == []


def test_a_409_raises_a_problem_error_with_the_code_and_the_detail() -> None:
    server = Server(
        [
            problem(
                409,
                detail="The key is in use.",
                errors=[{"path": "username", "message": "taken", "code": "unique"}],
            )
        ]
    )
    with pytest.raises(ProblemError) as caught:
        admin(server).call(post_admin_tenants_tenant_subjects.sync_detailed, body=SUBJECT)
    error = caught.value
    assert error.status == 409
    assert error.code == "idempotency-in-progress"
    assert error.type == "about:blank#idempotency-in-progress"
    assert error.title == "Conflict"
    assert error.detail == "The key is in use."
    assert error.instance == "/x"
    assert [(e.path, e.message, e.code) for e in error.errors] == [("username", "taken", "unique")]
    assert error.response.status_code == 409
    assert str(error) == "HTTP 409: The key is in use."


def test_a_keyed_post_gets_a_key_and_a_retry_reuses_it() -> None:
    server = Server([httpx.Response(503), httpx.Response(201, json=CREATED)])
    sleeper = Sleeper()
    admin(server, sleeper).call(post_admin_tenants_tenant_subjects.sync_detailed, body=SUBJECT)
    first, second = server.requests
    key = first.headers["idempotency-key"]
    assert uuid.UUID(key).version == 4
    assert second.headers["idempotency-key"] == key
    assert sleeper.waits == [0.2]


def test_each_logical_call_gets_its_own_key() -> None:
    server = Server([httpx.Response(201, json=CREATED)])
    client = admin(server)
    for _ in range(2):
        client.call(post_admin_tenants_tenant_subjects.sync_detailed, body=SUBJECT)
    keys = {r.headers["idempotency-key"] for r in server.requests}
    assert len(keys) == 2


def test_a_key_the_caller_names_is_kept() -> None:
    server = Server([httpx.Response(201, json=CREATED)])
    admin(server).call(
        post_admin_tenants_tenant_subjects.sync_detailed, body=SUBJECT, idempotency_key="mine-1"
    )
    assert server.requests[0].headers["idempotency-key"] == "mine-1"


def test_a_post_the_document_does_not_mark_sends_no_key_and_is_never_retried() -> None:
    server = Server([httpx.Response(503)])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(post_admin_tenants_tenant_clients_id_secret.sync_detailed, "c-1")
    assert caught.value.status == 503
    assert len(server.requests) == 1
    assert "idempotency-key" not in server.requests[0].headers


def test_a_get_retries_a_503_once_and_succeeds() -> None:
    server = Server([httpx.Response(503), role_page(1)])
    sleeper = Sleeper()
    response = admin(server, sleeper).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert response.parsed is not None
    assert len(server.requests) == 2
    assert sleeper.waits == [0.2]


def test_retries_stop_after_two_and_back_off() -> None:
    server = Server([httpx.Response(502)])
    sleeper = Sleeper()
    with pytest.raises(ProblemError) as caught:
        admin(server, sleeper).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert caught.value.status == 502
    assert len(server.requests) == 3
    assert sleeper.waits == [0.2, 0.4]


@pytest.mark.parametrize("status", [400, 401, 404, 501, 505])
def test_a_status_that_will_not_change_is_not_retried(status: int) -> None:
    server = Server([httpx.Response(status)])
    with pytest.raises(ProblemError):
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert len(server.requests) == 1


@pytest.mark.parametrize(
    ("header", "wait"),
    [("2", 2.0), ("1.5", 1.5), ("30", 5.0), ("0", 0.0), ("Wed, 21 Oct 2026 07:28:00 GMT", 0.2)],
)
def test_retry_after_is_honoured_and_capped_at_five_seconds(header: str, wait: float) -> None:
    server = Server([httpx.Response(429, headers={"retry-after": header}), role_page(0)])
    sleeper = Sleeper()
    admin(server, sleeper).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert sleeper.waits == [wait]


def test_a_network_error_is_retried_for_a_get_and_raised_after_the_last_attempt() -> None:
    server = Server([httpx.ConnectError("down"), role_page(0)])
    admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert len(server.requests) == 2
    dead = Server([httpx.ConnectError("down")])
    with pytest.raises(httpx.ConnectError):
        admin(dead).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert len(dead.requests) == 3


def test_a_network_error_is_not_retried_for_an_unkeyed_post() -> None:
    server = Server([httpx.ConnectError("down")])
    with pytest.raises(httpx.ConnectError):
        admin(server).call(post_admin_tenants_tenant_clients_id_secret.sync_detailed, "c-1")
    assert len(server.requests) == 1


def test_a_delete_is_retried() -> None:
    server = Server([httpx.Response(503), httpx.Response(204)])
    admin(server).call(delete_admin_tenants_tenant_clients_id.sync_detailed, "c-1")
    assert len(server.requests) == 2


def test_the_token_provider_is_called_for_every_request() -> None:
    calls: list[int] = []

    def provider() -> str:
        calls.append(1)
        return f"t{len(calls)}"

    server = Server([role_page(0)])
    client = admin(server, token=provider)
    client.call(get_admin_tenants_tenant_roles.sync_detailed)
    client.call(get_admin_tenants_tenant_roles.sync_detailed)
    assert [r.headers["authorization"] for r in server.requests] == ["Bearer t1", "Bearer t2"]


def test_an_awaitable_token_is_refused_by_the_sync_client() -> None:
    async def provider() -> str:
        return "t"

    server = Server([role_page(0)])
    client = admin(server, token=provider)  # type: ignore[arg-type]
    with pytest.raises(TypeError, match="async client"):
        client.call(get_admin_tenants_tenant_roles.sync_detailed)
    assert server.requests == []


def test_a_caller_authorization_never_wins() -> None:
    server = Server([role_page(0)])
    admin(server).http.get(
        "/admin/tenants/acme/roles", headers={"Authorization": "Bearer attacker"}
    )
    assert server.requests[0].headers["authorization"] == f"Bearer {TOKEN}"


def test_a_redirect_is_an_error_and_is_not_followed() -> None:
    server = Server(
        [httpx.Response(302, headers={"location": "https://evil.example.com/steal"}), ok()]
    )
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert caught.value.status == 302
    assert "redirect" in (caught.value.detail or "")
    assert len(server.requests) == 1
    assert all(r.url.host == "id.example.com" for r in server.requests)


def test_a_304_is_an_error_too() -> None:
    server = Server([httpx.Response(304)])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert caught.value.status == 304


def test_the_token_is_never_sent_to_another_origin() -> None:
    server = Server([ok()])
    with pytest.raises(ValueError, match="origin"):
        admin(server).http.get("https://evil.example.com/x")
    assert server.requests == []


def test_a_non_json_gateway_page_is_not_echoed() -> None:
    page = "<html>upstream secret-host.internal exploded</html>"
    server = Server([httpx.Response(502, text=page, headers={"content-type": "text/html"})])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    error = caught.value
    assert error.status == 502
    assert error.detail is None
    assert error.code is None
    assert "secret-host" not in str(error) + repr(error) + error.response.text
    assert str(error) == "HTTP 502"


def test_a_body_over_64_kib_is_not_read_as_a_problem() -> None:
    big = {"title": "x" * 70_000, "detail": "d"}
    server = Server([httpx.Response(400, json=big)])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert caught.value.detail is None
    assert caught.value.title is None


def test_text_and_field_errors_are_bounded() -> None:
    errors = [{"path": f"f{i}", "message": "m"} for i in range(150)]
    errors[0]["message"] = "m" * 5000
    server = Server([problem(422, title="t" * 5000, detail="d" * 5000, errors=errors)])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    error = caught.value
    assert len(error.title or "") == 1000
    assert len(error.detail or "") == 1000
    assert len(error.errors) == 100
    assert len(error.errors[0].message) == 1000


def test_a_malformed_field_error_is_dropped_and_positions_are_kept() -> None:
    errors = [
        {"path": "a", "message": "m", "line": 3, "column": None},
        {"path": "b"},
        "nope",
        {"path": "c", "message": "n", "line": True},
    ]
    server = Server([problem(422, errors=errors)])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    got = [(e.path, e.line, e.column) for e in caught.value.errors]
    assert got == [("a", 3, None), ("c", None, None)]


def test_a_deeply_nested_body_is_not_a_crash() -> None:
    server = Server([httpx.Response(400, text="[" * 60_000)])
    with pytest.raises(ProblemError) as caught:
        admin(server).call(get_admin_tenants_tenant_roles.sync_detailed)
    assert caught.value.status == 400


def test_iteration_follows_cursors_to_the_last_page() -> None:
    server = Server([role_page(2, "c2", 0), role_page(2, "c3", 2), role_page(1, None, 4)])
    client = admin(server)
    roles = list(iterate_pages(lambda p: page_call(client, p)))
    assert [getattr(r, "id") for r in roles]  # noqa: B009 == ["r0", "r1", "r2", "r3", "r4"]
    assert [query(r).get("cursor") for r in server.requests] == [None, "c2", "c3"]
    assert [query(r)["limit"] for r in server.requests] == ["50", "50", "50"]


def test_iteration_stops_at_max_items_and_never_asks_for_more_than_is_left() -> None:
    server = Server([role_page(3, "c3", 0), role_page(2, "c5", 3)])
    client = admin(server)
    roles = list(iterate_pages(lambda p: page_call(client, p), page_limit=3, max_items=5))
    assert len(roles) == 5
    assert [query(r)["limit"] for r in server.requests] == ["3", "2"]


def test_iteration_never_exceeds_the_page_limit() -> None:
    server = Server([role_page(1, "c1", 0), role_page(1, None, 1)])
    list(iterate_pages(lambda p: page_call(admin(server), p), page_limit=1))
    assert {query(r)["limit"] for r in server.requests} == {"1"}


def test_iteration_stops_on_an_empty_page_and_on_a_cursor_that_did_not_move() -> None:
    empty = Server([role_page(0, "again")])
    assert list(iterate_pages(lambda p: page_call(admin(empty), p))) == []
    assert len(empty.requests) == 1
    stuck = Server([role_page(1, "same", 0), role_page(1, "same", 1), role_page(1, "same", 2)])
    got = list(iterate_pages(lambda p: page_call(admin(stuck), p)))
    assert len(got) == 2
    assert len(stuck.requests) == 2


def test_iteration_is_lazy() -> None:
    server = Server([role_page(2, "c2", 0), role_page(2, None, 2)])
    pages = iterate_pages(lambda p: page_call(admin(server), p))
    next(pages)
    assert len(server.requests) == 1


def test_an_error_on_a_page_raises_a_problem_error_from_the_iteration() -> None:
    server = Server([role_page(1, "c1", 0), problem(500, detail="boom")])
    pages = iterate_pages(lambda p: page_call(admin(server), p))
    assert next(pages) is not None
    with pytest.raises(ProblemError):
        next(pages)


@pytest.mark.parametrize(("limit", "maximum"), [(0, 10), (-1, 10), (10, 0), (True, 10)])
def test_iteration_bounds_must_be_positive_integers(limit: int, maximum: int) -> None:
    with pytest.raises(ValueError, match="positive integer"):
        list(iterate_pages(lambda p: None, page_limit=limit, max_items=maximum))


def page_call(client: AdminClient, page: object) -> object:
    return client.call(
        get_admin_tenants_tenant_roles.sync_detailed,
        limit=page.limit,  # type: ignore[attr-defined]
        cursor=page.cursor or UNSET,  # type: ignore[attr-defined]
    )


def test_the_key_header_is_a_uuid4_hex_with_dashes() -> None:
    server = Server([httpx.Response(201, json=CREATED)])
    admin(server).call(post_admin_tenants_tenant_subjects.sync_detailed, body=SUBJECT)
    key = server.requests[0].headers["idempotency-key"]
    assert re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}", key)


def test_a_base_url_with_a_path_keeps_it_and_still_finds_the_keyed_operations() -> None:
    server = Server([httpx.Response(201, json=CREATED)])
    client = AdminClient("https://id.example.com/odudu/", "acme", TOKEN, transport=server.transport)
    client.call(post_admin_tenants_tenant_subjects.sync_detailed, body=SUBJECT)
    request = server.requests[0]
    assert request.url.path == "/odudu/admin/tenants/acme/subjects"
    assert "idempotency-key" in request.headers


def test_an_operation_that_has_no_tenant_is_called_without_one() -> None:
    server = Server([httpx.Response(200, json={"items": []})])
    admin(server).call(get_admin_tenants.sync_detailed, limit=1)
    assert server.requests[0].url.path == "/admin/tenants"


def test_a_successful_delete_with_no_body_is_none_and_not_a_parse_error() -> None:
    server = Server([httpx.Response(204)])
    response = admin(server).call(delete_admin_tenants_tenant_clients_id.sync_detailed, "c-1")
    assert response.status_code == 204
    assert response.parsed is None


def test_the_client_is_a_context_manager_that_closes_the_http_client() -> None:
    server = Server([role_page(0)])
    with admin(server) as client:
        client.call(get_admin_tenants_tenant_roles.sync_detailed)
    assert client.http.is_closed
