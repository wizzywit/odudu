---
title: 'GET /flow/executions and PUT /flow/executions'
description: "Both require manage-tenant. GET reads the tenant's whole authentication flow — the ordered list authn-flows's executor dispatches against — as…"
---

# `GET /flow/executions` and `PUT /flow/executions`

Both require `manage-tenant`. `GET` reads the tenant's whole authentication
flow — the ordered list `authn-flows`'s executor dispatches against — as
`index`, `authenticator` and `requirement` per step.

`PUT` replaces the list wholesale; there is no partial edit, because a
flow's meaning is in its order and a flow is short. The request carries no
`index`: the array's own order is the order, and the server renumbers
`index` contiguously from it regardless of what a caller sent, so there is
no gap or duplicate to hand-manage. It refuses with `400`, each naming the
reason in `detail`: an empty list, since a tenant with no flow cannot be
logged into; a list where every step is `disabled`, the same reason; an
`authenticator` name the executor's own registry does not resolve, which
lists the known names; and the same `authenticator` named twice, since a
step is addressed by its authenticator and a repeat leaves whichever one
dispatch reaches first standing for both.

**`If-Match` is mandatory here, not optional.** This route replaces an
authorization-bearing list whole, so a stale write reinstates exactly what
another administrator has just removed; the header comes from the matching
`GET`, which answers an `ETag` over the same list. Absent, the request is
refused with `428 Precondition Required` and nothing is changed; stale,
with `412`. The list is read under the same lock the replacement runs
under, so two callers sent at once are serialised — the second sees what
the first wrote rather than matching the same pre-write state.

A tenant may have no default flow row to lock, so the advisory lock
`replaceDefaultSteps` takes is what serialises two replacements, and this
route takes it before the read rather than after — otherwise two callers
holding the same fresh tag would both pass.

`demo`'s flow as `provisionTenant` created it — the four steps every tenant
starts with — and its `ETag`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/flow/executions \
  | grep -E '^(etag:|\{)'
```

```
etag: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"
{"items":[{"index":0,"authenticator":"passkey","requirement":"alternative"},{"index":1,"authenticator":"password","requirement":"alternative"},{"index":2,"authenticator":"otp","requirement":"conditional"},{"index":3,"authenticator":"recovery-code","requirement":"conditional"}],"available":["password","passkey","otp","recovery-code"]}
```

Replacing it with a shorter, reordered one — three steps, password first,
passkey off, and `recovery-code` dropped by being left out:

```bash
curl -sS -D - -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"' \
  -d '[
    {"authenticator": "password", "requirement": "required"},
    {"authenticator": "otp", "requirement": "conditional"},
    {"authenticator": "passkey", "requirement": "disabled"}
  ]' \
  http://localhost:3000/admin/tenants/demo/flow/executions
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d505-73ae-76be-ad27-bfc5ce117582
cache-control: no-store
etag: "c46d3990450c6fdda560192fb31bb5c43d939d3ec27ba6861173ef4c2992e589"
content-type: application/json; charset=utf-8
content-length: 257
Date: Fri, 13 Nov 2026 13:07:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional"},{"index":2,"authenticator":"passkey","requirement":"disabled"}],"available":["password","passkey","otp","recovery-code"]}
```

A second `PUT` carrying that same, now stale, header changes nothing:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"' \
  -d '[{"authenticator": "password", "requirement": "required"}]' \
  http://localhost:3000/admin/tenants/demo/flow/executions
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1d505-73d9-7656-b58b-ffc3b14fea97"}
```

`index` is the array's own order renumbered from zero, and the request
carried none. The empty list is refused ahead of the precondition, so it
answers `400` rather than `428` even with no `If-Match` sent — the shape of
the request is wrong whatever generation it is against:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[]' \
  http://localhost:3000/admin/tenants/demo/flow/executions
```

```
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d505-73ef-7da2-8f66-5d4556c1dab5"}
```

Each of the five `400`s a `PUT` can answer has a type of its own, so a caller
tells them apart without reading `detail`: `about:blank#flow-empty`,
`#flow-no-enabled-step`, `#flow-no-first-challenge` (no step could run when a
login starts, since only `password` is applicable before a subject is bound),
`#flow-unknown-authenticator` and `#flow-duplicate-authenticator`; a sixth, `#flow-step-settings`, is below. The last two
carry `errors` with the path of the step at fault, as `[1].authenticator`; the
others name no step. `detail` is unchanged. In `flow-demo`, under the `ETag` of
the flow the tenant starts with, one request each:

```bash
for body in '[]' \
  '[{"authenticator":"password","requirement":"disabled"},{"authenticator":"otp","requirement":"disabled"}]' \
  '[{"authenticator":"passkey","requirement":"required"},{"authenticator":"password","requirement":"alternative"}]' \
  '[{"authenticator":"sms","requirement":"required"}]' \
  '[{"authenticator":"password","requirement":"required"},{"authenticator":"password","requirement":"alternative"}]'; do
  curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -H 'If-Match: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"' \
    -d "$body" http://localhost:3000/admin/tenants/flow-demo/flow/executions
  echo
done
```

The same request with, in turn, these bodies in place of `[]`:
`[{"authenticator":"password","requirement":"disabled"},{"authenticator":"otp","requirement":"disabled"}]`,
`[{"authenticator":"passkey","requirement":"required"},{"authenticator":"password","requirement":"alternative"}]`,
`[{"authenticator":"sms","requirement":"required"}]` and
`[{"authenticator":"password","requirement":"required"},{"authenticator":"password","requirement":"alternative"}]`.
The answers, the empty list's first:

