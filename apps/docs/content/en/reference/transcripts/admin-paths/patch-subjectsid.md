---
title: 'PATCH /subjects/:id'
description: 'Requires manage-users. Amends email and enabled — and username, where the tenant allows it (below) — the only general fields a subject exposes…'
---

# `PATCH /subjects/:id`

Requires `manage-users`. Amends `email` and `enabled` — and `username`,
where the tenant allows it (below) — the only general fields a subject
exposes; everything else about a subject (credentials, required actions,
roles) has its own door below. An `email` another subject in the tenant
already holds is refused with `409`, as on `POST /subjects`. Any other new
address is not stored: it is kept as the subject's pending change, mailed a
verification link, and replaces the stored address only when the person follows
the link ([below](#changing-an-email-the-person-confirms)). Honours
`If-Match`, answering `412` on a mismatch, the same convention every other
amendment in this API follows — locked with `SELECT … FOR NO KEY UPDATE`
before the `ETag` is computed, so two concurrent amendments cannot both
pass the precondition. `NO KEY UPDATE` rather than `UPDATE`, as on every
admin route that mutates a subject: it still queues a second admin
mutation, but not a sign-in inserting a row that names the subject, which
takes a key-share lock and would otherwise deadlock against it. Held to the target ceiling
([`POST /subjects/:id/password`](./post-subjectsidpassword.md#the-target-ceiling)), as every route that
mutates a subject is: refused with `403` when the subject holds an admin
capability the caller does not.

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a1ee9e-bc7f-7bf1-86ac-55da4d468d58
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9e-cb3f-7ced-8656-4fb1342ab18d
cache-control: no-store
etag: "a1b6f2df195fee7d14ab669df1bc67ec17c60b637fd00eae07a504c9b59d283b"
content-type: application/json; charset=utf-8
content-length: 179
Date: Wed, 18 Nov 2026 12:25:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-bc7f-7bf1-86ac-55da4d468d58","type":"user","username":"ada","email":"ada@example.com","enabled":false,"created_at":"2026-11-18T12:25:42.781Z","pending_email":null}
```

The `ETag` is the one `GET /subjects/:id` above returned, recomputed — a
caller that read before this write holds a stale one.

## Renaming a username

A username is not an identifier a relying party may key on — `sub` is
([ADR 0039](https://github.com/wizzywit/odudu/blob/main/docs/adr/0039-names-relying-parties-match-on-are-identifiers.md)) —
so it is renamable, through this same `PATCH`, behind the tenant setting
`username_editable`, `false` by default. With it off, `username` in the body
is refused with `400` naming the setting. With it on, the new name is held to
the rule creation holds one to (a non-empty string, `usernameSchema` in
`@odudu/contracts`), and `If-Match` is **mandatory** whenever `username` is
in the body — `428` without it, or with `*`, which names no version — the precedent `redirect_uris` sets on
`PATCH /clients/{id}` — because one administrator's rename silently undoing
another's is what the precondition exists to stop. A name another subject
in the tenant holds refuses the whole request with `409`: the unique index
`users_username_unique` answers, outside the transaction, so nothing else
the same body asked for is applied either. That index is on
`(tenant_id, username)` and case-sensitive, so a case-variant of another
subject's name (`Ada` beside `ada`) is a distinct name and is accepted — as
it is on `POST /subjects` and at sign-in, which match a username exactly. A
rename to the name the subject already has, with nothing else in the body,
writes nothing and no audit row. An actual rename writes one
`subject.amend` row whose `detail` carries the before and after values.

Nothing keyed on the subject moves: sessions and refresh tokens hold `sub`,
so both keep working; the brute-force counter is keyed by subject rather
than by the name submitted, so a `login_failures` row survives the rename;
and `preferred_username` (and `name`, when no display name is set) carries
the new name on the next token issued. The old name stops signing in at
once. A password equal to the new username is not re-checked against
`password_not_username` until it is next changed, which is when every
password policy applies.

As a system admin (`seed admin`), on a stack with a mail relay (the one the
section on changing an email below adds), in a tenant `rename-demo` created for
it through `POST /admin/tenants`, on a subject `grace` seeded with a real
password (`odudu seed user`), a second subject `ada` created through `POST
/subjects`, and a confidential client `rename-demo-app` created through `POST
/clients` with `https://app.example/callback` registered and the
`authorization_code` and `refresh_token` grants; `$CLIENT_SECRET` is the secret
that create returned. `$GRACE` is `01a1ee9f-276f-7b40-8c3e-8f34baa3c95a`, and
`signin` is the helper [`DELETE
/subjects/:id/lockout`](./delete-subjectsidlockout.md) defines, pointed at this
client with `profile` in the scope and taking the username as its argument:

```bash
AUTHORIZE='http://localhost:3000/tenants/rename-demo/protocol/openid-connect/auth?response_type=code&client_id=rename-demo-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid%20profile&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
signin() {
  sid=$(curl -sS "$AUTHORIZE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
  curl -sS -D - -o body.html \
    --data-urlencode "auth_session_id=$sid" \
    --data-urlencode "username=$1" \
    --data-urlencode "password=correct horse battery staple" \
    http://localhost:3000/tenants/rename-demo/login-actions/authenticate | grep -iE '^(HTTP|location)'
  grep -o '<title>[^<]*</title>' body.html || true
}
```

With the setting still at its default, the rename is refused:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: *' \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1ee9f-2a63-7ea3-a1f5-20a2d16e03ed
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 301
Date: Wed, 18 Nov 2026 12:26:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"username: this tenant has not enabled username editing (username_editable)","errors":[{"path":"username","message":"this tenant has not enabled username editing (username_editable)"}],"instance":"01a1ee9f-2a63-7ea3-a1f5-20a2d16e03ed"}
```

Turning it on — `PATCH /settings` reaches it too — then signing `grace`
in and redeeming the code, keeping the refresh token:

```bash
odudu seed tenant --name rename-demo --set username_editable=true 2>/dev/null

loc=$(signin grace | tee /dev/stderr | tr -d '\r' | sed -n 's/^location: //p')
code=$(echo "$loc" | sed -n 's/.*code=\([^&]*\).*/\1/p')
REFRESH_TOKEN=$(curl -sS -u "rename-demo-app:$CLIENT_SECRET" \
  --data-urlencode grant_type=authorization_code --data-urlencode "code=$code" \
  --data-urlencode redirect_uri=https://app.example/callback \
  --data-urlencode code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk \
  http://localhost:3000/tenants/rename-demo/protocol/openid-connect/token | sed -n 's/.*"refresh_token":"\([^"]*\)".*/\1/p')
echo "refresh token length ${#REFRESH_TOKEN}"
```

```
{"command":"tenant","created":false,"tenant":"rename-demo","tenantId":"01a1ee9f-259f-721d-924c-117a7fcde1d8","settings":["username_editable"]}
HTTP/1.1 302 Found
location: https://app.example/callback?code=Sv-b7zySoCWVKMU2p-TUVpK1H7srEWD1rcshSwBvD14&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frename-demo
refresh token length 43
```

Without `If-Match`, the rename is refused and nothing changes:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 428 Precondition Required
x-request-id: 01a1ee9f-32ef-75f9-9f1e-bc99350cc3e9
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 181
Date: Wed, 18 Nov 2026 12:26:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to replace a subject's username","instance":"01a1ee9f-32ef-75f9-9f1e-bc99350cc3e9"}
```

Reading the subject for its `ETag`, then renaming under it:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE

curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "9f879bcb162dcfcaedc5a327be264b7a8a8a65f30317afa84419464474eca73f"' \
  -d '{"username": "grace-hopper"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9f-49a4-7e18-956f-89f472d89c53
cache-control: no-store
etag: "9f879bcb162dcfcaedc5a327be264b7a8a8a65f30317afa84419464474eca73f"
content-type: application/json; charset=utf-8
content-length: 167
Date: Wed, 18 Nov 2026 12:26:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-11-18T12:26:10.154Z","pending_email":null}

HTTP/1.1 200 OK
x-request-id: 01a1ee9f-49bd-7b7c-950f-b86d09225962
cache-control: no-store
etag: "5bc456131719ed3d6d72499ab5b19a940e0b320ff8c52658e299c466b576edbb"
content-type: application/json; charset=utf-8
content-length: 174
Date: Wed, 18 Nov 2026 12:26:18 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","type":"user","username":"grace-hopper","email":null,"enabled":true,"created_at":"2026-11-18T12:26:10.154Z","pending_email":null}
```

The refresh token `grace` held before the rename still redeems, and the
access token it buys reads the new name back from `/userinfo`:

```bash
ACCESS_TOKEN=$(curl -sS -u "rename-demo-app:$CLIENT_SECRET" \
  --data-urlencode grant_type=refresh_token \
  --data-urlencode "refresh_token=$REFRESH_TOKEN" \
  http://localhost:3000/tenants/rename-demo/protocol/openid-connect/token | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
echo "access token length ${#ACCESS_TOKEN}"
curl -sS -H "Authorization: Bearer $ACCESS_TOKEN" \
  http://localhost:3000/tenants/rename-demo/protocol/openid-connect/userinfo
```

```
access token length 691
{"sub":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","name":"grace-hopper","preferred_username":"grace-hopper"}
```

The old name no longer signs in with the right password; the new one does:

```bash
signin grace
signin grace-hopper
```

```
HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 302 Found
location: https://app.example/callback?code=iZ_FSybqnwvjGaAzxcaumI5mD1GWhTrlxTdHAAGohnU&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Frename-demo
```

Renaming to `ada`, which the other subject holds, with an email change in
the same body — refused, and a read afterwards shows neither applied and
the `ETag` unchanged. The address was not stored as a pending change either,
and nothing was mailed for it: the relay's catcher, read after, holds no message.

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "5bc456131719ed3d6d72499ab5b19a940e0b320ff8c52658e299c466b576edbb"' \
  -d '{"username": "ada", "email": "grace@rename.example"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE

curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE

curl -sS http://localhost:8092/api/v1/messages | jq -c '{total}'
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1ee9f-733e-7d66-8926-5e5aef42b7d3
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Wed, 18 Nov 2026 12:26:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the username \"ada\" is already in use","instance":"01a1ee9f-733e-7d66-8926-5e5aef42b7d3"}

HTTP/1.1 200 OK
x-request-id: 01a1ee9f-736b-79fb-820a-bc2b6d239f0c
cache-control: no-store
etag: "5bc456131719ed3d6d72499ab5b19a940e0b320ff8c52658e299c466b576edbb"
content-type: application/json; charset=utf-8
content-length: 174
Date: Wed, 18 Nov 2026 12:26:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","type":"user","username":"grace-hopper","email":null,"enabled":true,"created_at":"2026-11-18T12:26:10.154Z","pending_email":null}
{"total":0}
```

`Ada`, a case-variant of that same name, is a different name to
`users_username_unique`, and is accepted under the same `ETag`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "5bc456131719ed3d6d72499ab5b19a940e0b320ff8c52658e299c466b576edbb"' \
  -d '{"username": "Ada"}' \
  http://localhost:3000/admin/tenants/rename-demo/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9f-77f9-7a10-9fea-c645472c519c
cache-control: no-store
etag: "bcf6441684423b6e72033494f74bde1fb4355cca60fcb8e3bbb09e6e9dd85026"
content-type: application/json; charset=utf-8
content-length: 165
Date: Wed, 18 Nov 2026 12:26:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","type":"user","username":"Ada","email":null,"enabled":true,"created_at":"2026-11-18T12:26:10.154Z","pending_email":null}
```

The audit trail for `grace` holds the two renames and nothing for the
refused ones — the `409` rolled back with its transaction, and the `400`
and `428` were refused before anything was written:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/rename-demo/audit?resource_type=subject&resource_id=$GRACE"; echo
```

```
{"items":[{"id":"01a1ee9f-781d-779e-be19-bf87d3f612bf","occurred_at":"2026-11-18T12:26:30.806Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a1ee9e-b60e-717e-aaaf-048a2e0bf30b","actor_client_id":"01a1ee9e-b5d9-766d-b9a1-74c0d57dbf7f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","request_id":"01a1ee9f-77f9-7a10-9fea-c645472c519c","ip":"172.20.0.1","detail":{"username":{"after":"Ada","before":"grace-hopper"}}},{"id":"01a1ee9f-49d1-717b-8bdc-1cf02b518efc","occurred_at":"2026-11-18T12:26:18.953Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a1ee9e-b60e-717e-aaaf-048a2e0bf30b","actor_client_id":"01a1ee9e-b5d9-766d-b9a1-74c0d57dbf7f","actor_name":null,"actor_origin":"system","resource_type":"subject","resource_id":"01a1ee9f-276f-7b40-8c3e-8f34baa3c95a","request_id":"01a1ee9f-49bd-7b7c-950f-b86d09225962","ip":"172.20.0.1","detail":{"username":{"after":"grace-hopper","before":"grace"}}}]}
```

## Changing an email: the person confirms

An administrator does not set an existing address; the person confirms the new
one. A `PATCH` with a new `email` stores it as the subject's pending change,
mails a verification link to it and, when the old address is verified, tells
the old address that a change was asked for. The stored `email` and
`email_verified` stay as they were until the person follows the link, so the
old address keeps signing in meanwhile.

- The response, and `GET /subjects/:id`, carry `pending_email`: the pending
  address, or `null`. The list does not. While one is pending it is part of the
  `ETag`, so a change to it moves the tag; an email-only change still needs no
  `If-Match`, but one that is sent must match.
- A new request replaces an earlier pending one.
- The subject's own current address withdraws a pending change. `null` removes
  the address at once, since removing one needs no proof.
- An address another subject holds is refused with `409`, as above.
- Anything else needs a way to send the mail: a relay on the tenant, or the
  deployment's own sender. Without one the request is refused with `409`
  `about:blank#no-mail-relay`, before anything is written. A deployment with no
  public base URL to put in the link refuses with `503`, and rolls the request
  back.
- A `username` or `enabled` in the same body applies as it does without an
  email, and is rolled back with it when the request is refused.
- One `subject.amend` row records the request, with `email_change`,
  `pending_email` and the state of the notice in its `detail`. A request that
  withdraws a pending change says `email_change: cancelled`, and one that
  removes the address, or drops a pending change by doing so, `cleared`. The
  link's use is the `email.changed` row the person's own change writes.

The `503` above and the notice states `skipped_unverified` and `skipped_none`
are read from the code and were not run on this stack; every other behaviour in
this list is shown by a block below.

On the stack the section above began on, which had no relay: a tenant
`confirm-demo` made with `odudu seed tenant --name confirm-demo --set
login_with_email=true`, a client `confirm-demo-app` (`odudu seed --tenant
confirm-demo --client confirm-demo-app --redirect-uri
https://app.example/callback`), and two subjects seeded with `odudu seed user`,
`grace` (`grace@example.com`) and `heidi` (`heidi@example.com`), each with
`--email-verified` and the password `correct horse battery staple`. `P` is
`http://localhost:3000/admin/tenants/confirm-demo`, `$GRACE` and `$HEIDI` are
their subject ids, and `signin` is the helper above pointed at this tenant and
client, so a person can sign in with the address. The request is refused, and a
read after it shows nothing stored:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace.hopper@example.com"}' \
  $P/subjects/$GRACE
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1ee9e-cd82-7853-89d6-4bade5167db7
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 216
Date: Wed, 18 Nov 2026 12:25:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#no-mail-relay","title":"Conflict","status":409,"detail":"the tenant has no relay and the deployment no sender, so the mail would only be logged","instance":"01a1ee9e-cd82-7853-89d6-4bade5167db7"}
```

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9e-d07b-7f37-880f-65bf2a1be311
cache-control: no-store
etag: "6f152b916b2c636e36e1339a1fc20273bf0593831f09a372e36521771752e232"
content-type: application/json; charset=utf-8
content-length: 182
Date: Wed, 18 Nov 2026 12:25:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":null}
```

Then the same stack was brought up again with a relay, a Mailpit container the
server sends to, through a file added to the compose command, with the volume
kept so that every tenant above is still there. The server sends its own mail,
so the messages arrive a few seconds after the request, and Mailpit's own API
on port `8092` reads them (emptied before this block):

```yaml
services:
  odudu:
    environment:
      ODUDU_ALLOW_PRIVATE_SMTP_HOSTS: 'true'
      ODUDU_SMTP_HOST: mailpit
      ODUDU_SMTP_PORT: '1025'
      ODUDU_SMTP_FROM: odudu@docs.local
      ODUDU_SMTP_STARTTLS: 'false'
  mailpit:
    image: axllent/mailpit:v1.33.0@sha256:9b3a463be15354c0f0eba91697d80e3e0d8a5623ef0e627cacc836bc17fd5231
    ports:
      - '127.0.0.1:8092:8025'
```

The same request now stores the change. The subject keeps its address, and
`pending_email` carries the new one, which also moves the `ETag`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace.hopper@example.com"}' \
  $P/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9f-7cbf-75e5-bda3-7907fd2f29d7
cache-control: no-store
etag: "697e398c6839d2eeef675f60e326810dda05d93d805107d4bfa11d823687a7a6"
content-type: application/json; charset=utf-8
content-length: 204
Date: Wed, 18 Nov 2026 12:26:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.hopper@example.com"}
```

A read shows the same, and the old address still signs in while the new one does
not, since it is not `grace`'s address yet:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/subjects/$GRACE

signin grace@example.com
signin grace.hopper@example.com
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9f-7f15-7f30-8d4d-7edd0cca8468
cache-control: no-store
etag: "697e398c6839d2eeef675f60e326810dda05d93d805107d4bfa11d823687a7a6"
content-type: application/json; charset=utf-8
content-length: 204
Date: Wed, 18 Nov 2026 12:26:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.hopper@example.com"}

HTTP/1.1 302 Found
location: https://app.example/callback?code=AsWg_vcJhIwddPM0LfxROCfStXKQdE5PHPqmcJ-Ftro&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconfirm-demo
HTTP/1.1 200 OK
<title>Sign in</title>
```

Two messages went out: the verification link to the new address and, to the
address `grace` has, the notice that a change was asked for. The notice says
nothing about what the new address is, so it is true whoever asked:

```bash
curl -sS http://localhost:8092/api/v1/messages | jq -c '.messages[] | {to: .To[0].Address, subject: .Subject}'
```

```
{"to":"grace@example.com","subject":"A new email address was requested for your confirm-demo account"}
{"to":"grace.hopper@example.com","subject":"Verify your confirm-demo account"}
```

```bash
mailed grace@example.com
LINK=$(mailed grace.hopper@example.com | grep -o 'http://[^ ]*action-token?key=[^ ]*')
echo "$LINK"
```

```
Someone asked to change the email address on your ⁨confirm-demo⁩ account. This address stays on the account until the new one is confirmed.

This happened on 2026-11-18 12:26 UTC.

If this was not you, sign in and review your sign-in methods, change your password if you use one, or contact your administrator right away.

--
You received this because the email address on your account at ⁨confirm-demo⁩ was asked to change.
© 2026 Odudu · Powered by odudu
http://localhost:3000/tenants/confirm-demo/login-actions/action-token?key=saf60wuUAR5onsAmnwMly1cSeJBZxvbvb8mjnXgwfQI
```

An administrator who made a mistake cancels by asking for the address the
subject already has, which drops the pending change. The link already mailed is
then refused, with the page every spent or replaced link gets:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace@example.com"}' \
  $P/subjects/$GRACE

curl -sS -X POST --data-urlencode "key=${LINK##*key=}" \
  http://localhost:3000/tenants/confirm-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9f-dcb9-7f7d-a3d9-504a3a1e89dd
cache-control: no-store
etag: "6f152b916b2c636e36e1339a1fc20273bf0593831f09a372e36521771752e232"
content-type: application/json; charset=utf-8
content-length: 182
Date: Wed, 18 Nov 2026 12:26:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":null}

<h1>This link can&#39;t be used</h1>
<p>It may have already been used, expired, or no longer matches your email address. Request a new verification email and try again.</p>
<form method="post" action="/tenants/confirm-demo/login-actions/resend-verification">
  <input type="hidden" name="key" value="saf60wuUAR5onsAmnwMly1cSeJBZxvbvb8mjnXgwfQI">
  <button type="submit">Send a new link</button>
</form>
</main>
```

A pending address is part of the `ETag` while it is pending, so a cancellation
is held to the version it was read at. Here a request for `grace.hopper@example.com`
is pending and its tag is read; a second request replaces it with
`grace.h@example.com`, which moves the tag; and a cancellation sent with the first
tag is refused with `412`, with the second request's address still pending:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace.hopper@example.com"}' \
  $P/subjects/$GRACE

curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1ee9f-ee9d-725c-bdc1-ea772e385968
cache-control: no-store
etag: "697e398c6839d2eeef675f60e326810dda05d93d805107d4bfa11d823687a7a6"
content-type: application/json; charset=utf-8
content-length: 204
Date: Wed, 18 Nov 2026 12:27:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.hopper@example.com"}

HTTP/1.1 200 OK
x-request-id: 01a1ee9f-eeca-7606-9feb-709163a17d7f
cache-control: no-store
etag: "697e398c6839d2eeef675f60e326810dda05d93d805107d4bfa11d823687a7a6"
content-type: application/json; charset=utf-8
content-length: 204
Date: Wed, 18 Nov 2026 12:27:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.hopper@example.com"}
```

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace.h@example.com"}' \
  $P/subjects/$GRACE

curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "697e398c6839d2eeef675f60e326810dda05d93d805107d4bfa11d823687a7a6"' \
  -d '{"email": "grace@example.com"}' \
  $P/subjects/$GRACE

curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1eea0-00b8-7f69-9436-d652a124699e
cache-control: no-store
etag: "ae96596f317adc31df89674ee336fb9f526adebfdb3b0e811e2338e5c761aec4"
content-type: application/json; charset=utf-8
content-length: 199
Date: Wed, 18 Nov 2026 12:27:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.h@example.com"}

HTTP/1.1 412 Precondition Failed
x-request-id: 01a1eea0-00d7-72a2-8b70-97ca4be73ef4
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Wed, 18 Nov 2026 12:27:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1eea0-00d7-72a2-8b70-97ca4be73ef4"}

HTTP/1.1 200 OK
x-request-id: 01a1eea0-00ec-76d2-9406-53dd273a9da8
cache-control: no-store
etag: "ae96596f317adc31df89674ee336fb9f526adebfdb3b0e811e2338e5c761aec4"
content-type: application/json; charset=utf-8
content-length: 199
Date: Wed, 18 Nov 2026 12:27:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.h@example.com"}
```

A new request for the first address mails a new link and replaces the other. Following it completes the change: the stored
address becomes the new one, verified, and `pending_email` is `null` again. The
`ETag` moves because `email` is part of it. The old address no longer signs in,
and the new one does:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace.hopper@example.com"}' \
  $P/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1eea0-129a-73b3-80bb-b29bc9802731
cache-control: no-store
etag: "697e398c6839d2eeef675f60e326810dda05d93d805107d4bfa11d823687a7a6"
content-type: application/json; charset=utf-8
content-length: 204
Date: Wed, 18 Nov 2026 12:27:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":"grace.hopper@example.com"}
```

```bash
LINK=$(mailed grace.hopper@example.com | grep -o 'http://[^ ]*action-token?key=[^ ]*')
curl -sS -X POST --data-urlencode "key=${LINK##*key=}" \
  http://localhost:3000/tenants/confirm-demo/login-actions/action-token | sed -n '/<h1>/,/<\/main>/p'
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/subjects/$GRACE

signin grace@example.com
signin grace.hopper@example.com
```

```
<h1>Your email address is confirmed</h1>
<p>Return to the application you were signing in to and sign in again.</p>
</main>
HTTP/1.1 200 OK
x-request-id: 01a1eea0-7412-780f-8452-35e833ef9732
cache-control: no-store
etag: "784d18a2dd5f2840a76e6fabda7cdc6d35d0d5a98303f091695d524fcccc2f45"
content-type: application/json; charset=utf-8
content-length: 189
Date: Wed, 18 Nov 2026 12:27:35 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":"grace.hopper@example.com","enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":null}

HTTP/1.1 200 OK
<title>Sign in</title>
HTTP/1.1 302 Found
location: https://app.example/callback?code=Djnc-c4xljqA1k9ynbh7IHKT3EuTL-wruPWxm5Hxr0E&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconfirm-demo
```

An address another subject holds is refused as before, and nothing is mailed:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": "grace.hopper@example.com"}' \
  $P/subjects/$HEIDI
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1eea0-7741-78de-8847-3e839b92c562
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 172
Date: Wed, 18 Nov 2026 12:27:36 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the email \"grace.hopper@example.com\" is already in use","instance":"01a1eea0-7741-78de-8847-3e839b92c562"}
```

Removing the address is `null`, which needs no proof and is done at once. The
response has `email` as `null`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"email": null}' \
  $P/subjects/$GRACE
```

```
HTTP/1.1 200 OK
x-request-id: 01a1eea0-7955-7ff7-be16-cf95d0ce473d
cache-control: no-store
etag: "eeb510160ae2bb87a063a7da0aad5227a7ab89696f9373e18e06354bc6166cdf"
content-type: application/json; charset=utf-8
content-length: 167
Date: Wed, 18 Nov 2026 12:27:36 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1ee9e-c499-709d-97b4-704a94abc05c","type":"user","username":"grace","email":null,"enabled":true,"created_at":"2026-11-18T12:25:44.852Z","pending_email":null}
```

The trail for `grace`, reduced to the fields that matter: each request (the
refused cancellation wrote nothing), the cancel (`email_change: cancelled`, since a pending change was dropped), the
`email.changed` the link wrote and the removal (`cleared`, with the stored
address in the usual before and after). The `notice` is `sent` because the old
address was verified; for an address nobody verified it is `skipped_unverified`,
and for a subject with no address `skipped_none`, which were not run here:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?resource_type=subject&resource_id=$GRACE" \
  | jq -c '.items | reverse | .[] | {action, outcome, detail}'
```

```
{"action":"subject.amend","outcome":"allowed","detail":{"notice":"sent","email_change":"requested","pending_email":"grace.hopper@example.com"}}
{"action":"subject.amend","outcome":"allowed","detail":{"email_change":"cancelled"}}
{"action":"subject.amend","outcome":"allowed","detail":{"notice":"sent","email_change":"requested","pending_email":"grace.hopper@example.com"}}
{"action":"subject.amend","outcome":"allowed","detail":{"notice":"sent","email_change":"requested","pending_email":"grace.h@example.com"}}
{"action":"subject.amend","outcome":"allowed","detail":{"notice":"sent","email_change":"requested","pending_email":"grace.hopper@example.com"}}
{"action":"email.changed","outcome":"allowed","detail":{}}
{"action":"subject.amend","outcome":"allowed","detail":{"email":{"after":null,"before":"grace.hopper@example.com"},"email_change":"cleared"}}
```
