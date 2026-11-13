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
x-request-id: 01a1d2d8-4043-778a-81c2-27a1eec26780
cache-control: no-store
etag: "4ad8669a45813c05b6cc02749195428264db9afe35182d3a94dc277631286b42"
content-type: application/json; charset=utf-8
content-length: 396
Date: Fri, 13 Nov 2026 02:59:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d2d8-3c08-73a8-8d99-8a7684100fb5","name":"default","is_default":true,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}]}],"total":1,"available":["password","passkey","otp","recovery-code"]}
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
x-request-id: 01a1d2d8-406a-7169-bb03-3a292b138af1
cache-control: no-store
etag: "1043b722af36bd79d9b9efefa9fc82f1c00c82f7fe64780da3cc6b8a8b70dc64"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 02:59:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d2d8-4083-7f7d-a689-ee9a5346c127","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

The name was trimmed. The list is ordered by name, and the new flow is the one that is not the default:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c '.total, (.items[] | {id, name, is_default})'
```

```
2
{"id":"01a1d2d8-3c08-73a8-8d99-8a7684100fb5","name":"default","is_default":true}
{"id":"01a1d2d8-4083-7f7d-a689-ee9a5346c127","name":"staff","is_default":false}
```

One flow, with the `ETag` its replacement waits on. `STAFF` is the id the list showed:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d2d8-40c9-7c1e-8db9-f6c321ba6ff4
cache-control: no-store
etag: "1043b722af36bd79d9b9efefa9fc82f1c00c82f7fe64780da3cc6b8a8b70dc64"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 02:59:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d2d8-4083-7f7d-a689-ee9a5346c127","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
x-request-id: 01a1d2d8-40fc-70f4-849e-fbfd6fa23d7d
cache-control: no-store
etag: "c63110646ba1268200cc1767563c3f72277d66cb06a2b52b704f057fc7a236dc"
content-type: application/json; charset=utf-8
content-length: 201
Date: Fri, 13 Nov 2026 02:59:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d2d8-4083-7f7d-a689-ee9a5346c127","name":"crew","is_default":false,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d2d8-4123-76f5-8536-76fcf0922381"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a flow","instance":"01a1d2d8-413b-7545-b255-e5cde546a8ce"}
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
{"type":"about:blank#flow-name-taken","title":"Conflict","status":409,"detail":"a flow named \"default\" already exists","instance":"01a1d2d8-4155-73a3-a695-e631f6b82fe8"}
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
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d2d8-416e-766b-8a7f-8e6e5b0ce953"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d2d8-4185-723f-b742-d9a92a7aaa3e"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d2d8-41cd-783c-b14b-00abf7e2ca40"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"steps[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d2d8-41e3-767a-bdb7-1ccd32d4604b"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"steps[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d2d8-41f7-7bc1-94d3-4d72b766c4c0"}
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: Too small: expected string to have >=1 characters","errors":[{"path":"name","message":"Too small: expected string to have >=1 characters"}],"instance":"01a1d2d8-420e-77e5-916a-dbffa037f2a6"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name must be at most 64 characters","errors":[{"path":"name","message":"name must be at most 64 characters"}],"instance":"01a1d2d8-422b-7fcb-92d4-a23d948f5e79"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: is_default","errors":[{"path":"is_default","message":"must NOT have additional properties"}],"instance":"01a1d2d8-4241-7dc0-a35c-2a82787aed43"}
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
{"id":"01a1d2d8-3c08-73a8-8d99-8a7684100fb5","name":"default","is_default":true,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; replace its steps instead","instance":"01a1d2d8-42bd-7259-811e-9fe97464bd1c"}
HTTP/1.1 204 No Content
x-request-id: 01a1d2d8-42d6-72d5-8b16-a60fc9ca89c4
cache-control: no-store
Date: Fri, 13 Nov 2026 02:59:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d2d8-4083-7f7d-a689-ee9a5346c127","instance":"01a1d2d8-42ef-7744-8d03-d2d2c3370815"}
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
{"type":"about:blank#flow-limit","title":"Conflict","status":409,"detail":"a tenant holds at most 20 flows","instance":"01a1d2d8-450e-71b1-a1ed-a91279b376a9"}
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
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d2d8-4314-7359-9030-bfcab012b7b3","instance":"01a1d2d8-4544-73cc-876e-d6d0bb7549f7"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d2d8-4314-7359-9030-bfcab012b7b3","instance":"01a1d2d8-4560-77a0-a1aa-c77739c732b0"}
1
```

Each create, replace and delete is an audit row with the name and steps, by value. A create names what it set, a replace only what changed, and a delete what it removed. The newest two creates, the two replaces (the rename of `staff` and the change to the default flow's steps) and the delete:

```bash
for action in flow.create flow.amend flow.delete; do
  curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/audit?action=$action&limit=2" \
    | jq -c '.items | sort_by(.occurred_at) | .[] | {action, outcome, resource_type, detail}'
done
```

```
{"action":"flow.create","outcome":"allowed","resource_type":"flow","detail":{"name":{"after":"bulk-18"},"steps":{"after":[{"requirement":"required","authenticator":"password"}]}}}
{"action":"flow.create","outcome":"allowed","resource_type":"flow","detail":{"name":{"after":"bulk-19"},"steps":{"after":[{"requirement":"required","authenticator":"password"}]}}}
{"action":"flow.amend","outcome":"allowed","resource_type":"flow","detail":{"name":{"after":"crew","before":"staff"},"steps":{"after":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"}],"before":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}]}}}
{"action":"flow.amend","outcome":"allowed","resource_type":"flow","detail":{"steps":{"after":[{"requirement":"required","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"}],"before":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"},{"requirement":"conditional","authenticator":"otp"},{"requirement":"conditional","authenticator":"recovery-code"}]}}}
{"action":"flow.delete","outcome":"allowed","resource_type":"flow","detail":{"name":{"before":"crew"},"steps":{"before":[{"requirement":"alternative","authenticator":"passkey"},{"requirement":"alternative","authenticator":"password"}]}}}
```
