"""Runs the example against a stack provisioned by ../_shared/provision.sh.

The admin script is run as a user would run it, and the API is called through
FastAPI's test client with tokens Odudu issues, so the keys it checks them with
are the stack's own.
"""

import pytest
from fastapi.testclient import TestClient
from odudu.admin.operations import post_admin_tenants_tenant_clients

import admin
from app import app


def token_for_reports(scope: str | None) -> str:
    return admin.client_credentials("example-m2m", "example-m2m-secret", scope=scope)


def test_the_script_makes_a_client_reads_it_back_and_deletes_it(
    capsys: pytest.CaptureFixture[str],
) -> None:
    before = admin.count_clients()
    admin.main()
    printed = capsys.readouterr().out
    assert "created client example-python-created\n" in printed
    assert "read it back: example-python-created, Made by the Python example\n" in printed
    assert "deleted client example-python-created\n" in printed
    assert admin.count_clients() == before


def test_a_client_left_by_a_crashed_run_is_removed_first(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with admin.admin_client() as client:
        client.call(post_admin_tenants_tenant_clients.sync_detailed, body=admin.new_client())
    before = admin.count_clients()
    admin.main()
    assert "created client example-python-created\n" in capsys.readouterr().out
    assert admin.count_clients() == before - 1


def test_a_request_without_a_token_is_refused_with_a_challenge() -> None:
    response = TestClient(app).get("/reports")
    assert response.status_code == 401
    assert response.headers["www-authenticate"].startswith("Bearer")


def test_a_token_with_the_scope_is_let_through() -> None:
    headers = {"authorization": f"Bearer {token_for_reports('reports:read')}"}
    response = TestClient(app).get("/reports", headers=headers)
    assert response.status_code == 200
    assert response.json()["caller"] == "example-m2m"


def test_a_valid_token_without_the_scope_is_forbidden() -> None:
    headers = {"authorization": f"Bearer {token_for_reports(None)}"}
    response = TestClient(app).get("/reports", headers=headers)
    assert response.status_code == 403
    assert "insufficient_scope" in response.headers["www-authenticate"]


def test_something_that_is_not_a_token_is_refused() -> None:
    headers = {"authorization": "Bearer not.a.token"}
    assert TestClient(app).get("/reports", headers=headers).status_code == 401
