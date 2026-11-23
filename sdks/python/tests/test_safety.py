from __future__ import annotations

import pickle
from collections.abc import Callable

import httpx
import pytest
from conftest import run
from support import BASE_URL, TOKEN, Server, ok, problem, role_page

from odudu._generated.admin.api.default import (
    get_admin_tenants_tenant_clients_id,
    get_admin_tenants_tenant_roles,
    post_admin_tenants_tenant_subjects,
)
from odudu._generated.admin.models import PostAdminTenantsTenantSubjectsBody
from odudu.admin import AdminClient, AsyncAdminClient
from odudu.me import AsyncMeClient, MeClient
from odudu.problem import ProblemError

PROVIDED = "provided-secret-77"


def sync_failure(server: Server) -> ProblemError:
    client = AdminClient(BASE_URL, "acme", TOKEN, transport=server.transport)
    with pytest.raises(ProblemError) as caught:
        client.call(get_admin_tenants_tenant_roles.sync_detailed)
    return caught.value


def async_failure(server: Server) -> ProblemError:
    client = AsyncAdminClient(BASE_URL, "acme", TOKEN, transport=server.transport)
    with pytest.raises(ProblemError) as caught:
        run(client.call(get_admin_tenants_tenant_roles.asyncio_detailed))
    return caught.value


FAILURES = [sync_failure, async_failure]
BAD_VALUES = [".", ".."]


@pytest.mark.parametrize("value", BAD_VALUES)
def test_a_dot_segment_in_a_keyword_argument_is_refused_by_the_sync_client(value: str) -> None:
    server = Server([ok()])
    client = AdminClient(BASE_URL, "acme", TOKEN, transport=server.transport)
    with pytest.raises(ValueError, match="path parameter"):
        client.call(get_admin_tenants_tenant_clients_id.sync_detailed, id=value)
    assert server.requests == []


@pytest.mark.parametrize("value", BAD_VALUES)
def test_a_dot_segment_in_a_keyword_argument_is_refused_by_the_async_client(value: str) -> None:
    server = Server([ok()])
    client = AsyncAdminClient(BASE_URL, "acme", TOKEN, transport=server.transport)
    with pytest.raises(ValueError, match="path parameter"):
        run(client.call(get_admin_tenants_tenant_clients_id.asyncio_detailed, id=value))
    assert server.requests == []


@pytest.mark.parametrize("failure", FAILURES)
@pytest.mark.parametrize(
    "reply",
    [
        httpx.Response(404),
        httpx.Response(302, headers={"location": "https://evil.example.com/"}),
        problem(409, detail="d"),
    ],
)
def test_the_request_on_an_error_response_carries_no_credentials(
    failure: Callable[[Server], ProblemError], reply: httpx.Response
) -> None:
    error = failure(Server([reply]))
    headers = error.response.request.headers
    assert "authorization" not in headers
    assert "idempotency-key" not in headers
    assert error.response.request.url.path == "/admin/tenants/acme/roles"


def test_the_idempotency_key_is_not_kept_on_the_error_request_either() -> None:
    server = Server([problem(409, detail="d")])
    client = AdminClient(BASE_URL, "acme", TOKEN, transport=server.transport)
    body = PostAdminTenantsTenantSubjectsBody(username="ada")
    with pytest.raises(ProblemError) as caught:
        client.call(post_admin_tenants_tenant_subjects.sync_detailed, body=body)
    assert "idempotency-key" in server.requests[0].headers
    assert "idempotency-key" not in caught.value.response.request.headers
    assert "authorization" in server.requests[0].headers


@pytest.mark.parametrize("failure", FAILURES)
def test_a_problem_error_survives_pickling_without_the_token(
    failure: Callable[[Server], ProblemError],
) -> None:
    error = failure(Server([problem(409, detail="The key is in use.")]))
    copy = pickle.loads(pickle.dumps(error))  # noqa: S301
    assert isinstance(copy, ProblemError)
    assert (copy.status, copy.code, copy.detail) == (
        409,
        "idempotency-in-progress",
        "The key is in use.",
    )
    assert str(copy) == str(error)
    assert TOKEN.encode() not in pickle.dumps(error)


@pytest.mark.parametrize("failure", FAILURES)
def test_a_problem_error_shows_no_token(failure: Callable[[Server], ProblemError]) -> None:
    error = failure(Server([problem(409, detail="d")]))
    assert TOKEN not in str(error) + repr(error) + repr(error.response) + repr(
        error.response.request
    )


@pytest.mark.parametrize("factory", [AdminClient, MeClient])
def test_a_sync_client_shows_neither_the_token_nor_what_the_provider_returned(
    factory: type[AdminClient] | type[MeClient],
) -> None:
    server = Server([role_page(0)])
    client = factory(BASE_URL, "acme", lambda: PROVIDED, transport=server.transport)
    if isinstance(client, AdminClient):
        client.call(get_admin_tenants_tenant_roles.sync_detailed)
    else:
        client.http.get("/tenants/acme/me/profile")
    for text in (repr(client), str(client), repr(client.http)):
        assert PROVIDED not in text


@pytest.mark.parametrize("factory", [AsyncAdminClient, AsyncMeClient])
def test_an_async_client_shows_neither_the_token_nor_what_the_provider_returned(
    factory: type[AsyncAdminClient] | type[AsyncMeClient],
) -> None:
    async def provider() -> str:
        return PROVIDED

    server = Server([role_page(0)])
    client = factory(BASE_URL, "acme", provider, transport=server.transport)
    run(client.http.get("/x"))
    for text in (repr(client), str(client), repr(client.http)):
        assert PROVIDED not in text


@pytest.mark.parametrize("name", ["admin", "me"])
def test_the_generated_operations_and_models_are_public(name: str) -> None:
    import importlib

    operations = importlib.import_module(f"odudu.{name}.operations")
    models = importlib.import_module(f"odudu.{name}.models")
    assert hasattr(operations, "__all__")
    assert len(operations.__all__) > 5
    first = getattr(operations, operations.__all__[0])
    assert callable(first.sync_detailed)
    assert callable(first.asyncio_detailed)
    assert hasattr(models, "ProblemDetails") or hasattr(models, "MeError")


def test_a_call_through_the_public_modules_is_typed_and_works() -> None:
    from odudu.admin.models import PostAdminTenantsTenantSubjectsBody as Body
    from odudu.admin.operations import get_admin_tenants_tenant_roles as roles

    server = Server([role_page(1)])
    client = AdminClient(BASE_URL, "acme", TOKEN, transport=server.transport)
    response = client.call(roles.sync_detailed)
    assert response.status_code == 200
    assert Body(username="x").username == "x"
