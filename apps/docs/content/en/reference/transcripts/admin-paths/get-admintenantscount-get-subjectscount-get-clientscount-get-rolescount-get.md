---
title: 'Counts: tenants, subjects, clients, roles, groups, scopes'
description: 'How many rows a listing would page through, without paging through them.'
---

# Counts: tenants, subjects, clients, roles, groups, scopes

This page covers `GET /admin/tenants/count`, `GET /subjects/count`, `GET /clients/count`, `GET /roles/count`, `GET /groups/count` and `GET /scopes/count`.

How many rows a listing would page through, without paging through them.
Each count takes its list's own parameters minus `?cursor=` and `?limit=`,
under the same rules — a search is one field at a time, every filter is
`AND`ed, anything else is refused with `400` naming it — and requires its
list's own capability: `manage-tenants` for the tenant collection, which
carries no `{tenant}` segment for the same reason `GET /admin/tenants`
does; `view-users` for subjects, which `manage-users` also reaches;
`manage-clients` for clients; and `manage-tenant` for roles, groups and
scopes. `count` is a reserved tenant name, so `/admin/tenants/count` never
names a tenant, and a subject or client id is a uuid, so `/count` never
names one either.

The answer is `{"count": n, "capped": false}`, or `{"count": 10000, "capped":
true}` once more than ten thousand rows match: counting stops one row past that
ceiling. A count reads the rows its list would page through, in its list's
order, from the same index — never a pass over the table and never another
tenant's rows. The one read beyond that: a searched subjects count whose matches
fall under the ceiling may read the tenant's whole subject index to join it,
when the planner costs that cheaper than one probe per match (an integration
test holds both plans). A capped count says only that there are more; it is
never an estimate. No capped response is shown here, since nothing here holds
ten thousand of anything — an integration test covers it with a lowered ceiling.

As `ada`, with the roles, groups, subjects and clients the sections above
created in its `demo`. The tenant collection first, then the list the second
count agrees with:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/count?name=demo"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?name=demo"
```

```
{"count":53,"capped":false}
{"count":1,"capped":false}
{"items":[{"id":"01a0d6fc-3626-7e23-94d7-3b1b666e278f","name":"demo","display_name":"Demo","enabled":true,"created_at":"2026-10-27T00:58:50.257Z"}]}
```

Subjects, unfiltered and then under `?username=ADA` — the three the search
under `GET /subjects` returns — and under `?enabled=false`, which nothing
in `demo` is:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?username=ADA"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects/count?enabled=false"
```

```
{"count":11,"capped":false}
{"count":3,"capped":false}
{"count":0,"capped":false}
```

Clients, roles, groups and scopes, each unfiltered or under the searches
their own sections ran:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients/count?type=public"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles/count?name=billing"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/roles/count?name=billing&client=tenant"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/groups/count?name=eng"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/scopes/count?name=o"
```

```
{"count":10,"capped":false}
{"count":3,"capped":false}
{"count":2,"capped":false}
{"count":2,"capped":false}
{"count":2,"capped":false}
{"count":9,"capped":false}
{"count":2,"capped":false}
```

`?counts_toward_max_clients=` separates the clients a tenant's `max_clients` counts
(the ones an administrator or a registration token made, and the built-in ones) from
those that registered themselves or came from a metadata document. It is a filter
of the list as well, and `true` or `false` are its only values. These run against
`mcp-demo`, the tenant the [`mcp` policy section of the bootstrap
page](../request-paths/bootstrap.md#the-mcp-policy) registered six clients in
without a credential, on that section's own stack and with nothing else done to
it, so the built-in `odudu-admin` and `odudu-mcp` are the other two:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/mcp-demo/clients/count"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/mcp-demo/clients/count?counts_toward_max_clients=true"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/mcp-demo/clients/count?counts_toward_max_clients=false"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/mcp-demo/clients?counts_toward_max_clients=true" \
  | jq -c '[.items[].client_id]'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/mcp-demo/clients/count?counts_toward_max_clients=maybe"
```

```
{"count":8,"capped":false}
{"count":2,"capped":false}
{"count":6,"capped":false}
["odudu-admin","odudu-mcp"]
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/counts_toward_max_clients must be equal to one of the allowed values","errors":[{"path":"counts_toward_max_clients","message":"must be equal to one of the allowed values"}],"instance":"01a1b13e-c78f-7033-9530-71bccfa17170"}
```

A page control is not a count parameter, and two search fields are refused as
the list refuses them. The first two refusals are the generated schema's, hence
their generic `title`; the third is the handler's. In `demo`, since none of them
reads a row:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects/count?limit=5"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects/count?cursor=x"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3080/admin/tenants/demo/subjects/count?username=a&email=b"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: limit","errors":[{"path":"limit","message":"must NOT have additional properties"}],"instance":"01a0ea61-845b-74ab-9020-373d1a6ada67"}
{"type":"about:blank","title":"Error","status":400,"detail":"querystring must NOT have additional properties: cursor","errors":[{"path":"cursor","message":"must NOT have additional properties"}],"instance":"01a0ea61-846d-7b1b-afe7-c61051d5153f"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: username or email, not both","errors":[{"path":"email","message":"search one field at a time: username or email, not both"}],"instance":"01a0ea61-847a-7970-bb2c-77e99c2bf5e8"}
```
