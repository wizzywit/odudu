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
- `DELETE /flows/{id}` removes a flow and answers `204`. It needs the flow's own `ETag` in `If-Match`, and refuses the default flow, so another flow is made the
  default first, and a flow some client names, so those clients are given another flow or none first.

`GET /flow/executions` and `PUT /flow/executions` are the default flow's steps, with an `index` per step, and
are [on their own page](./get-flowexecutions-and-put-flowexecutions.md); a change through either is seen
through the other.

A name is 1 to 64 characters once trimmed, counted in code points, and unique within the tenant: the
`(tenant_id, name)` constraint decides, so a repeat is `409` `flow-name-taken` and nothing is written. A tenant
at 20 flows refuses a 21st with `409` `flow-limit`. The count is taken inside the write's transaction under
the lock every flow write takes, so two creates at 19 flows cannot both pass. The default flow is refused a
delete with `409` `default-flow`, and a flow some client names with `409` `flow-in-use`, whose `detail` counts the
clients and names at most ten by their `client_id`, after the `If-Match` checks. A step list is refused before the database is asked, with the `400` types of
`PUT /flow/executions` (`#flow-empty`, `#flow-no-enabled-step`, `#flow-no-first-challenge`,
`#flow-unknown-authenticator`, `#flow-duplicate-authenticator`), the last two with `errors` naming the step as
`steps[1].authenticator`. The body is strict: `is_default` and a step's `index` are not fields. Every route
answers `404` for a flow of another tenant, and a creation, replacement and deletion each write an audit row.

Every command below sends the administrator's token, and a flow's own `ETag`, the tag a read of that flow answers, is what a change to it waits on. `etag` reads it:

```bash
etag() { curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/flows/$1" | tr -d "\r" | sed -n "s/^etag: //p"; }
type etag | head -1
```

```
etag is a function
```

A new tenant has one flow, the default, which `provisionTenant` made with the four steps every tenant starts with. `GET` lists it, with `total`, the authenticators a step may name in `available`, and an `ETag` that covers the flows:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d441-d55d-756b-a060-a4d9b51ca829
cache-control: no-store
etag: "2d9bbe0c0ae6c31ad1fcbbededbcfe6e374d233c35d1399f97175098d4a3d1a8"
content-type: application/json; charset=utf-8
content-length: 413
Date: Fri, 13 Nov 2026 09:34:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d441-b09f-74ce-9554-dee2142af90d","name":"default","is_default":true,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}],"client_count":0}],"total":1,"available":["password","passkey","otp","recovery-code"]}
```

`POST` makes a flow from a name and a list of steps, answers `201` with the flow and its own `ETag`, and never makes a default one:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "  staff  ", "steps": [{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "conditional"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
HTTP/1.1 201 Created
x-request-id: 01a1d441-d57e-753e-a233-061d5523c2d0
cache-control: no-store
etag: "0d0cd2c30b78c21adab3328564cdf2cc30d549469333d94df3eaee417b726a0e"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 09:34:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d441-d58f-7335-957c-52f6d12eb9ba","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

The name was trimmed. The list is ordered by name, and the new flow is the one that is not the default. `STAFF` keeps its id for the commands below:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".total, (.items[] | {id, name, is_default})"
STAFF=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -r ".items[] | select(.name == \"staff\") | .id")
echo "STAFF=$STAFF"
```

```
2
{"id":"01a1d441-b09f-74ce-9554-dee2142af90d","name":"default","is_default":true}
{"id":"01a1d441-d58f-7335-957c-52f6d12eb9ba","name":"staff","is_default":false}
STAFF=01a1d441-d58f-7335-957c-52f6d12eb9ba
```

One flow, with the `ETag` its replacement waits on:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d441-d5ff-7cb0-9cbd-405e25c09760
cache-control: no-store
etag: "0d0cd2c30b78c21adab3328564cdf2cc30d549469333d94df3eaee417b726a0e"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 09:34:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d441-d58f-7335-957c-52f6d12eb9ba","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

`PUT` replaces the name and the steps together, on that tag. The id and `is_default` stay:

```bash
ETAG=$(etag $STAFF)
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" \
  -d '{"name": "crew", "steps": [{"authenticator": "passkey", "requirement": "alternative"}, {"authenticator": "password", "requirement": "alternative"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d441-d660-7ba9-8e01-2017b05dfcee
cache-control: no-store
etag: "997c10f527c5f7989d0ad4703b180dfae3f881d80083dfdaaccb32dfb81e5473"
content-type: application/json; charset=utf-8
content-length: 201
Date: Fri, 13 Nov 2026 09:34:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d441-d58f-7335-957c-52f6d12eb9ba","name":"crew","is_default":false,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"}]}
```

The same, now stale, header changes nothing, and a request with no `If-Match`, or `*`, is refused before anything is read:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" \
  -d '{"name": "crew", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$STAFF
