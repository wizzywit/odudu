---
title: 'Flows: list, create, read, replace, make default, delete'
description: 'All six require manage-tenant. They list, make, read, replace, promote and delete the tenant’s sign-in flows, at most 20, one of which is the default.'
---

# Flows: list, create, read, replace, make default, delete

This page covers `GET /flows`, `POST /flows`, `GET /flows/:id`, `PUT /flows/:id`, `POST /flows/:id/make-default` and `DELETE /flows/:id`.

All six require `manage-tenant`. A tenant holds up to 20 named sign-in flows. Exactly one is the **default**,
the flow a sign-in runs when a client names none. A client names another through its `flow_id`
([`PATCH /clients/{id}`](./patch-clientsid.md)), and a flow some client names is not deleted. A flow is an ordered list of at most 20 steps, each an `authenticator`
and a `requirement`, and a flow's meaning is in its order, so it is always written whole.

- `GET /flows` lists every flow of the tenant, ordered by name, with `total` and `available`, and each flow's
  `client_count`, how many clients name it. A tenant holds
  at most 20 flows, so the list is never paged: `total` is all of them. Its `ETag` covers the flows and their counts.
- `POST /flows` makes a flow that is not the default from a `name` and `steps`. It answers `201` with the flow
  and its `ETag`.
- `GET /flows/{id}` reads one, with an `ETag` over its `id`, `name`, `is_default` and `steps`.
- `PUT /flows/{id}` replaces the name and the steps together, keeping the id and whether it is the default.
  **`If-Match` is mandatory**: the matching `GET` answers the tag, an absent header or `*` is refused with
  `428`, and a stale one with `412`.
- `POST /flows/{id}/make-default` makes the flow the default in one transaction: the flow that was the default
  stops being it. It needs the flow's own `ETag` in `If-Match`, answers the flow, and for the flow that already is
  the default changes and records nothing. A sign-in already under way records only which authenticators it has
  satisfied, so it takes its next step from the flow that is the default then.
- `DELETE /flows/{id}` removes a flow and answers `204`. It refuses the default flow, so another flow is made the
  default first, and a flow some client names, so those clients are given another flow or none first.

`GET /flow/executions` and `PUT /flow/executions` are the default flow's steps, with an `index` per step, and
are [on their own page](./get-flowexecutions-and-put-flowexecutions.md); a change through either is seen
through the other.

A name is 1 to 64 characters once trimmed, counted in code points, and unique within the tenant: the
`(tenant_id, name)` constraint decides, so a repeat is `409` `flow-name-taken` and nothing is written. A tenant
at 20 flows refuses a 21st with `409` `flow-limit`. The count is taken inside the write's transaction under
the lock every flow write takes, so two creates at 19 flows cannot both pass. The default flow is refused a
delete with `409` `default-flow`, and a flow some client names with `409` `flow-in-use`, whose `detail` counts the
clients and names at most ten by their `client_id`. A step list is refused before the database is asked, with the `400` types of
`PUT /flow/executions` (`#flow-empty`, `#flow-no-enabled-step`, `#flow-no-first-challenge`,
`#flow-unknown-authenticator`, `#flow-duplicate-authenticator`), the last two with `errors` naming the step as
`steps[1].authenticator`. The body is strict: `is_default` and a step's `index` are not fields. Every route
answers `404` for a flow of another tenant, and a creation, replacement and deletion each write an audit row.

A new tenant has one flow, the default, which `provisionTenant` made with the four steps every tenant starts with. `GET` lists it, with `total`, the authenticators a step may name in `available`, and an `ETag` that covers the flows:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d3a1-18d6-7467-a821-643f4933882a
cache-control: no-store
etag: "34e06bbe0204f3808ca590b090d93d41bfe338ebec063f64ee18313a66e47e4a"
content-type: application/json; charset=utf-8
content-length: 413
Date: Fri, 13 Nov 2026 06:38:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d3a0-f700-73fd-bcb9-2588ba04e200","name":"default","is_default":true,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}],"client_count":0}],"total":1,"available":["password","passkey","otp","recovery-code"]}
```

`POST` makes a flow from a name and a list of steps, answers `201` with the flow and its own `ETag`, and never makes a default one:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "  staff  ", "steps": [{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "conditional"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
HTTP/1.1 201 Created
x-request-id: 01a1d3a1-1917-7afb-ae2b-f2d9a0e86377
cache-control: no-store
etag: "dbece4b123a5ff9fabc075ec16056bad45101da4947bf832cbf648f206151aa1"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 06:38:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a1-1926-7ad5-bf5a-c292dc156ba4","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

The name was trimmed. The list is ordered by name, and the new flow is the one that is not the default:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.total, (.items[] | {id, name, is_default})'
```

