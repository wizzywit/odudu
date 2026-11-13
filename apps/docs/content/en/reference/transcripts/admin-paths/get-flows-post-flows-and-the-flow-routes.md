---
title: 'Flows: list, create, read, replace, make default, delete'
description: 'All six require manage-tenant. They list, make, read, replace, promote and delete the tenant’s sign-in flows, at most 20, one of which is the default.'
---

# Flows: list, create, read, replace, make default, delete

This page covers `GET /flows`, `POST /flows`, `GET /flows/:id`, `PUT /flows/:id`, `POST /flows/:id/make-default` and `DELETE /flows/:id`.

All six require `manage-tenant`. A tenant holds up to 20 named sign-in flows. Exactly one is the **default**,
the flow a sign-in runs when nothing names another, and no client can name another yet, so a flow that is not
the default is not run by any sign-in until it is made the default. A flow is an ordered list of at most 20 steps, each an `authenticator`
and a `requirement`, and a flow's meaning is in its order, so it is always written whole.

- `GET /flows` lists every flow of the tenant, ordered by name, with `total` and `available`. A tenant holds
  at most 20 flows, so the list is never paged: `total` is all of them. Its `ETag` covers the flows.
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
  default first.

`GET /flow/executions` and `PUT /flow/executions` are the default flow's steps, with an `index` per step, and
are [on their own page](./get-flowexecutions-and-put-flowexecutions.md); a change through either is seen
through the other.

A name is 1 to 64 characters once trimmed, counted in code points, and unique within the tenant: the
`(tenant_id, name)` constraint decides, so a repeat is `409` `flow-name-taken` and nothing is written. A tenant
at 20 flows refuses a 21st with `409` `flow-limit`. The count is taken inside the write's transaction under
the lock every flow write takes, so two creates at 19 flows cannot both pass. The default flow is refused a
delete with `409` `default-flow`. A step list is refused before the database is asked, with the `400` types of
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
x-request-id: 01a1d341-2184-728a-ad87-0c0aca918c04
cache-control: no-store
etag: "78a53b71096cb65bd6abda6e189f782c6896644d68aaa8226b96710d3b6ade96"
content-type: application/json; charset=utf-8
content-length: 396
Date: Fri, 13 Nov 2026 04:53:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d341-1edb-7918-a618-c60759d50086","name":"default","is_default":true,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}]}],"total":1,"available":["password","passkey","otp","recovery-code"]}
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
x-request-id: 01a1d341-219f-7d78-892e-0085e3705aa3
cache-control: no-store
etag: "de54d8e07a628ca0af095c264a6ec20eb175881504575af8f4f0b55eb0a807bc"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 04:53:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d341-21af-7376-9b77-f62fb986e5bc","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

The name was trimmed. The list is ordered by name, and the new flow is the one that is not the default:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.total, (.items[] | {id, name, is_default})'
```

```
2
{"id":"01a1d341-1edb-7918-a618-c60759d50086","name":"default","is_default":true}
{"id":"01a1d341-21af-7376-9b77-f62fb986e5bc","name":"staff","is_default":false}
```

One flow, with the `ETag` its replacement waits on. `STAFF` is the id the list showed:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d341-21e6-7c63-b33e-6252039fc50e
cache-control: no-store
etag: "de54d8e07a628ca0af095c264a6ec20eb175881504575af8f4f0b55eb0a807bc"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 04:53:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d341-21af-7376-9b77-f62fb986e5bc","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
x-request-id: 01a1d341-221c-78de-bc14-c938e8dcb54b
cache-control: no-store
etag: "d133ca4690a9e2bc45aeecad3fc3cf4149ffd4ae6e789b9d9e094d55358597a4"
content-type: application/json; charset=utf-8
content-length: 201
Date: Fri, 13 Nov 2026 04:53:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d341-21af-7376-9b77-f62fb986e5bc","name":"crew","is_default":false,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d341-2235-7bdc-963e-e2d4c2baef24"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a flow","instance":"01a1d341-224b-7131-ae3e-58e151be0253"}
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
{"type":"about:blank#flow-name-taken","title":"Conflict","status":409,"detail":"a flow named \"default\" already exists","instance":"01a1d341-2260-74a8-a05b-31d704c9f93a"}
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
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d341-2276-7bd5-96fd-364ad95f61fc"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d341-228b-726a-a781-9aaa0140dc7b"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d341-229e-766a-9827-fbd7182d17ac"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"steps[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d341-22b2-736d-8b57-ad3049b0756b"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"steps[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d341-22c4-7694-999e-ade0d8e42801"}
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: Too small: expected string to have >=1 characters","errors":[{"path":"name","message":"Too small: expected string to have >=1 characters"}],"instance":"01a1d341-22d8-7e27-b95e-1f015ff14c99"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name must be at most 64 characters","errors":[{"path":"name","message":"name must be at most 64 characters"}],"instance":"01a1d341-22ec-7d8d-a483-e2d3a2a87529"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: is_default","errors":[{"path":"is_default","message":"must NOT have additional properties"}],"instance":"01a1d341-22fe-7636-9ddf-e33c70eac021"}
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
{"id":"01a1d341-1edb-7918-a618-c60759d50086","name":"default","is_default":true,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d341-2362-7de9-a75a-3a8e673b8522"}
HTTP/1.1 204 No Content
x-request-id: 01a1d341-2386-7ee9-850b-0a8a6272d580
cache-control: no-store
Date: Fri, 13 Nov 2026 04:53:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d341-21af-7376-9b77-f62fb986e5bc","instance":"01a1d341-23a3-7e71-8940-a905b1938df8"}
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
x-request-id: 01a1d341-2424-71cd-a6e0-1fdf9d2dcad8
cache-control: no-store
etag: "7808fb4c7bc31daa40e02613de5401e61283c972d629e8c9e18328914a782f0b"
content-type: application/json; charset=utf-8
content-length: 145
Date: Fri, 13 Nov 2026 04:53:44 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d341-23de-7a8c-8314-55d6ce58211e","name":"partners","is_default":true,"steps":[{"authenticator":"password","requirement":"required"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d341-2491-774e-ac25-197772516609"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to make a flow the default","instance":"01a1d341-24a4-7865-a169-6f33626e7f14"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d341-23de-7a8c-8314-55d6ce58211e","instance":"01a1d341-24c4-71e6-a00b-ac287a6c3337"}
```

The flow that was the default is an ordinary flow now, and the new default is the one that is refused a delete:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS
```

```
204
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d341-24f4-7913-8a44-3fac3589e6fb"}
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
{"type":"about:blank#flow-limit","title":"Conflict","status":409,"detail":"a tenant holds at most 20 flows","instance":"01a1d341-26d5-717f-ab8f-079829ee3450"}
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
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d341-251b-7bb8-bec7-3a002c7be2bb","instance":"01a1d341-26fb-7dee-b64f-d9e83f1953fa"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d341-251b-7bb8-bec7-3a002c7be2bb","instance":"01a1d341-270c-7c0f-a709-03525101cc8a"}
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
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"crew"},"steps":{"before":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"}]},"is_default":{"before":false}}}
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"default"},"steps":{"before":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}]},"is_default":{"before":false}}}
```
