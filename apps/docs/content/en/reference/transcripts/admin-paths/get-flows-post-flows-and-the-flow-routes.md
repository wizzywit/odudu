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
x-request-id: 01a1d378-3bab-799a-a510-9c1770fafeaa
cache-control: no-store
etag: "422f3cc5b5b69e1c15109eb86a427f368967038274e1dda5e7114edc49cec783"
content-type: application/json; charset=utf-8
content-length: 396
Date: Fri, 13 Nov 2026 05:53:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d378-3863-7cad-bcf3-e903416a2753","name":"default","is_default":true,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}]}],"total":1,"available":["password","passkey","otp","recovery-code"]}
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
x-request-id: 01a1d378-3bdf-7b4b-8def-4c872e63b00e
cache-control: no-store
etag: "946a33eedebd7031c931aec7255392b37aefd2a6b77097fbbcee7de5db445db9"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 05:53:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d378-3bf5-714c-98c8-1c4d643986a7","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

The name was trimmed. The list is ordered by name, and the new flow is the one that is not the default. `STAFF` keeps its id for the commands below:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".total, (.items[] | {id, name, is_default})"
STAFF=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -r ".items[] | select(.name == \"staff\") | .id")
echo "STAFF=$STAFF"
```

```
2
{"id":"01a1d378-3863-7cad-bcf3-e903416a2753","name":"default","is_default":true}
{"id":"01a1d378-3bf5-714c-98c8-1c4d643986a7","name":"staff","is_default":false}
STAFF=01a1d378-3bf5-714c-98c8-1c4d643986a7
```

One flow, with the `ETag` its replacement waits on:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d378-3c94-722e-9555-0ffb0fd52078
cache-control: no-store
etag: "946a33eedebd7031c931aec7255392b37aefd2a6b77097fbbcee7de5db445db9"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 05:53:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d378-3bf5-714c-98c8-1c4d643986a7","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
x-request-id: 01a1d378-3cdb-7388-bc79-cdf3f07d48f0
cache-control: no-store
etag: "eb88c8a87db662f868e7d6afc6b117d8386815066b424360bc791327becb9092"
content-type: application/json; charset=utf-8
content-length: 201
Date: Fri, 13 Nov 2026 05:53:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d378-3bf5-714c-98c8-1c4d643986a7","name":"crew","is_default":false,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d378-3d09-7baf-ab62-1d05b149e8af"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a flow","instance":"01a1d378-3d23-750b-9bd7-4fa66afe7224"}
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
{"type":"about:blank#flow-name-taken","title":"Conflict","status":409,"detail":"a flow named \"default\" already exists","instance":"01a1d378-3d48-7e2d-81fe-92a839b8a985"}
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
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d378-3d8a-7b23-9f42-23739bd2a107"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d378-3da5-7880-8dfb-c84df467de9d"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d378-3dd0-744f-88e8-bacabc1a3ddd"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"steps[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d378-3def-76db-be20-fc439905a62d"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"steps[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d378-3e0d-79d2-ac60-9434c4aabc8e"}
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: Too small: expected string to have >=1 characters","errors":[{"path":"name","message":"Too small: expected string to have >=1 characters"}],"instance":"01a1d378-3e2e-75d1-a8fc-233a9f72cdb4"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name must be at most 64 characters","errors":[{"path":"name","message":"name must be at most 64 characters"}],"instance":"01a1d378-3e5a-7094-948c-133ed7dd5458"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: is_default","errors":[{"path":"is_default","message":"must NOT have additional properties"}],"instance":"01a1d378-3e7b-79a1-98f6-377edfee8672"}
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
{"id":"01a1d378-3863-7cad-bcf3-e903416a2753","name":"default","is_default":true,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to delete a flow","instance":"01a1d378-3f29-7cd4-afbb-63e08d9364da"}
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d378-3f5a-7fa5-955c-81f6faf6e221"}
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d378-3f96-73d6-a9f2-882cab212be6"}
HTTP/1.1 204 No Content
x-request-id: 01a1d378-3fcb-741f-97f4-5c175e28d825
cache-control: no-store
Date: Fri, 13 Nov 2026 05:53:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d378-3bf5-714c-98c8-1c4d643986a7","instance":"01a1d378-3ff3-71c6-ae33-33f3b51607d8"}
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
PARTNERS=01a1d378-401b-7e71-b9da-154f7699f7fb
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".items[] | {name, is_default}"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d378-4048-7d36-812f-aaba9f3e8ae4
cache-control: no-store
etag: "8e83e1550544f217511c2d9603a01da6ef2c6ba055079dbba6180a359008d28c"
content-type: application/json; charset=utf-8
content-length: 145
Date: Fri, 13 Nov 2026 05:53:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d378-401b-7e71-b9da-154f7699f7fb","name":"partners","is_default":true,"steps":[{"authenticator":"password","requirement":"required"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d378-4119-727e-acb8-cbac004ee39f"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to make a flow the default","instance":"01a1d378-4136-7645-adbe-edfbfb9a844b"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d378-401b-7e71-b9da-154f7699f7fb","instance":"01a1d378-4164-71da-9851-0dcae616d92e"}
```

The flow that was the default is an ordinary flow now, and the new default is the one that is refused a delete:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $DEFAULT)" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS
```

```
204
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d378-41d9-7a4a-aa18-a8d2090ba5a0"}
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
```

A flow that is not the tenant's, another tenant's included, is refused with `400` and the code `unknown_flow` in `errors`, and nothing is written:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"flow_id": "01a1d341-0000-7000-8000-000000000000"}' \
  http://localhost:3000/admin/tenants/demo/clients/$LOBBY
```

```
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
{"type":"about:blank#flow-limit","title":"Conflict","status":409,"detail":"a tenant holds at most 20 flows","instance":"01a1d378-4427-779e-a5c4-36fc3c23198c"}
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
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d378-4201-7272-b347-ff4a2c0a95af","instance":"01a1d378-4459-7966-8698-f80917ce218b"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d378-4201-7272-b347-ff4a2c0a95af","instance":"01a1d378-4483-77e8-9e3b-6262027ced2e"}
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
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"crew"},"steps":{"before":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"}]},"is_default":{"before":false}}}
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"default"},"steps":{"before":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}]},"is_default":{"before":false}}}
```
