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

No `502` is shown against that installation: it has no mail server and no host
it is willing to dial. [A relay that refuses](#a-recipient-a-relay-and-the-budget-that-refuse)
below was run where a relay is reachable.

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

## A test mail wears a client's look

`POST /smtp/test` takes an optional `client_id`, the `id` of one of the tenant's clients,
and sends the test mail as that client's sign-in would: its published logo and colours
over the tenant's, and the tenant's wording. It needs `manage-clients` as well, since it
reads a client's theme. A client the tenant does not hold, another tenant's included, is
`404`, and a caller without `manage-clients` is `403`.

The sections below ran on a stack where private relay hosts are admitted
(`ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true`) and the relay is a Mailpit
named `mailpit`, listening on `1025`, with its web port published on `8725` and emptied
first. The tenant `smtp-client-demo` holds a client `portal` whose published theme sets
the light palette and a logo (`client-logo.png`, a 96 by 32 pixel PNG made for this
page), and the tenant has no theme of its own:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"smtp-client-demo","display_name":"SMTP Client Demo"}' \
  http://localhost:3000/admin/tenants | jq -c '{name, enabled}'
P=http://localhost:3000/admin/tenants/smtp-client-demo
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"portal","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $P/clients | jq -c '{client_id, type}'
CID=$(curl -sS -H "$A" "$P/clients?client_id_exact=portal" | jq -r '.items[0].id')
LOGO=$(curl -sS -X POST -H "$A" -H "Content-Type: image/png" --data-binary @client-logo.png "$P/theme/assets?kind=logo" | jq -r .id)
jq -n --arg id "$LOGO" '{
  tokens: { light: {
    surfacePage: "#e8f0ff", surfacePanel: "#f4f8ff", surfaceSunken: "#d8e4f8",
    inkPrimary: "#111111", inkMuted: "#555555",
    signalActive: "#ddeedd", signalActiveInk: "#004400",
    signalDanger: "#fde0d0", signalDangerInk: "#802000",
    borderStrong: "#777777", focusRing: "#0044aa" } },
  assets: { logo: { assetId: $id, alt: "Portal" } }
}' > smtp-client-theme.json
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "$A" -H "$J" --data-binary @smtp-client-theme.json $P/clients/$CID/theme
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "$A" $P/clients/$CID/theme/publish
curl -sS -X PUT -H "$A" -H "$J" -d '{"host":"mailpit","port":1025,"from_address":"noreply@smtp-client.example"}' \
  $P/smtp | jq -c '{configured, host, port, effective}'
