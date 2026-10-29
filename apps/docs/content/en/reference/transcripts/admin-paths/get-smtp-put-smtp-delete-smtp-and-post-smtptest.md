---
title: 'GET /smtp, PUT /smtp, DELETE /smtp and POST /smtp/test'
description: "All four require manage-tenant. DELETE removes the tenant's own row, so its mail falls back to the deployment's ODUDU_SMTP_ sender and then the…"
---

# `GET /smtp`, `PUT /smtp`, `DELETE /smtp` and `POST /smtp/test`

All four require `manage-tenant`. `DELETE` removes the tenant's own row,
so its mail falls back to the deployment's `ODUDU_SMTP_*` sender and then
the log-only adapter — the one way back from a configuration `PUT` can
only replace. `204` on success, `404` when there was nothing to remove. `GET` reports `configured: false` and
`password_set: false` for a tenant with no row, rather than 404 — the
endpoint always exists, it is the configuration that may not. `PUT`
replaces the whole configuration except the password, which `GET` never
hands back for a caller to resend: omitting `password` keeps the stored
one, and `"password": null` clears it. A kept password stays with the relay
and account it was entered for — omitting it while `host`, `port` or
`username` changes is refused with `400` naming `password`, since the next
test send would otherwise authenticate to whoever runs the new host. `GET` and `PUT` also report
`effective` — whose relay the tenant's mail actually goes through: `tenant`
for its own row, `deployment` for the deployment's `ODUDU_SMTP_*` sender,
`none` when there is neither and mail is only logged. The stored
password wraps through the same envelope a signing key's private half does
(`wrapSecret`/`unwrapSecret`, `@odudu/crypto`) — the column never carries
plaintext.

Two refusals bound what may be stored and what may be dialled.

**A configuration that authenticates requires TLS.** A `username` or a
`password` — sent, or kept from the stored row — with `starttls` anything
but `true` is `400`: `secure: false`
with STARTTLS unenforced puts those credentials on the wire in cleartext
(CWE-319). The transport requires TLS whenever credentials are present
whatever the row says, so this refusal is what keeps the stored row honest
about what will happen, rather than being the only thing between a
password and the network.

**The host is bounded before any connection is opened**, by the rules ADR
0028 puts on a client-supplied `jwks_uri`: the addresses `host` resolves to
are checked in the numeric domain, and loopback, link-local, private,
unspecified, multicast, broadcast and the reserved ranges are refused with
`400` naming the address and why. The connection is then opened to an
address that passed, never by resolving `host` a second time; the tenant's
hostname travels as the TLS server name, so certificate verification still
names the host they configured. Without it, `POST /smtp/test` is a port
scanner — a `manage-tenant` admin stores any host and port, and the
transport's own error answers back whether something is listening.
`ODUDU_ALLOW_PRIVATE_SMTP_HOSTS` re-admits the private ranges for a
deployment whose relay genuinely is internal, the same escape hatch
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS` gives that fetcher; loopback and
link-local stay refused either way.

`GET` and `PUT` answer an `ETag` over the configuration as they answer it. `PUT`
honours `If-Match` when it is sent, taken under a lock on the row it replaces,
and refuses a stale one with `412`; it does not require one, since a tenant with
no row has nothing another writer could have changed under it. In `etags-demo`,
which had no SMTP row — the `GET`, a `PUT` with an `If-Match` that matches
nothing, and the same `PUT` under the `GET`'s own:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3080/admin/tenants/etags-demo/smtp \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "0000"' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"noreply@etags.example"}' \
  http://localhost:3080/admin/tenants/etags-demo/smtp \
  | grep -E '^(HTTP/|etag:|\{)'
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -H 'If-Match: "eb513a27e14a9d51bb5c40764b9054c6c4b4ff6de3ce14b3eb4cf4745589d891"' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"noreply@etags.example"}' \
  http://localhost:3080/admin/tenants/etags-demo/smtp \
  | grep -E '^(HTTP/|etag:|\{)'
```

```
HTTP/1.1 200 OK
etag: "eb513a27e14a9d51bb5c40764b9054c6c4b4ff6de3ce14b3eb4cf4745589d891"
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0ea60-0a48-75a8-a2e6-34274b488d20"}
HTTP/1.1 200 OK
etag: "f9ba93780f589e0cc3b6f2606f67d0d7b01c5a2ed5d04880f94052f64d4e1d80"
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@etags.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}
```

Resolution order when this tenant's mail is actually sent: this row first, then
the deployment's own `ODUDU_SMTP_*` sender, then the log-only adapter. ADR 0015
is unaffected — it governs where a deployment's own credentials live, and this
is a credential the deployment itself never holds.

In the transcripts below `demo` has no SMTP row until this section's `PUT`s.

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3080/admin/tenants/demo/smtp
echo
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example", "password": "hunter2"}' \
  http://localhost:3080/admin/tenants/demo/smtp
```

`GET` before that `PUT`, then the `PUT`'s own answer. The unconfigured read
is `200` with every field `null`, not `404`; the `PUT` is refused, because
it carries a password and does not ask for TLS:

```
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"starttls must be true when a username or password is configured","errors":[{"path":"starttls","message":"must be true when a username or password is configured"}],"instance":"01a0ea60-0a9a-74fe-9c48-4efba484a5eb"}
```

The same body with `"starttls": true`, then `GET` again:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example", "password": "hunter2", "starttls": true}' \
  http://localhost:3080/admin/tenants/demo/smtp
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3080/admin/tenants/demo/smtp
```

