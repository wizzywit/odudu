# odudu

Typed Python clients for the Odudu admin API and the account
(`me`) API, with a synchronous and an asynchronous client for each.

```python
from odudu.admin import AdminClient, iterate_pages
from odudu.admin.operations import get_admin_tenants_tenant_clients

with AdminClient("https://id.example.com", "acme", token=lambda: fetch_token()) as admin:
    for client in iterate_pages(
        lambda page: (
            admin.call(
                get_admin_tenants_tenant_clients.sync_detailed, limit=page.limit, cursor=page.cursor
            ).parsed
        )
    ):
        print(client.client_id)
```

Every response that is not a success raises `odudu.ProblemError`. Redirects are never followed, so
a token is never sent to another origin. `python>=3.10`, `httpx`.