echo
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "crew", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d441-d685-749b-a575-65642d37c6b2"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a flow","instance":"01a1d441-d6a1-77dd-8444-ea7c19a5fc52"}
```

A name another flow holds is refused with `409`, whether it is made or renamed to; the default's name is `default`. The constraint on `(tenant_id, name)` decides it, and nothing is written:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "default", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
{"type":"about:blank#flow-name-taken","title":"Conflict","status":409,"detail":"a flow named \"default\" already exists","instance":"01a1d441-d6d8-7844-8d90-be5e69296b68"}
```

A step list is refused at save time, before the database is asked, with the types `PUT /flow/executions` has. The unknown and the repeated authenticator name the step at fault in `errors`, under `steps`; the others carry none:

```bash
for steps in '[]' '[{"authenticator": "password", "requirement": "disabled"}]' '[{"authenticator": "passkey", "requirement": "required"}]' '[{"authenticator": "sms", "requirement": "required"}]' '[{"authenticator": "password", "requirement": "required"}, {"authenticator": "password", "requirement": "alternative"}]'; do
  curl -sS -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"bad\", \"steps\": $steps}" \
    http://localhost:3000/admin/tenants/demo/flows
  echo
done
```

```
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d441-d709-7bc9-af9b-ccd8f48120a7"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d441-d720-71d9-9046-8324e1378805"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d441-d736-7e72-bb26-7fa528806446"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"steps[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d441-d74a-7dae-b4c9-401080452e30"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"steps[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d441-d75f-7248-be23-292f5eb39f01"}
```

A name that is blank, or more than 64 characters, and a field the body does not have, are `400` with the path of the field. `is_default` is not a field of a create or a replacement: which flow is the default is changed by its own route, below:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "   ", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
echo
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\": \"$(printf "x%.0s" $(seq 1 65))\", \"steps\": [{\"authenticator\": \"password\", \"requirement\": \"required\"}]}" \
  http://localhost:3000/admin/tenants/demo/flows
echo
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "x", "is_default": true, "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: Too small: expected string to have >=1 characters","errors":[{"path":"name","message":"Too small: expected string to have >=1 characters"}],"instance":"01a1d441-d777-74d3-bc4b-4a3cb66295e9"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name must be at most 64 characters","errors":[{"path":"name","message":"name must be at most 64 characters"}],"instance":"01a1d441-d78f-7e55-9207-c635ac12e1ab"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: is_default","errors":[{"path":"is_default","message":"must NOT have additional properties"}],"instance":"01a1d441-d7a4-7be8-bf66-2301a5f13adb"}
```

The default flow can be renamed and its steps replaced here, and it stays the default. `GET /flow/executions` is that same flow's steps with an `index`, so a change through either is seen through the other. `DEFAULT` keeps the default flow's id:

```bash
DEFAULT=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -r ".items[] | select(.is_default) | .id")
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $(etag $DEFAULT)" \
  -d '{"name": "default", "steps": [{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "conditional"}]}' \
  http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flow/executions
```

```
{"id":"01a1d441-b09f-74ce-9554-dee2142af90d","name":"default","is_default":true,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional"}],"available":["password","passkey","otp","recovery-code"]}
```

A delete waits on the flow's tag too, so a flow another administrator has changed since it was read is not deleted unseen: no `If-Match` is `428`, and a tag from before a change is `412`. The default flow is never deleted while it is the default; any other flow is, and a second delete finds nothing:

```bash
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $ETAG" http://localhost:3000/admin/tenants/demo/flows/$STAFF
echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $DEFAULT)" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
echo
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $STAFF)" http://localhost:3000/admin/tenants/demo/flows/$STAFF
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: \"gone\"" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to delete a flow","instance":"01a1d441-d816-7b54-a2c8-10900900e86f"}
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d441-d82c-743f-8454-a0150211657a"}
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d441-d855-7713-a483-ff2bf4359b2e"}
HTTP/1.1 204 No Content
x-request-id: 01a1d441-d87e-7df8-b4c6-63ccfc3b924d
cache-control: no-store
Date: Fri, 13 Nov 2026 09:34:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d441-d58f-7335-957c-52f6d12eb9ba","instance":"01a1d441-d897-7130-bf9a-4f861ae3805a"}
```

The default flow is not deleted while it is the default, but another flow can be made the default, which is what a client that names no flow runs. `POST .../make-default` moves it in one transaction: the flow that was the default stops being it, and `flow/executions` now reads and writes the new default's steps. It needs the flow's own `ETag` in `If-Match`, as `PUT` does. `PARTNERS` keeps the id of a new flow:

```bash
PARTNERS=$(curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name": "partners", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows | jq -r .id)
echo "PARTNERS=$PARTNERS"
```

```
PARTNERS=01a1d441-d8ba-777c-ba8d-ef647614f2f8
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".items[] | {name, is_default}"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d441-d8de-7a53-ae92-1c515af9edd8
cache-control: no-store
etag: "06c22168a0be4aee423d9d603aeb4c928ab2ce9c912aa6b7627ed9df1aaa9d30"
content-type: application/json; charset=utf-8
content-length: 145
Date: Fri, 13 Nov 2026 09:34:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d441-d8ba-777c-ba8d-ef647614f2f8","name":"partners","is_default":true,"steps":[{"authenticator":"password","requirement":"required"}]}
{"name":"default","is_default":false}
{"name":"partners","is_default":true}
{"items":[{"index":0,"authenticator":"password","requirement":"required"}],"available":["password","passkey","otp","recovery-code"]}
```

Asking again for the flow that is already the default changes nothing and writes no audit row. A stale tag is `412` and none is `428`, whatever the flow is, and a flow of another tenant is `404`:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: \"stale\"" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/other/flows/$PARTNERS/make-default
```

```
200
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d441-d94f-7e7b-8ca5-0b4b155a1c79"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to make a flow the default","instance":"01a1d441-d963-7ee4-8251-41998872d762"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d441-d8ba-777c-ba8d-ef647614f2f8","instance":"01a1d441-d991-78fc-ac42-f19778c54c96"}
```

The flow that was the default is an ordinary flow now, and the new default is the one that is refused a delete:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $DEFAULT)" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS
```

```
204
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d441-d9ee-7195-8b06-68122a7b1271"}
```

A client names a flow through its `flow_id`, on a create or a `PATCH`; null, which every client has until it is set, follows the default. First a flow of its own, and a client that names it:

```bash
KIOSK=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name": "kiosk", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows | jq -r .id)
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d "{\"client_id\": \"lobby\", \"redirect_uris\": [\"https://lobby.example/callback\"], \"grant_types\": [\"authorization_code\"], \"flow_id\": \"$KIOSK\"}" \
  http://localhost:3000/admin/tenants/demo/clients | jq -c '{client_id, flow_id}'
