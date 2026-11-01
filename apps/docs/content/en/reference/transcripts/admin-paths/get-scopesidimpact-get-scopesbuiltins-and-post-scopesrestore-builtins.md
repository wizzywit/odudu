---
title: 'Scope impact, built-in scopes and restore'
description: 'All three require manage-tenant. They support deleting a built-in scope: what it takes, which built-ins are missing, and how to restore them…'
---

# Scope impact, built-in scopes and restore

This page covers `GET /scopes/:id/impact`, `GET /scopes/builtins` and `POST /scopes/restore-builtins`.

All three require `manage-tenant`. They are what deleting a built-in scope needs
around it: what the delete would take, which built-ins a tenant is missing, and
the way to create a missing one again. A **built-in** scope is one every tenant
is given when it is created: `openid`, `profile`, `email`, `address`, `phone`,
`roles`, `groups` and `offline_access`. `DELETE /scopes/:id` deletes any of them
but `openid`, and only when its `confirm` query parameter names the scope again,
as `DELETE /admin/tenants/{tenant}` does for a tenant, so a script cannot take
one by accident. Built-in status is decided by the name alone, so a scope created under one of those names is built in too, and a restore will not create a name that exists. An ordinary scope needs no `confirm`, and one sent with it is
ignored.

Every block below ran on a freshly built stack (`docker compose up`, then `odudu seed
admin --username ada`), with `$ADMIN_TOKEN` got as in [Getting the
token](./getting-the-token.md), and nothing else in it but what the next block
makes: the tenant `builtins-demo`, a public client `portal`, and a role `auditor`
mapped to the `roles` scope. The ids are that run's and refer to each other.

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
P=http://localhost:3000/admin/tenants/builtins-demo
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"builtins-demo"}' http://localhost:3000/admin/tenants -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"portal","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients -o /dev/null
AUDITOR=$(curl -sS -X POST -H "$A" -H "$J" -d '{"name":"auditor"}' $P/roles | jq -r .id)
ROLES=$(curl -sS -H "$A" "$P/scopes?name=roles" | jq -r '.items[0].id')
OPENID=$(curl -sS -H "$A" "$P/scopes?name=openid" | jq -r '.items[0].id')
ETAG=$(curl -sS -D - -o /dev/null -H "$A" $P/scopes/$ROLES/roles | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT -H "$A" -H "$J" -H "If-Match: $ETAG" -d "{\"role_ids\":[\"$AUDITOR\"]}" $P/scopes/$ROLES/roles -o /dev/null
```

## What a delete would take

`GET /scopes/:id/impact` says whether the scope is built in and how many clients
carry it and roles map it, the two things its deletion takes with it. Each count
stops at a ceiling and says `capped`, so the answer is two bounded index reads
however large the tenant is. `roles` is carried by `portal` and by the tenant's
own admin client, and `auditor` is mapped to it:

```bash
curl -sS -H "$A" $P/scopes/$ROLES/impact; echo
```

```
{"builtin":true,"client_assignments":{"count":2,"capped":false},"role_mappings":{"count":1,"capped":false}}
```

## Deleting a built-in scope asks for its name

Without `confirm` the delete is refused with `422` and the type
`builtin-scope-confirmation`; `detail` names the scope, what would go with it and
what to send. Nothing is deleted, and the refusal is audited. A `confirm` that is
not the scope's own name is refused the same way:

```bash
curl -sS -D - -X DELETE -H "$A" $P/scopes/$ROLES
```

```
HTTP/1.1 422 Unprocessable Entity
x-request-id: 01a18729-511f-7598-ad4a-3e50054ca7a1
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 313
Date: Thu, 29 Oct 2026 10:16:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#builtin-scope-confirmation","title":"Unprocessable Content","status":422,"detail":"roles is a built-in scope. Deleting it removes it from 2 clients and unmaps 1 role, and cannot be undone. Repeat the request with confirm=roles to delete it.","instance":"01a18729-511f-7598-ad4a-3e50054ca7a1"}
```

```bash
curl -sS -X DELETE -H "$A" "$P/scopes/$ROLES?confirm=role"; echo
```

```
{"type":"about:blank#builtin-scope-confirmation","title":"Unprocessable Content","status":422,"detail":"roles is a built-in scope. Deleting it removes it from 2 clients and unmaps 1 role, and cannot be undone. Repeat the request with confirm=roles to delete it.","instance":"01a18729-5141-7a81-afd9-0c89faaf1e0a"}
```

`openid` stays refused with `409` whatever `confirm` says, since taking it off
every client would lock every administrator of the tenant out:

```bash
curl -sS -X DELETE -H "$A" "$P/scopes/$OPENID?confirm=openid"; echo
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"openid is deleted along with every client’s assignment of it, this tenant’s built-in admin client’s included, and could lock out every administrator of this tenant","instance":"01a18729-5170-7f8c-811e-7a709b142e36"}
```

Naming the scope deletes it, with the assignments and role mappings that
referred to it:

```bash
curl -sS -D - -X DELETE -H "$A" "$P/scopes/$ROLES?confirm=roles"
```

```
HTTP/1.1 204 No Content
x-request-id: 01a18729-518a-702a-af4d-3b7578192cbb
cache-control: no-store
Date: Thu, 29 Oct 2026 10:16:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## Which are missing, and getting them back

