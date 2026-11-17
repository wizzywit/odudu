---
title: 'Flows: list, create, read, replace, make default, delete'
description: 'All six require manage-tenant. They list, make, read, replace, promote and delete the tenant’s sign-in flows, at most 20, one of which is the default.'
---

# Flows: list, create, read, replace, make default, delete

This page covers `GET /flows`, `POST /flows`, `GET /flows/:id`, `PUT /flows/:id`, `POST /flows/:id/make-default` and `DELETE /flows/:id`.

All six require `manage-tenant`. A tenant holds up to 20 named sign-in flows. Exactly one is the **default**,
the flow a sign-in runs when a client names none. A client names another through its `flow_id`
([`PATCH /clients/{id}`](./patch-clientsid.md)), and a flow some client names is not deleted. A flow is an ordered list of at most 20 steps, each an `authenticator`,
a `requirement` and, for `otp`, `passkey` and `recovery-code`, optional `settings`, and a flow's meaning is in its order, so it is always written whole.

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
`#flow-unknown-authenticator`, `#flow-duplicate-authenticator`, `#flow-step-settings`), the last three with `errors` naming the step as
`steps[1].authenticator`, or `steps[1].settings` for the last. The body is strict: `is_default` and a step's `index` are not fields. Every route
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
x-request-id: 01a1d506-cbd7-7e11-92ff-7497048a199a
cache-control: no-store
etag: "51bd325f6f00d16b198bd6395416421caae698eb8871b62f9b512fd669ae7314"
content-type: application/json; charset=utf-8
content-length: 413
Date: Fri, 13 Nov 2026 13:09:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d506-c8d3-7fc0-aee8-fa1d16bdc160","name":"default","is_default":true,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}],"client_count":0}],"total":1,"available":["password","passkey","otp","recovery-code"]}
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
x-request-id: 01a1d506-cbe9-74ca-a81b-8f991fe561df
cache-control: no-store
etag: "052e5f755c6dd8cb0d5101df1d762ce856cd364f651f7237f37e61e08c09a988"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 13:09:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d506-cbf4-781b-9338-d8e7b6671b67","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
```

The name was trimmed. The list is ordered by name, and the new flow is the one that is not the default. `STAFF` keeps its id for the commands below:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".total, (.items[] | {id, name, is_default})"
STAFF=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -r ".items[] | select(.name == \"staff\") | .id")
echo "STAFF=$STAFF"
```

```
2
{"id":"01a1d506-c8d3-7fc0-aee8-fa1d16bdc160","name":"default","is_default":true}
{"id":"01a1d506-cbf4-781b-9338-d8e7b6671b67","name":"staff","is_default":false}
STAFF=01a1d506-cbf4-781b-9338-d8e7b6671b67
```

