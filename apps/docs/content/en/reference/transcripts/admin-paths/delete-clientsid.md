---
title: 'DELETE /clients/{id}'
description: 'Requires manage-clients. Deletes the client and its OIDC configuration in one statement — the foreign key from client_oidc_config to clients…'
---

# `DELETE /clients/{id}`

Requires `manage-clients`. Deletes the client and its OIDC configuration in
one statement — the
foreign key from `client_oidc_config` to `clients` cascades, so nothing
here deletes the config row a second time. `204` with no body on success,
`404` for an id that does not exist, and the same `409` built-in-admin
guard `PATCH` uses: the built-in client cannot be deleted any more than it
can be disabled. Every role scoped to the client goes with it, so a delete
whose roles reach an admin capability the caller does not hold is refused
with `403`
([a removal is judged by what it removes](./get-groupsidroles-and-put-groupsidroles.md#a-removal-is-judged-by-what-it-removes)),
as is one whose service account holds more than the caller
([the service account's ceiling](./post-clientsidsecret.md#the-service-accounts-ceiling)).

All three outcomes against `client-facts-demo`, in that order: the built-in
client, an id nothing holds, then `demo-backend` — its secret rotated
below first, since this is the same instance the rest of this section
disabled and rotated. A `404` carries no `detail` at all, only the status
and the request id:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"
C=http://localhost:3082/admin/tenants/client-facts-demo/clients
curl -sS -X DELETE -H "$A" $C/01a17ae3-dfb4-75bb-bf4c-2de4841c9677; echo
curl -sS -X DELETE -H "$A" $C/01a109b6-ffff-7000-8000-000000000000; echo; echo
curl -sS -D - -X DELETE -H "$A" $C/01a17ae4-bb60-7411-8daa-d854b65a9d14
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be deleted","instance":"01a109b7-36fa-7857-a04f-02e4678ff189"}
{"type":"about:blank","title":"Not Found","status":404,"instance":"01a109b7-3711-79b9-86b4-2e4d9f437d1c"}

HTTP/1.1 204 No Content
x-request-id: 01a109b7-3725-751a-8d44-c50879a92140
cache-control: no-store
Date: Mon, 05 Oct 2026 01:39:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The built-in MCP client, `odudu-mcp`, that every tenant is provisioned with is
guarded against deletion too, with its own reason: an administrator turns it
off by disabling it, which `PATCH` allows. Run on the stack and tenant
`mcp-demo` of [the client listing](./get-clients-post-clients-and-get-clientsid.md):

```bash
MID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3092/admin/tenants/mcp-demo/clients?client_id_exact=odudu-mcp" | jq -r '.items[0].id')
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3092/admin/tenants/mcp-demo/clients/$MID
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1ac04-0e93-7ef9-bf55-8cab0d743972
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 204
Date: Thu, 05 Nov 2026 14:01:49 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-mcp is this tenant's built-in MCP client and cannot be deleted; disable it instead","instance":"01a1ac04-0e93-7ef9-bf55-8cab0d743972"}
```