LOBBY=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" 'http://localhost:3000/admin/tenants/demo/clients?client_id_exact=lobby' | jq -r '.items[0].id')
```

```
{"client_id":"lobby","flow_id":"01a1d441-da15-7f61-bfde-c33ea8ad0af8"}
```

A flow that is not the tenant's, another tenant's included, is refused with `400` and the code `unknown_flow` in `errors`, and nothing is written:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"flow_id": "01a1d341-0000-7000-8000-000000000000"}' \
  http://localhost:3000/admin/tenants/demo/clients/$LOBBY
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"flow_id: flow_id names no flow of this tenant","errors":[{"path":"flow_id","message":"flow_id names no flow of this tenant","code":"unknown_flow"}],"instance":"01a1d441-da97-768a-b1d1-1be69745b0d9"}
```

The list now says which flow the client names. The flow cannot be deleted while it does, and the refusal says how many clients and which, once the `If-Match` checks have passed. When the client names none, it can:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.items[] | {name, client_count}'
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $KIOSK)" http://localhost:3000/admin/tenants/demo/flows/$KIOSK
echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"flow_id": null}' http://localhost:3000/admin/tenants/demo/clients/$LOBBY | jq -c '{client_id, flow_id}'
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $KIOSK)" http://localhost:3000/admin/tenants/demo/flows/$KIOSK
```

```
{"name":"kiosk","client_count":1}
{"name":"partners","client_count":0}
{"type":"about:blank#flow-in-use","title":"Conflict","status":409,"detail":"the flow is named by 1 client: lobby; set that client’s flow_id to another flow or null first","instance":"01a1d441-daf9-7e42-92b2-ee5477823e0d"}
{"client_id":"lobby","flow_id":null}
204
```

A tenant holds at most 20. Nineteen more make 20 with the default, and the next is refused with `409` and the cap in its `detail`:

```bash
for n in $(seq 1 19); do
  curl -sS -o /dev/null -w "%{http_code} " -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"bulk-$n\", \"steps\": [{\"authenticator\": \"password\", \"requirement\": \"required\"}]}" \
    http://localhost:3000/admin/tenants/demo/flows
done; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".total"
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "one-too-many", "steps": [{"authenticator": "password", "requirement": "required"}]}' \
  http://localhost:3000/admin/tenants/demo/flows
```

```
201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201 201
20
{"type":"about:blank#flow-limit","title":"Conflict","status":409,"detail":"a tenant holds at most 20 flows","instance":"01a1d441-de03-7e14-b453-13a156205aa2"}
```

A flow belongs to its tenant. The same token, asking another tenant for it, finds nothing, on every route that takes an id. `BULK` is the id of one of the flows just made:

```bash
BULK=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -r ".items[] | select(.name == \"bulk-1\") | .id")
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/other/flows/$BULK
echo
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $BULK)" http://localhost:3000/admin/tenants/other/flows/$BULK
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/other/flows | jq -c ".total"
```

```
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d441-dbbf-72ca-8dce-a54d71c085b2","instance":"01a1d441-de3c-7d77-a4b2-12dd97a615b6"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d441-dbbf-72ca-8dce-a54d71c085b2","instance":"01a1d441-de68-7a14-adb1-f645bc1df6f3"}
1
```

Each create, replace, promotion and delete is an audit row with the name and steps, by value. A create names what it set, a replace only what changed, and a delete what it removed. The newest two creates, the two replaces (the rename of `staff` and the change to the default flow's steps), the promotion and the deletes:

```bash
for action in flow.create flow.amend flow.default_set flow.delete; do
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/audit?action=$action&limit=2" \
    | jq -c ".items | sort_by(.occurred_at) | .[] | {action, outcome, resource_type, detail}"
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