One flow, with the `ETag` its replacement waits on:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STAFF
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d506-cc28-79e9-a2e7-a3c986e1f01a
cache-control: no-store
etag: "052e5f755c6dd8cb0d5101df1d762ce856cd364f651f7237f37e61e08c09a988"
content-type: application/json; charset=utf-8
content-length: 195
Date: Fri, 13 Nov 2026 13:09:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d506-cbf4-781b-9338-d8e7b6671b67","name":"staff","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
x-request-id: 01a1d506-cc51-724b-9539-f26083ed5583
cache-control: no-store
etag: "844b2b2ae25876a40e5b90e096d2aa4596f95ce55139ecaf5ab4fb61843c1c52"
content-type: application/json; charset=utf-8
content-length: 201
Date: Fri, 13 Nov 2026 13:09:14 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d506-cbf4-781b-9338-d8e7b6671b67","name":"crew","is_default":false,"steps":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d506-cc68-7436-bd2e-92036c2d2054"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a flow","instance":"01a1d506-cc7c-7fa3-aa5c-ef4b0630d7ed"}
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
{"type":"about:blank#flow-name-taken","title":"Conflict","status":409,"detail":"a flow named \"default\" already exists","instance":"01a1d506-cc8f-7a70-ad0e-86db93ccae20"}
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
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d506-cca1-7e04-bb8a-fcc286b455a3"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d506-ccb0-7629-86f4-bc39ba41c7e6"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d506-ccc2-7b39-88f8-5d3aca607179"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"steps[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d506-ccd5-7f0d-bfe2-d1381f8405d4"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"steps[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d506-cce7-78e2-82b1-55fdef55b32e"}
```

A step of `otp`, `passkey` or `recovery-code` may carry `settings`, which override the tenant's authenticator settings for that step: `otp` takes `algorithm`, `digits` and `period`, `passkey` takes `user_verification` and `resident_key`, and `recovery-code` takes `count`, each held to the choices and range of the tenant setting of the same meaning. A key left out takes the tenant's value, and a person who enrols during a sign-in on the flow is enrolled under the result; an enrolment made before keeps the values it was made with. The settings are part of the flow, so they are in its `ETag`, in the list, and in the `flow.create` and `flow.amend` audit rows. A step whose authenticator reads none of the keys it carries, and any `settings` on `password`, is refused with `400` `flow-step-settings`, whose `errors` name the step as `steps[1].settings`; a value outside the choices is a schema refusal naming the key. `strict` is made with settings, refused once with a key its authenticator does not read, and deleted again so the flows below are as they were:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "strict", "steps": [{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "required", "settings": {"algorithm": "SHA256", "digits": 8}}, {"authenticator": "recovery-code", "requirement": "conditional", "settings": {"count": 12}}]}' \
  http://localhost:3000/admin/tenants/demo/flows
echo
for steps in '[{"authenticator": "password", "requirement": "required", "settings": {"digits": 8}}]' '[{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "required", "settings": {"count": 9}}]' '[{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "required", "settings": {"digits": 7}}]'; do
  curl -sS -X POST \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"bad\", \"steps\": $steps}" \
    http://localhost:3000/admin/tenants/demo/flows
  echo
done
```

```
{"id":"01a1d506-cd03-74f1-90d6-4d8c9737e11a","name":"strict","is_default":false,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"required","settings":{"algorithm":"SHA256","digits":8}},{"authenticator":"recovery-code","requirement":"conditional","settings":{"count":12}}]}
{"type":"about:blank#flow-step-settings","title":"Bad Request","status":400,"detail":"step \"password\" carries settings it does not read","errors":[{"path":"steps[0].settings","message":"this authenticator reads no settings"}],"instance":"01a1d506-cd0e-715d-91df-b28e6cd8b12f"}
{"type":"about:blank#flow-step-settings","title":"Bad Request","status":400,"detail":"step \"otp\" carries settings it does not read","errors":[{"path":"steps[1].settings","message":"this authenticator reads algorithm, digits, period, not count"}],"instance":"01a1d506-cd21-79b2-a0f7-e3ee35ed8924"}
{"type":"about:blank","title":"Error","status":400,"detail":"body/steps/1/settings/digits must be equal to one of the allowed values","errors":[{"path":"steps[1].settings.digits","message":"must be equal to one of the allowed values"}],"instance":"01a1d506-cd34-7fc2-93f1-724d5cec76f3"}
```

The flow keeps the settings it was made with, in its own read, and is deleted on the tag that read answers:

```bash
STRICT=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -r ".items[] | select(.name == \"strict\") | .id")
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows/$STRICT | jq -c ".steps"
curl -sS -o /dev/null -w '%{http_code}\n' -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $STRICT)" http://localhost:3000/admin/tenants/demo/flows/$STRICT
```

```
[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"required","settings":{"algorithm":"SHA256","digits":8}},{"authenticator":"recovery-code","requirement":"conditional","settings":{"count":12}}]
204
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: Too small: expected string to have >=1 characters","errors":[{"path":"name","message":"Too small: expected string to have >=1 characters"}],"instance":"01a1d506-cd9f-7300-a01d-136d37315271"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"name: name must be at most 64 characters","errors":[{"path":"name","message":"name must be at most 64 characters"}],"instance":"01a1d506-cdb5-7d4a-bb78-a80c91f2c4a4"}
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties: is_default","errors":[{"path":"is_default","message":"must NOT have additional properties"}],"instance":"01a1d506-cdcc-7ead-96d8-f6ee2198a961"}
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
{"id":"01a1d506-c8d3-7fc0-aee8-fa1d16bdc160","name":"default","is_default":true,"steps":[{"authenticator":"password","requirement":"required"},{"authenticator":"otp","requirement":"conditional"}]}
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
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to delete a flow","instance":"01a1d506-ce32-7a3d-b02e-927cc36786ed"}
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d506-ce46-71f8-a41c-54abfa104e55"}
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d506-ce6f-7392-a158-9a91f4101412"}
HTTP/1.1 204 No Content
x-request-id: 01a1d506-ce97-7509-946f-8a6c7cea4c0a
cache-control: no-store
Date: Fri, 13 Nov 2026 13:09:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d506-cbf4-781b-9338-d8e7b6671b67","instance":"01a1d506-ceae-7681-a545-55c4771832ec"}
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
PARTNERS=01a1d506-cecd-732d-9d43-1e43d2915f0b
```

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS/make-default
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flows | jq -c ".items[] | {name, is_default}"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d506-cef4-7ab9-aca4-e6f6b286cd49
cache-control: no-store
etag: "49e0aef580c09af1c24c366baff910c297fc27feb4c887c72642ce5b8dbcf679"
content-type: application/json; charset=utf-8
content-length: 145
Date: Fri, 13 Nov 2026 13:09:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d506-cecd-732d-9d43-1e43d2915f0b","name":"partners","is_default":true,"steps":[{"authenticator":"password","requirement":"required"}]}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d506-cf68-7d2e-901c-a006f775328f"}
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to make a flow the default","instance":"01a1d506-cf7d-7cab-89f2-d639deb126cb"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d506-cecd-732d-9d43-1e43d2915f0b","instance":"01a1d506-cfa7-799c-a3e3-d8afc28f12c6"}
```

The flow that was the default is an ordinary flow now, and the new default is the one that is refused a delete:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $DEFAULT)" http://localhost:3000/admin/tenants/demo/flows/$DEFAULT
curl -sS -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" -H "If-Match: $(etag $PARTNERS)" http://localhost:3000/admin/tenants/demo/flows/$PARTNERS
```

