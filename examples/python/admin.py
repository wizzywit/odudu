"""Makes a client with the admin client, finds it in the tenant's list and deletes it.

A real service keeps its secret in its platform's secret store, not in code.
"""

import os
from typing import TypeVar

import httpx
from odudu.admin import AdminClient, iterate_pages
from odudu.admin.models import (
    GetAdminTenantsTenantClientsIdResponse200,
    PostAdminTenantsTenantClientsBody,
    PostAdminTenantsTenantClientsResponse201,
)
from odudu.admin.operations import (
    delete_admin_tenants_tenant_clients_id,
    get_admin_tenants_tenant_clients,
    get_admin_tenants_tenant_clients_id,
    post_admin_tenants_tenant_clients,
)

T = TypeVar("T")

BASE = os.environ.get("ODUDU_BASE", "http://localhost:3000")
TENANT = os.environ.get("TENANT", "demo")
ISSUER = f"{BASE}/tenants/{TENANT}"
ADMIN_API_AUDIENCE = "urn:odudu:params:admin-api"


def client_credentials(
    client_id: str, secret: str, *, scope: str | None = None, resource: str | None = None
) -> str:
    """An access token for a service that signs in as itself with a secret."""
    form = {"grant_type": "client_credentials"}
    if scope is not None:
        form["scope"] = scope
    if resource is not None:
        form["resource"] = resource
    response = httpx.post(
        f"{ISSUER}/protocol/openid-connect/token", auth=(client_id, secret), data=form
    )
    response.raise_for_status()
    return str(response.json()["access_token"])


def admin_client() -> AdminClient:
    # The client calls this for every request. A long-running service would keep the token
    # until it is nearly expired instead of asking each time.
    return AdminClient(
        BASE,
        TENANT,
        lambda: client_credentials(
            "example-admin",
            # A published value for the local example stack; never reuse it anywhere real.
            os.environ.get("CLIENT_SECRET", "example-admin-secret"),
            resource=ADMIN_API_AUDIENCE,
        ),
    )


def count_clients() -> int:
    """How many clients the tenant has, read page by page."""
    with admin_client() as admin:
        return sum(
            1
            for _ in iterate_pages(
                lambda page: (
                    admin.call(
                        get_admin_tenants_tenant_clients.sync_detailed,
                        limit=page.limit,
                        cursor=page.cursor,
                    ).parsed
                )
            )
        )


def success(parsed: object, model: type[T]) -> T:
    """The body of a successful call. A refusal has already raised `ProblemError`."""
    if not isinstance(parsed, model):
        raise TypeError(f"expected a {model.__name__}")
    return parsed


def main() -> None:
    with admin_client() as admin:
        body = PostAdminTenantsTenantClientsBody(client_id="example-python-created")
        body.additional_properties = {
            "name": "Made by the Python example",
            "grant_types": ["client_credentials"],
        }
        created = success(
            admin.call(post_admin_tenants_tenant_clients.sync_detailed, body=body).parsed,
            PostAdminTenantsTenantClientsResponse201,
        )
        try:
            print(f"created client {created.client_id}")
            found = success(
                admin.call(get_admin_tenants_tenant_clients_id.sync_detailed, created.id).parsed,
                GetAdminTenantsTenantClientsIdResponse200,
            )
            print(f"read it back: {found.client_id}, {found.name}")
        finally:
            admin.call(delete_admin_tenants_tenant_clients_id.sync_detailed, created.id)
            print(f"deleted client {created.client_id}")


if __name__ == "__main__":
    main()