```

```
{"name":"smtp-client-demo","enabled":true}
{"client_id":"portal","type":"public"}
200
200
{"configured":true,"host":"mailpit","port":1025,"effective":"tenant"}
```

The same address is sent a test mail twice, first without a client and then as `portal`.
Mailpit holds both. The first, with no client, carries Odudu's own mark and colours, since the
tenant has no theme; the second carries the client's logo and light colours:

```bash
curl -sS -X DELETE http://localhost:8725/api/v1/messages
echo
curl -sS -X POST -H "$A" -H "$J" -d '{"to":"ops@example.test"}' $P/smtp/test
echo
curl -sS -X POST -H "$A" -H "$J" -d "{\"to\":\"ops@example.test\",\"client_id\":\"$CID\"}" $P/smtp/test
echo
curl -sS http://localhost:8725/api/v1/messages | jq -c '.messages | reverse | .[] | {Subject, To: .To[0].Address}'
N=0
for ID in $(curl -sS http://localhost:8725/api/v1/messages | jq -r '.messages | reverse | .[].ID'); do
  N=$((N + 1)); echo "message $N"
  curl -sS http://localhost:8725/api/v1/message/$ID | jq -r .HTML | grep -o -E 'background-color:#[0-9a-f]{6}|<img [^>]*>' | sort -u | cut -c1-200
done
```

```
ok
{"sent":true}
{"sent":true}
{"Subject":"Odudu SMTP test","To":"ops@example.test"}
{"Subject":"Odudu SMTP test","To":"ops@example.test"}
message 1
<img src="cid:odudu-mark" width="40" height="40" alt="odudu" style="display:block;width:40px;height:40px;border:0;border-radius:8px;font:600 14px/40px system-ui,-apple-system,BlinkMacSystemFont,Roboto
background-color:#121716
background-color:#151a19
background-color:#1c2221
background-color:#e4e9e7
background-color:#e7eae9
background-color:#ffffff
message 2
<img src="http://localhost:3000/tenants/smtp-client-demo/brand/265ffac882aa7e2f48610beb6b4c66bddd27ccddc52715b5857754914e5ab27e.png" width="96" height="32" alt="Portal" style="display:block;width:96px
background-color:#121716
background-color:#151a19
background-color:#1c2221
background-color:#e4e9e7
background-color:#e8f0ff
background-color:#f4f8ff
```

A client the tenant does not hold is `404`, and so is a client of another tenant, here
`portal` of `mail-demo`. A caller who holds `manage-tenant` but not `manage-clients` is
`403` when it names a client, and not when it names none. `smtp-operator` is a
`client_credentials` client of the tenant whose service account is given that one role:

```bash
OTHER=$(curl -sS -H "$A" "http://localhost:3000/admin/tenants/mail-demo/clients?client_id_exact=portal" | jq -r '.items[0].id')
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "$A" -H "$J" -d '{"to":"ops@example.test","client_id":"01a18705-0000-7000-8000-000000000000"}' $P/smtp/test
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "$A" -H "$J" -d "{\"to\":\"ops@example.test\",\"client_id\":\"$OTHER\"}" $P/smtp/test
OPERATOR=$(curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"smtp-operator","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["urn:odudu:params:admin-api"]}' $P/clients)
SUBJECT=$(echo "$OPERATOR" | jq -r .service_subject_id)
ROLE=$(curl -sS -H "$A" "$P/roles?name=manage-tenant" | jq -r '.items[0].id')
ETAG=$(curl -sS -D - -o /dev/null -H "$A" $P/subjects/$SUBJECT/roles | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "$A" -H "$J" -H "If-Match: $ETAG" -d "{\"role_ids\":[\"$ROLE\"]}" $P/subjects/$SUBJECT/roles
OP_TOKEN=$(curl -sS -u "smtp-operator:$(echo "$OPERATOR" | jq -r .client_secret)" -d grant_type=client_credentials \
  http://localhost:3000/tenants/smtp-client-demo/protocol/openid-connect/token | jq -r .access_token)
curl -sS -X POST -H "Authorization: Bearer $OP_TOKEN" -H "$J" -d "{\"to\":\"ops@example.test\",\"client_id\":\"$CID\"}" $P/smtp/test
echo
curl -sS -X POST -H "Authorization: Bearer $OP_TOKEN" -H "$J" -d '{"to":"ops@example.test"}' $P/smtp/test
echo
```

```
404
404
200
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a18b65-a7a9-7f20-a245-20e1361bf9ad"}
{"sent":true}
```

## A recipient, a relay and the budget that refuse

`to` is exactly one address. A list and an address with a display name are each a `400`
that names the field and the pattern, before anything is dialled:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"to":"a@example.test, b@example.test"}' $P/smtp/test | jq -c '{status, errors: [.errors[].path]}'
curl -sS -X POST -H "$A" -H "$J" -d '{"to":"Ops <ops@example.test>"}' $P/smtp/test | jq -c '{status, errors: [.errors[].path]}'
```

```
{"status":400,"errors":["to"]}
{"status":400,"errors":["to"]}
```

A relay that cannot be reached is a `502` with one fixed sentence for that kind of failure
and nothing of what the relay or the network said. The tenant's relay is moved to port
`1`, where nothing listens, and the test is sent; the audit trail records it as `failed`.
The relay is then put back, and the same test is `200`:

```bash
curl -sS -X PUT -H "$A" -H "$J" -d '{"host":"mailpit","port":1,"from_address":"noreply@smtp-client.example"}' \
  $P/smtp | jq -c '{host, port, effective}'
curl -sS -D - -X POST -H "$A" -H "$J" -d '{"to":"ops@example.test"}' $P/smtp/test
echo
curl -sS -H "$A" "$P/audit?action=tenant.smtp_test" | jq -c '.items[0] | {action, outcome, detail}'
curl -sS -X PUT -H "$A" -H "$J" -d '{"host":"mailpit","port":1025,"from_address":"noreply@smtp-client.example"}' \
  $P/smtp | jq -c '{host, port, effective}'
curl -sS -X POST -H "$A" -H "$J" -d '{"to":"ops@example.test"}' $P/smtp/test
echo
```

```
{"host":"mailpit","port":1,"effective":"tenant"}
HTTP/1.1 502 Bad Gateway
x-request-id: 01a18b65-a80f-7e10-8c9a-d9a9fa26b63d
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 149
Date: Fri, 30 Oct 2026 06:00:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Gateway","status":502,"detail":"the relay could not be reached","instance":"01a18b65-a80f-7e10-8c9a-d9a9fa26b63d"}
{"action":"tenant.smtp_test","outcome":"failed","detail":{"result":"send_failed"}}
{"host":"mailpit","port":1025,"effective":"tenant"}
{"sent":true}
```

### The origin's budget

The route is limited per origin like the other routes that send mail, by
`ODUDU_THROTTLE_LIMIT` a minute (ten by default). The stack was started again with
`ODUDU_THROTTLE_LIMIT=3`, which its compose file passes through, and the tenant's data
was left as it was. Three sends are answered and the fourth is `429`, with no body and the
seconds to wait in `Retry-After`:

```bash
for I in 1 2 3; do
  curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "$A" -H "$J" -d '{"to":"ops@example.test"}' $P/smtp/test
done
curl -sS -D - -X POST -H "$A" -H "$J" -d '{"to":"ops@example.test"}' $P/smtp/test
echo
```

```
200
200
200
HTTP/1.1 429 Too Many Requests
x-request-id: 01a18b6e-0d63-722d-8373-485d252cc175
retry-after: 60
content-length: 0
Date: Fri, 30 Oct 2026 06:10:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72


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