```
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true,"effective":"tenant"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true,"effective":"tenant"}
```

`password_set` is how the password is reported; the value itself is never
in any of these.

## A kept password

In a tenant `smtp-keep-demo` created for it with no row: the `GET`; a `PUT` with
a password; a `PUT` changing only `from_address` and leaving `password` out,
which keeps it; the same with `starttls` off, refused for the password it would
keep; a `PUT` moving the host and leaving `password` out, refused naming
`password`; and a `PUT` sending `"password": null` without a `username`, which
clears it. None of these shows `deployment`: this server sets no
`ODUDU_SMTP_HOST`, so a tenant with no row is on `none`.

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"noreply@keep.example","username":"mailer","password":"hunter2","starttls":true}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":"mailer","starttls":true}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":"mailer","starttls":false}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"relay.elsewhere.example","port":587,"from_address":"alerts@keep.example","username":"mailer","starttls":true}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","password":null}' \
  http://localhost:3080/admin/tenants/smtp-keep-demo/smtp
```

```
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@keep.example","username":"mailer","password_set":true,"starttls":true,"effective":"tenant"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":"mailer","password_set":true,"starttls":true,"effective":"tenant"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"starttls must be true when a username or password is configured","errors":[{"path":"starttls","message":"must be true when a username or password is configured"}],"instance":"01a0ea60-3e66-7f14-9ce6-838c942d3084"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"password must be sent again when host, port or username changes","errors":[{"path":"password","message":"must be sent again when host, port or username changes"}],"instance":"01a0ea60-3e7a-7ef9-a02e-531e6b7e4326"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"alerts@keep.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}
```

`POST /smtp/test` sends one message to one address synchronously and
reports a transport failure as `502`, rather than an operator discovering a
bad configuration only when a user's verification mail silently fails. The
`detail` is one fixed sentence for the kind of failure (the relay could not
be reached, refused the secure connection, refused the credentials, refused
the message, or another), chosen from the transport's error code; the
relay's own words go to the server log and never to the caller. `to` must be
exactly one address: a list, a display name or a line break is `400`, and the
route is limited per origin like the other routes that send mail. `400` for
a tenant with no SMTP configuration at all, and `400` for a host this server
will not connect to.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "ops@demo.example"}' \
  http://localhost:3080/admin/tenants/smtp-test-demo/smtp/test
echo
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "ops@demo.example"}' \
  http://localhost:3080/admin/tenants/demo/smtp/test
echo
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "127.0.0.1", "port": 587, "from_address": "noreply@demo.example", "password": "hunter2", "starttls": true}' \
  http://localhost:3080/admin/tenants/demo/smtp > /dev/null
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "ops@demo.example"}' \
  http://localhost:3080/admin/tenants/demo/smtp/test
```

Against `smtp-test-demo`, a tenant with no row, then against `demo` and the
`smtp.example.test` row the `PUT` above stored, then after its `host` was
re-`PUT` as `127.0.0.1`, with the password sent again as a changed host requires
— the probe this endpoint would otherwise be:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this tenant has no SMTP configuration","instance":"01a0ea60-0a74-7100-90b4-6e49dcb91251"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to smtp.example.test: it resolves to no address","instance":"01a0ea60-0ad1-7952-b75a-bc336444b582"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address","instance":"01a0ea60-0b2b-7f39-b3aa-85c093b26882"}
```

No `502` is shown: this installation has no mail server and no host it is
willing to dial, so nothing here reaches a transport for one to be reported
from.

Every test send is recorded as `tenant.smtp_test`, whatever it came to:
`allowed` when the relay accepted the message, `refused` for no configuration or
a destination this server will not dial, `failed` for a transport error, with
`detail.result` naming which. The recipient is not recorded, and the password
never is. In a tenant `smtp-audit-demo` given a relay at `127.0.0.1` with a
password, then sent to `ops@demo.example`:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"to":"ops@demo.example"}' \
  http://localhost:3082/admin/tenants/smtp-audit-demo/smtp/test | jq -c '{status,detail}'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3082/admin/tenants/smtp-audit-demo/audit?action=tenant.smtp_test" \
  | jq -c '.items[] | {action,outcome,resource_type,detail}'
```

```
{"status":400,"detail":"this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address"}
{"action":"tenant.smtp_test","outcome":"refused","resource_type":"tenant","detail":{"result":"refused_destination"}}
```

`DELETE`, in a tenant `smtp-delete-demo` created for it with no row, then after
a `PUT` had stored one. `404` first, `204` second, and a `GET` afterwards
showing the tenant back on the deployment's own sender — `none` here, since this
installation has none:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp

curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example"}' \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp

curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3080/admin/tenants/smtp-delete-demo/smtp
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0ea60-3ea1-7d44-8d33-cb1d7be0cf91
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Mon, 28 Sep 2026 23:36:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"this tenant has no SMTP configuration","instance":"01a0ea60-3ea1-7d44-8d33-cb1d7be0cf91"}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":false,"starttls":false,"effective":"tenant"}

HTTP/1.1 204 No Content
x-request-id: 01a0ea60-3ecb-7f6f-9a7d-400d877a394e
cache-control: no-store
Date: Mon, 28 Sep 2026 23:36:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null,"effective":"none"}
```