```
2
{"id":"01a1d3a0-f700-73fd-bcb9-2588ba04e200","name":"default","is_default":true}
{"id":"01a1d3a1-1926-7ad5-bf5a-c292dc156ba4","name":"staff","is_default":false}
```

One flow, with the `ETag` its replacement waits on. `STAFF` is the id the list showed:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d3a1-1990-7b62-811a-22430bd6f6e3
cache-control: no-store
etag: "dbece4b123a5ff9fabc075ec16056bad45101da4947bf832cbf648f206151aa1"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 06:38:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a1-1926-7ad5-bf5a-c292dc156ba4","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

`PUT` replaces the name and the steps together, on that tag. The id and `is_default` stay:

```bash
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "If-Match: $ETAG" \
  -d '{"name": "crew", "steps": [{"authenticator": "passkey", "requirement": "alternative"}, {"authenticator": "password", "requirement": "alternative"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d3a1-1a0c-7af6-99ff-c9941470adae
cache-control: no-store
etag: "4b1153fd9b4baf132f80bfdeec237d5b9b67e368322f43931615994cd3767af1"
content-type: application/json; charset=utf-8
content-length: 201
Date: Fri, 13 Nov 2026 06:38:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a1-1926-7ad5-bf5a-c292dc156ba4","name":"crew","is_default":false,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"}]}
```

The same, now stale, header changes nothing, and a request with no `If-Match`, or `*`, is refused before anything is read:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "If-Match: $ETAG" \
  -d '{"name": "crew", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$STAFF
echo
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "crew", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d3a1-1a29-7f22-a534-af64a310c0a0"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a flow","instance":"01a1d3a1-1a42-724a-816d-a81bb3bbd0f4"}
```

A name another flow holds is refused with `409`, whether it is made or renamed to; the default's name is `default`. The constraint on `(tenant_id, name)` decides it, and nothing is written:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "default", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
{"type":"about:blank#flow-name-taken","title":"Conflict","status":409,"detail":"a flow named \"default\" already exists","instance":"01a1d3a1-1a5d-774b-88a6-a516381f9d4d"}
```

A step list is refused at save time, before the database is asked, with the types `PUT /flow/executions` has. Each names the step at fault under `steps`:

```bash
for steps in '[]' '[{"authenticator": "password", "requirement": "disabled"}]' '[{"authenticator": "passkey", "requirement": "required"}]' '[{"authenticator": "sms", "requirement": "required"}]' '[{"authenticator": "password", "requirement": "required"}, {"authenticator": "password", "requirement": "alternative"}]'; do
  curl -sS -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"name\": \"bad\", \"steps\": $steps}" \
    http://localhost:3000/admin/tenants/demo/flows
  echo
done
```

```
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d3a1-1a7c-7363-a21b-42681553ea16"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d3a1-1a92-7102-9dfb-f1a3107aba35"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d3a1-1aa9-7924-a8c1-7328543c164d"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"steps[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d3a1-1ac0-732b-b64b-4eef3c17af6b"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"steps[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d3a1-1af6-7a10-b1ce-fe5b1179173e"}
```

A name that is blank, or more than 64 characters, and a field the body does not have, are `400` with the path of the field. `is_default` is not a field: which flow is the default is not something a write here changes:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "   ", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
echo
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"name\": \"$(printf 'x%.0s' $(seq 1 65))\", \"steps\": [{\"authenticator\": \"password\", \"requirement\": \"required\"}]}" \
  http://localhost:3000/admin/tenants/demo/flows