`GET /scopes/builtins` lists every built-in in the order a new tenant is given
them, with whether this tenant has it; narrowed with `jq` to the missing ones:

```bash
curl -sS -H "$A" $P/scopes/builtins | jq -c ".items[] | select(.present | not)"
```

```
{"name":"roles","present":false}
```

`POST /scopes/restore-builtins` creates each missing built-in with the settings
a new tenant is given and answers the names it created. A scope that exists is
neither read nor changed, edited or not, so a second call creates none. It takes
no body:

```bash
curl -sS -X POST -H "$A" $P/scopes/restore-builtins; echo
curl -sS -X POST -H "$A" $P/scopes/restore-builtins; echo
```

```
{"created":["roles"]}
{"created":[]}
```

The restored scope has its shipped settings, marked `default` for clients made
from now on, but not what the deletion took: no client carries it and no role is
mapped to it, so each is assigned and mapped again. It is refused with `409`,
creating nothing, when the missing scopes would pass the tenant's limit of 1,000
scopes or of 200 scopes marked for every new client. The restored scope has a new
id, which `$ROLES` is set to first:

```bash
ROLES=$(curl -sS -H "$A" "$P/scopes?name=roles" | jq -r '.items[0].id')
curl -sS -H "$A" $P/scopes/$ROLES; echo
curl -sS -H "$A" $P/scopes/$ROLES/impact; echo
```

```
{"id":"01a18729-51d8-77dd-805d-9637168ce505","name":"roles","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"created_at":"2026-10-29T10:16:34.517Z"}
{"builtin":true,"client_assignments":{"count":0,"capped":false},"role_mappings":{"count":0,"capped":false}}
```

## The trail

A delete writes one `scope.delete` row, `allowed` or `refused`, whose detail
carries `builtin` and how many client assignments and role mappings it took or
would have taken. A restore that creates something writes one
`scope.restore_builtins` row naming what it created, and one that creates
nothing writes none. The two refusals and the delete of `roles` above, narrowed
with `jq` to the counts, and the restore:

```bash
curl -sS -H "$A" "$P/audit?resource_type=scope&action=scope.delete" | jq -c ".items[] | select(.detail.builtin) | {outcome, builtin: .detail.builtin, clients: .detail.client_assignments, roles: .detail.role_mappings}"
curl -sS -H "$A" "$P/audit?action=scope.restore_builtins" | jq -c ".items[] | {action, outcome, detail}"
```

```
{"outcome":"allowed","builtin":true,"clients":2,"roles":1}
{"outcome":"refused","builtin":true,"clients":2,"roles":1}
{"outcome":"refused","builtin":true,"clients":2,"roles":1}
{"action":"scope.restore_builtins","outcome":"allowed","detail":{"created":["roles"]}}
```

## From the command line

`odudu seed restore-scopes --tenant <name>` does the same through the same
function, for an installation with no admin token to hand. It prints the names
it created and is just as harmless to repeat. Here `groups` is deleted first
with `?confirm=groups`; the command's own warnings on standard error are
discarded:

```bash
GROUPS_SCOPE=$(curl -sS -H "$A" "$P/scopes?name=groups" | jq -r '.items[0].id')
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "$A" "$P/scopes/$GROUPS_SCOPE?confirm=groups"
docker compose exec -T odudu node dist/main.js seed restore-scopes --tenant builtins-demo 2>/dev/null
docker compose exec -T odudu node dist/main.js seed restore-scopes --tenant builtins-demo 2>/dev/null
```

```
204
{"command":"restore-scopes","tenant":"builtins-demo","tenantId":"01a18729-4fd5-7e49-b839-2254f628e506","created":["groups"]}
{"command":"restore-scopes","tenant":"builtins-demo","tenantId":"01a18729-4fd5-7e49-b839-2254f628e506","created":[]}
```
