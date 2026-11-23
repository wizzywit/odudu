from __future__ import annotations

import pytest
from support import BASE_URL, TOKEN, Server

from odudu.admin import AdminClient, AsyncAdminClient
from odudu.me import AsyncMeClient, MeClient

SECRET = "tok-must-not-leak-9"
BAD_TENANTS = ["", ".", "..", "a/b", "a\\b", "a%2Fb", "a\nb", "a\x00b", "a\x7fb", "/"]
BAD_URLS = [
    "",
    "id.example.com",
    "/relative",
    "ftp://id.example.com",
    "file:///etc/passwd",
    "http://",
]
FACTORIES = [AdminClient, AsyncAdminClient, MeClient, AsyncMeClient]


@pytest.mark.parametrize("factory", FACTORIES)
@pytest.mark.parametrize("tenant", BAD_TENANTS)
def test_a_tenant_that_is_not_a_name_is_refused_without_echoing_the_token(
    factory: type, tenant: str
) -> None:
    with pytest.raises(ValueError, match="tenant") as caught:
        factory(BASE_URL, tenant, SECRET)
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize("factory", FACTORIES)
@pytest.mark.parametrize("url", BAD_URLS)
def test_a_base_url_that_is_not_absolute_http_is_refused(factory: type, url: str) -> None:
    with pytest.raises(ValueError, match="base_url") as caught:
        factory(url, "acme", SECRET)
    assert SECRET not in str(caught.value)


@pytest.mark.parametrize("factory", FACTORIES)
def test_a_tenant_with_dots_inside_is_a_name(factory: type) -> None:
    server = Server([])
    factory(BASE_URL, "acme.eu", TOKEN, transport=server.transport)


@pytest.mark.parametrize("factory", FACTORIES)
@pytest.mark.parametrize("token", [None, 5, b"x"])
def test_a_token_that_is_neither_text_nor_a_function_is_refused(
    factory: type, token: object
) -> None:
    with pytest.raises(TypeError, match="token"):
        factory(BASE_URL, "acme", token)


@pytest.mark.parametrize("bad", ["", "a\nb", "a\r\nX: y", "a\x00"])
def test_a_token_that_cannot_be_a_header_value_is_refused_when_used(bad: str) -> None:
    from odudu._generated.admin.api.default import get_admin_tenants_tenant_roles

    client = AdminClient(BASE_URL, "acme", lambda: bad, transport=Server([]).transport)
    with pytest.raises(ValueError, match="token") as caught:
        client.call(get_admin_tenants_tenant_roles.sync_detailed)
    assert bad not in str(caught.value) or bad == ""