```
{"type":"about:blank#flow-empty","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a1d505-7402-79cb-9761-a3c142a0f8ae"}
{"type":"about:blank#flow-no-enabled-step","title":"Bad Request","status":400,"detail":"every step is disabled; a tenant with no enabled step cannot be logged into","instance":"01a1d505-7416-77a0-95ee-1a1968367ab3"}
{"type":"about:blank#flow-no-first-challenge","title":"Bad Request","status":400,"detail":"no step would run at the start of a login, when no subject is bound yet; a tenant whose flow begins this way cannot be logged into","instance":"01a1d505-7428-7450-9cb2-462024769656"}
{"type":"about:blank#flow-unknown-authenticator","title":"Bad Request","status":400,"detail":"unknown authenticator \"sms\"; expected one of password, passkey, otp, recovery-code","errors":[{"path":"[0].authenticator","message":"is not a registered authenticator"}],"instance":"01a1d505-743c-7a7c-89ed-d2390e1b4134"}
{"type":"about:blank#flow-duplicate-authenticator","title":"Bad Request","status":400,"detail":"authenticator \"password\" appears more than once; a step is addressed by its authenticator, so a repeat has no unambiguous meaning","errors":[{"path":"[1].authenticator","message":"repeats an earlier step"}],"instance":"01a1d505-7453-790c-bfd1-5b7aea334896"}
```

The write reaches the executor immediately, not only the table: the very
next login dispatches against the order this `PUT` wrote, since
`initialChallenge`/`advance` read a tenant's executions fresh on every
attempt rather than caching them.

## The authenticators a step may name

Both answers carry `available` beside `items`: every authenticator name the
registry a login dispatches through resolves, in its own order, so a caller
offering to add a step needs no list of its own. The `ETag` covers `items` alone
— `available` is the registry's, and no write here changes it — so the `ETag`
below is the one "A refusal names its field" sent as `If-Match` before
`available` existed, on the same untouched flow. In `fields-demo`:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/fields-demo/flow/executions \
  | grep -E '^(HTTP/|etag:|\{)'
```

```
HTTP/1.1 200 OK
etag: "2e028692eeb04a65ef6a06be482c11d71247d243b5929007716ee0f4eb2324db"
{"items":[{"index":0,"authenticator":"passkey","requirement":"alternative"},{"index":1,"authenticator":"password","requirement":"alternative"},{"index":2,"authenticator":"otp","requirement":"conditional"},{"index":3,"authenticator":"recovery-code","requirement":"conditional"}],"available":["password","passkey","otp","recovery-code"]}
```

## Settings on a step

A step of `otp`, `passkey` or `recovery-code` may carry `settings`, in the request and in the answer, beside `authenticator` and `requirement`. They override the tenant's authenticator settings for that step: `otp` takes `algorithm`, `digits` and `period`, `passkey` takes `user_verification` and `resident_key`, and `recovery-code` takes `count`, each held to the choices and range of the tenant setting of the same meaning ([Settings](./get-settings-and-patch-settings.md)). A key left out takes the tenant's value, and a step with no `settings` behaves as it always did. A person who enrols during a sign-in on the flow is enrolled under the result, and an enrolment made earlier keeps the values it was made with. In `settings-demo`, a flow replaced on the tag its read answers, then read back:

```bash
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/settings-demo/flow/executions | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" \
  -d '[
    {"authenticator": "password", "requirement": "required"},
    {"authenticator": "otp", "requirement": "conditional", "settings": {"digits": 8, "period": 60}},
    {"authenticator": "recovery-code", "requirement": "conditional", "settings": {"count": 12}}
  ]' \
  http://localhost:3000/admin/tenants/settings-demo/flow/executions
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/settings-demo/flow/executions | jq -c ".items"
```

```
{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional","settings":{"digits":8,"period":60}},{"index":2,"authenticator":"recovery-code","requirement":"conditional","settings":{"count":12}}],"available":["password","passkey","otp","recovery-code"]}
[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional","settings":{"digits":8,"period":60}},{"index":2,"authenticator":"recovery-code","requirement":"conditional","settings":{"count":12}}]
```

`password` reads no setting, and a key another authenticator reads is not read by this one: both are refused with `400` `flow-step-settings`, whose `errors` name the step as `[0].settings`. A value outside the choices, such as 7 digits, is refused as a schema error that names the key. Nothing is written by any of them:

```bash
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3000/admin/tenants/settings-demo/flow/executions | tr -d '\r' | sed -n 's/^etag: //p')
for body in '[{"authenticator": "password", "requirement": "required", "settings": {"digits": 8}}]' '[{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "required", "settings": {"count": 9}}]' '[{"authenticator": "password", "requirement": "required"}, {"authenticator": "otp", "requirement": "required", "settings": {"digits": 7}}]'; do
  curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
    -H "If-Match: $ETAG" \
    -d "$body" http://localhost:3000/admin/tenants/settings-demo/flow/executions
  echo
done
```

```
{"type":"about:blank#flow-step-settings","title":"Bad Request","status":400,"detail":"step \"password\" carries settings it does not read","errors":[{"path":"[0].settings","message":"this authenticator reads no settings"}],"instance":"01a1d505-74cb-7b9b-9048-f191e59cb079"}
{"type":"about:blank#flow-step-settings","title":"Bad Request","status":400,"detail":"step \"otp\" carries settings it does not read","errors":[{"path":"[1].settings","message":"this authenticator reads algorithm, digits, period, not count"}],"instance":"01a1d505-74df-7882-8caa-a1ef5c5d41a8"}
{"type":"about:blank","title":"Error","status":400,"detail":"body/1/settings/digits must be equal to one of the allowed values","errors":[{"path":"[1].settings.digits","message":"must be equal to one of the allowed values"}],"instance":"01a1d505-74f3-7909-bc52-297108510d0b"}
```