echo
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "x", "is_default": true, "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: Too small: expected string to have >=1 characters","errors":[{"path":"name","message":"Too small: expected string to have >=1 characters"}],"instance":"01a1d3a1-1b14-764a-84aa-d19ede479ebf"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name must be at most 64 characters","errors":[{"path":"name","message":"name must be at most 64 characters"}],"instance":"01a1d3a1-1b37-799d-aa4d-c089eef3864f"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: is_default","errors":[{"path":"is_default","message":"must NOT have additional properties"}],"instance":"01a1d3a1-1b54-7d0f-bf27-fa646c7ccab0"}
```

The default flow can be renamed and its steps replaced here, and it stays the default. `GET /flow/executions` is that same flow's steps with an `index`, so a change through either is seen through the other:

```bash
DETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -H "If-Match: $DETAG" \
  -d '{"name": "default", "steps": [{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "conditional"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flow/executions
```

```
{"id":"01a1d3a0-f700-73fd-bcb9-2588ba04e200","name":"default","is_default":true,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional"}],"available":["password","passkey","otp","recovery-code"]}
```

The default flow is never deleted: a sign-in that names no flow runs it. Any other flow is, and a second delete finds nothing:

```bash
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
echo
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d3a1-1bc0-75d4-9568-f4ca8cdd53fa"}
HTTP/1.1 204 No Content
x-request-id: 01a1d3a1-1bdb-7c07-a65c-c83483cc1d5d
cache-control: no-store
Date: Fri, 13 Nov 2026 06:38:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d3a1-1926-7ad5-bf5a-c292dc156ba4","instance":"01a1d3a1-1bf6-72f4-a4ab-eed641164488"}
```

The default flow is not deleted while it is the default, but another flow can be made the default, which is what a client that names no flow runs. `POST .../make-default` moves it in one transaction: the flow that was the default stops being it, and `flow/executions` now reads and writes the new default's steps. It needs the flow's own `ETag` in `If-Match`, as `PUT` does:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "partners", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
201
```

```bash
PTAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $PTAG" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.items[] | {name, is_default}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d3a1-1c74-7c54-945a-62763fcda557
cache-control: no-store
etag: "226ac64299919db18fd126f7cb3ac16fa268f31040e0c71e84ab2d3680bc9970"
content-type: application/json; charset=utf-8
content-length: 145
Date: Fri, 13 Nov 2026 06:38:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a1-1c28-7c62-888d-d629da23dc9a","name":"partners","is_default":true,"steps":[{"authenticator":"password","requirement":"required"}]}
{"name":"default","is_default":false}
{"name":"partners","is_default":true}
{"items":[{"index":0,"authenticator":"password","requirement":"required"}],"available":["password","passkey","otp","recovery-code"]}
```

Asking again for the flow that is already the default changes nothing and writes no audit row. The tag it was answered is the flow's current one; a stale tag is `412` and none is `428`, whatever the flow is, and a flow of another tenant is `404`:

```bash
PTAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $PTAG" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'If-Match: "stale"' http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $PTAG" http://localhost:3000/admin/tenants/other/flows/$PARTNERS/make-default
```

```
200
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d3a1-1cfd-7889-bfbe-2caffa10dbb5"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to make a flow the default","instance":"01a1d3a1-1d16-7b69-8d62-d3607a6ad0fc"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d3a1-1c28-7c62-888d-d629da23dc9a","instance":"01a1d3a1-1d30-7da4-a5fc-1fb0cd0ff152"}
```

The flow that was the default is an ordinary flow now, and the new default is the one that is refused a delete:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS
```

```
204
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d3a1-1d67-7125-92d7-7d3d2c513d72"}
```

A client names a flow through its `flow_id`, on a create or a `PATCH`; null, which every client has until it is set, follows the default. First a flow of its own, and a client that names it:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "kiosk", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows | jq -c '{name, is_default}'
```

```
{"name":"kiosk","is_default":false}
```

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"client_id\": \"lobby\", \"redirect_uris\": [\"https://lobby.example/callback\"], \"grant_types\": [\"authorization_code\"], \"flow_id\": \"$KIOSK\"}" \
  http://localhost:3000/admin/tenants/demo/clients | jq -c '{client_id, flow_id}'
```

```
{"client_id":"lobby","flow_id":"01a1d3a1-1d96-7e06-85c2-bad832f10ea5"}
```

A flow that is not the tenant's, another tenant's included, is refused with `400` and the code `unknown_flow` in `errors`, and nothing is written:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"flow_id": "01a1d341-0000-7000-8000-000000000000"}' \
  http://localhost:3000/admin/tenants/demo/clients/$LOBBY
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"flow_id: flow_id names no flow of this tenant","errors":[{"path":"flow_id","message":"flow_id names no flow of this tenant","code":"unknown_flow"}],"instance":"01a1d3a1-1e42-7a77-8bd3-6a65dd9fa9a3"}
```

The list now says which flow the client names. The flow cannot be deleted while it does, and the refusal says how many clients and which. Once the client names none, it can:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.items[] | {name, client_count}'
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$KIOSK
echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"flow_id": null}' http://localhost:3000/admin/tenants/demo/clients/$LOBBY | jq -c '{client_id, flow_id}'
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$KIOSK
```

```
{"name":"kiosk","client_count":1}
{"name":"partners","client_count":0}
{"type":"about:blank#flow-in-use","title":"Conflict","status":409,"detail":"the flow is named by 1 client: lobby; set that client’s flow_id to another flow or null first","instance":"01a1d3a1-1e91-7d6e-9d2a-534bfcd89abd"}
{"client_id":"lobby","flow_id":null}
204
```

A tenant holds at most 20. Nineteen more make 20 with the default, and the next is refused with `409` and the cap in its `detail`:

```bash
for n in $(seq 1 19); do
  curl -sS -o /dev/null -w '%{http_code} ' -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H 'Content-Type: application/json' \
    -d "{\"name\": \"bulk-$n\", \"steps\": [{\"authenticator\": \"password\", \"requirement\": \"required\"}]}" \
    http://localhost:3000/admin/tenants/demo/flows
done; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.total'
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name": "one-too-many", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201
20
{"type":"about:blank#flow-limit","title":"Conflict","status":409,"detail":"a tenant holds at most 20 flows","instance":"01a1d3a1-22de-7481-bc16-8d6a14324e08"}
```

A flow belongs to its tenant. The same token, asking another tenant for it, finds nothing, on every route that takes an id:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/other/flows/$BULK
echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/other/flows/$BULK
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/other/flows | jq -c '.total'
```

```
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d3a1-1f13-7d57-a908-119d75a5d2aa","instance":"01a1d3a1-2328-7eac-bfe3-519ab44115ac"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d3a1-1f13-7d57-a908-119d75a5d2aa","instance":"01a1d3a1-234c-7d2f-98e5-681b59980d23"}
1
```

Each create, replace and delete is an audit row with the name and steps, by value. A create names what it set, a replace only what changed, and a delete what it removed. The newest two creates, the two replaces (the rename of `staff` and the change to the default flow's steps) the promotion and the delete:

```bash
for action in flow.create flow.amend flow.default_set flow.delete; do
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/audit?action=$action&limit=2" \
    | jq -c '.items | sort_by(.occurred_at) | .[] | {action, outcome, resource_type, detail}'
done
```

```
{"action":"flow.create","outcome":"allowed","resource_type":"flow","detail":{"name":{"after":"bulk-18"},"steps":{"after":[{"requirement":"required","authenticator":"password"}]}}}
{"action":"flow.create","outcome":"allowed","resource_type":"flow","detail":{"name":{"after":"bulk-19"},"steps":{"after":[{"requirement":"required","authenticator":"password"}]}}}
{"action":"flow.amend","outcome":"allowed","resource_type":"flow","detail":{"name":{"after":"crew","before":"staff"},"steps":{"after":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"}],"before":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}]}}}
{"action":"flow.amend","outcome":"allowed","resource_type":"flow","detail":{"steps":{"after":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}],"before":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"},{"requirement":"conditional","authenticator":"recovery-code"}]}}}
{"action":"flow.default_set","outcome":"allowed","resource_type":"flow","detail":{"is_default":{"after":true,"before":false}}}
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"default"},"steps":{"before":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}]},"is_default":{"before":false}}}
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"kiosk"},"steps":{"before":[{"requirement":"required","authenticator":"password"}]},"is_default":{"before":false}}}
```