```
204
{"type":"about:blank#default-flow","title":"Conflict","status":409,"detail":"the default flow is not deleted; make another flow the default first","instance":"01a1d506-cff5-7a60-9fdc-4e5edef39c91"}
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
{"client_id":"lobby","flow_id":"01a1d506-d010-7fbb-9b74-f5bed0740f30"}
```

A flow that is not the tenant's, another tenant's included, is refused with `400` and the code `unknown_flow` in `errors`, and nothing is written:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"flow_id": "01a1d341-0000-7000-8000-000000000000"}' \
  http://localhost:3000/admin/tenants/demo/clients/$LOBBY
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"flow_id: flow_id names no flow of this tenant","errors":[{"path":"flow_id","message":"flow_id names no flow of this tenant","code":"unknown_flow"}],"instance":"01a1d506-d074-7c96-8642-04b830fe614d"}
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
{"type":"about:blank#flow-in-use","title":"Conflict","status":409,"detail":"the flow is named by 1 client: lobby; set that client’s flow_id to another flow or null first","instance":"01a1d506-d0ac-7024-a03b-b4e6df0f424d"}
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
{"type":"about:blank#flow-limit","title":"Conflict","status":409,"detail":"a tenant holds at most 20 flows","instance":"01a1d506-d283-70a5-8d02-2c785bece0f0"}
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
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d506-d10c-7d00-8fb7-6f905ebcdc2f","instance":"01a1d506-d2aa-7758-8d41-fc5d4805e6e1"}
{"type":"about:blank","title":"Not Found","status":404,"detail":"no flow 01a1d506-d10c-7d00-8fb7-6f905ebcdc2f","instance":"01a1d506-d2d0-7d9e-96ad-af985735f196"}
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
