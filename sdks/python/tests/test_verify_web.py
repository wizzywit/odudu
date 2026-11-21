"""The FastAPI dependency and the Flask decorator, over the same verdicts as the verifier."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from verify_support import API, ISSUER, Clock, IssuerServer, SigningKey, extra, make_key, mint

from odudu.verify import AsyncVerifier, VerifiedToken, Verifier


@pytest.fixture(scope="module")
def key() -> SigningKey:
    return make_key("k1")


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def fastapi_client(key: SigningKey) -> Iterator[Any]:
    extra("fastapi")
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from odudu.verify.fastapi import require_token

    server = IssuerServer(keys=[key.jwk])
    verifier = AsyncVerifier([ISSUER], API, now=Clock(), http_client=server.async_client)
    app = FastAPI()

    @app.get("/reports")
    async def reports(
        token: VerifiedToken = Depends(require_token(verifier, scope="reports:read")),  # noqa: B008
    ) -> dict[str, str]:
        return {"sub": token.sub}

    with TestClient(app) as client:
        yield client


def test_fastapi_lets_a_verified_token_through(fastapi_client: Any, key: SigningKey) -> None:
    answer = fastapi_client.get("/reports", headers=bearer(mint(key)))
    assert (answer.status_code, answer.json()) == (200, {"sub": "subject-1"})


def test_fastapi_challenges_a_request_with_no_token(fastapi_client: Any) -> None:
    answer = fastapi_client.get("/reports")
    assert answer.status_code == 401
    assert answer.headers["www-authenticate"] == "Bearer"
    assert answer.headers["cache-control"] == "no-store"
    assert answer.json()["detail"]["error"] == "unauthorized"


def test_fastapi_refuses_a_bad_token_with_the_challenge(
    fastapi_client: Any, key: SigningKey
) -> None:
    answer = fastapi_client.get("/reports", headers=bearer(mint(key, audience="https://x")))
    assert answer.status_code == 401
    assert answer.headers["www-authenticate"] == (
        'Bearer error="invalid_token", error_description="The access token is invalid"'
    )


def test_fastapi_answers_403_for_a_missing_scope(fastapi_client: Any, key: SigningKey) -> None:
    answer = fastapi_client.get("/reports", headers=bearer(mint(key, scope="openid")))
    assert answer.status_code == 403
    assert 'scope="reports:read"' in answer.headers["www-authenticate"]


def test_fastapi_answers_400_for_a_malformed_header(fastapi_client: Any) -> None:
    answer = fastapi_client.get("/reports", headers={"Authorization": "Bearer a b"})
    assert answer.status_code == 400
    assert answer.headers["www-authenticate"] == 'Bearer error="invalid_request"'


def test_fastapi_answers_503_when_the_keys_cannot_be_read(key: SigningKey) -> None:
    extra("fastapi")
    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    from odudu.verify.fastapi import require_token

    server = IssuerServer(keys=[key.jwk], jwks_status=500)
    verifier = AsyncVerifier([ISSUER], API, now=Clock(), http_client=server.async_client)
    app = FastAPI()

    @app.get("/x")
    async def route(_: VerifiedToken = Depends(require_token(verifier))) -> dict[str, str]:  # noqa: B008
        return {}

    with TestClient(app) as client:
        answer = client.get("/x", headers=bearer(mint(key)))
    assert (answer.status_code, answer.headers["retry-after"]) == (503, "10")


def test_fastapi_refuses_a_scope_that_could_break_a_header(key: SigningKey) -> None:
    extra("fastapi")
    from odudu.verify.fastapi import require_token

    verifier = AsyncVerifier([ISSUER], API)
    with pytest.raises(ValueError, match="scope"):
        require_token(verifier, scope='a"b')


@pytest.fixture
def flask_client(key: SigningKey) -> Any:
    extra("flask")
    import flask

    from odudu.verify.flask import current_token, require_token

    server = IssuerServer(keys=[key.jwk])
    verifier = Verifier([ISSUER], API, now=Clock(), http_client=server.client)
    app = flask.Flask(__name__)

    @app.get("/reports")
    @require_token(verifier, scope="reports:read")
    def reports() -> dict[str, str]:
        return {"sub": current_token().sub}

    @app.get("/open")
    def open_route() -> dict[str, str]:
        return {"sub": current_token().sub}

    return app.test_client()


def test_flask_lets_a_verified_token_through(flask_client: Any, key: SigningKey) -> None:
    answer = flask_client.get("/reports", headers=bearer(mint(key)))
    assert (answer.status_code, answer.get_json()) == (200, {"sub": "subject-1"})


def test_flask_challenges_a_request_with_no_token(flask_client: Any) -> None:
    answer = flask_client.get("/reports")
    assert answer.status_code == 401
    assert answer.headers["www-authenticate"] == "Bearer"
    assert answer.get_json() == {
        "error": "unauthorized",
        "error_description": "An access token is required",
    }


def test_flask_refuses_a_bad_token_with_the_challenge(flask_client: Any, key: SigningKey) -> None:
    answer = flask_client.get("/reports", headers=bearer(mint(key, audience="https://x")))
    assert answer.status_code == 401
    assert answer.headers["www-authenticate"].startswith('Bearer error="invalid_token"')


def test_flask_answers_403_for_a_missing_scope(flask_client: Any, key: SigningKey) -> None:
    answer = flask_client.get("/reports", headers=bearer(mint(key, scope="openid")))
    assert answer.status_code == 403
    assert answer.headers["www-authenticate"].endswith('scope="reports:read"')


def test_flask_refuses_two_authorization_headers(flask_client: Any, key: SigningKey) -> None:
    from werkzeug.datastructures import Headers

    headers = Headers()
    headers.add("Authorization", f"Bearer {mint(key)}")
    headers.add("Authorization", f"Bearer {mint(key)}")
    assert flask_client.get("/reports", headers=headers).status_code == 400


def test_current_token_fails_on_a_route_the_decorator_did_not_guard(flask_client: Any) -> None:
    flask_client.application.config["PROPAGATE_EXCEPTIONS"] = False
    assert flask_client.get("/open").status_code == 500
