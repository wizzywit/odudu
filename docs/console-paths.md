# Console paths

The console gateway: the routes under `/console` that sign an administrator
in to a tenant, hold that administrator's tokens server-side, and forward the
console's calls to the admin API. The browser holds nothing but a session
cookie.

[README.md](../README.md) is the **entry point** — what each route does and
which settings turn the console on. [docs/admin-paths.md](admin-paths.md)
is the admin API the proxy forwards to, and this document shows only enough
of it to show the forwarding. There is one "What is not implemented" list
for the whole server, in
[docs/request-paths.md](request-paths.md#what-is-not-implemented); this
document never starts a second one.

Every transcript below is captured output, under the same discipline as
[docs/request-paths.md](request-paths.md): a fenced block holding a response
carries no language tag, a section whose output depends on the state of the
stack says which state, and a precondition a refusal depends on is shown
rather than asserted. `tests/docs/console-paths.test.ts` holds every
`/console/` route this document names to the routes the server serves.

**The stack.** The `docker-odudu-1` container of `infra/docker/compose.yaml`,
its `odudu` service rebuilt at commit `5fd4b11` and restarted on the existing
database volume. `ODUDU_PUBLIC_BASE_URL` is `http://localhost:3000` and
`ODUDU_CONSOLE` is left at its default, `true`. The base is plain HTTP, so the
cookies are `odudu-console` and `odudu-console-login`; over `https` they are
`__Host-odudu-console` and `__Host-odudu-console-login` and carry `Secure`.
The image ships no console build, so `ODUDU_CONSOLE_DIR` (`/app/console`)
is absent, and the server logged this at boot:

```
{"level":40,"time":1790584821244,"pid":1,"hostname":"f60df0638a98","msg":"ODUDU_CONSOLE_DIR (/app/console) has no console build (ENOENT); /console/* answers 503"}
```

**The tenant.** Every cookie, code and token below belongs to a throwaway
tenant, `console-paths`, seeded for this capture and holding nothing else.
It was created with the seed CLI, which printed one JSON line per command.
Node's `ExperimentalWarning` lines on stderr are left out.

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name console-paths
docker compose exec -T odudu node dist/main.js seed user --tenant console-paths \
  --username grace --password console-paths-throwaway --email grace@example.com
docker compose exec -T odudu node dist/main.js seed grant-role --tenant console-paths \
  --username grace --role odudu-admin:tenant-admin
docker compose exec -T odudu node dist/main.js seed user --tenant console-paths \
  --username hopper --password console-paths-throwaway-2 --email hopper@example.com
```

```
{"command":"tenant","created":true,"tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad"}
{"command":"user","tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","username":"grace","userSubjectId":"01a0e72d-5ba9-78cd-b877-7ea6d4076028"}
{"command":"grant-role","tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","username":"grace","role":"odudu-admin:tenant-admin"}
{"command":"user","tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","username":"hopper","userSubjectId":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4"}
```

`grace` is the administrator; `hopper` is there so that a list has a second
page. The sections are in the order they ran, one curl cookie jar (`jar`)
throughout, so each section's cookies are the ones the section before it set.

## `GET /console/auth/login`

The console's sign-in starts here. `return_to` is where the callback sends
the browser afterwards, and must be a `/console/` path.

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e72d-ea04-7282-8dc9-3af273010688
cache-control: no-store
set-cookie: odudu-console-login=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.QX8ZO1RY_J1MdKom93WTJYF874v-TWgyQF-9GWMpJf8; HttpOnly; SameSite=Lax; Path=/; Max-Age=600
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.QX8ZO1RY_J1MdKom93WTJYF874v-TWgyQF-9GWMpJf8&nonce=Iu7RcG35u2Acqx5ZYXRj50xMj9Z-5JLRekmu_Gl7xu4&code_challenge=85kIqtAnRk5vtMhBLPO1ESw8ZT3LFu2lpM_DyBsf9Ik&code_challenge_method=S256
content-length: 0
Date: Mon, 28 Sep 2026 08:42:21 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The login cookie's value is the `state` sent to the authorization endpoint:
`<tenant id>.<secret>`. The pending sign-in is stored with the secret's
hash, the PKCE verifier and the nonce, and lasts 600 seconds.

## The tenant's own sign-in

The two requests between the gateway's redirect and its callback are the
tenant's authorization endpoint and sign-in form, which
[docs/request-paths.md](request-paths.md) documents. They are shown here
only so that the callback below has a real code. `$LOCATION` is the
`location` above.

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

The page continues with the passkey form and its script; the block stops
at the end of the password form.

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-09f7-77aa-a996-e618997f7db7
content-type: text/html
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'nonce-tyfof1AM/8wyexzftgesTg=='; connect-src 'self'
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 2399
Date: Mon, 28 Sep 2026 08:42:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign in</title></head>
<body>
<form method="post" action="/tenants/console-paths/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a0e72e-0a14-7505-a470-fd32e77345dc">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
```

```bash
curl -sS -D - -c jar -b jar -X POST \
  --data-urlencode auth_session_id=01a0e72e-0a14-7505-a470-fd32e77345dc \
  --data-urlencode username=grace \
  --data-urlencode password=console-paths-throwaway \
  http://localhost:3000/tenants/console-paths/login-actions/authenticate
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e72e-3796-7841-8752-72a59e5d72cb
set-cookie: console-paths-session=01a0e72e-3808-7bef-8f57-394610408e70:CP38HIV14ZO84bJpsu6itvrkWnj4cBo2fOR8C2ak1UI; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=n2sRc5BYkphXp5S4PDd0qrGoydIFOJPoL38nChtbg0s&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.QX8ZO1RY_J1MdKom93WTJYF874v-TWgyQF-9GWMpJf8&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
content-length: 0
Date: Mon, 28 Sep 2026 08:42:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

`console-paths-session` is the tenant's SSO cookie. The logout below needs
the browser to send it.

## `GET /console/auth/callback`

`$LOCATION` is the `location` above.

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e72e-5420-7794-970f-f1cffaac46aa
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.haC6Ej3Vxp88GHIxzZDnwLrUhG4kP5C4hl4Ieh7MZmo; HttpOnly; SameSite=Strict; Path=/
location: /console/x
content-length: 0
Date: Mon, 28 Sep 2026 08:42:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The callback checked the login cookie against `state`, took the pending
sign-in, compared `iss` with the tenant's discovered issuer, exchanged the
code, and verified the ID token and its nonce. It then cleared the login
cookie, set the session cookie and redirected to `return_to`. The session
cookie is `<tenant id>.<secret>` again, and only the secret's SHA-256 is
stored. The tokens stay in the `console_sessions` row, wrapped under the KEK,
and none of them reaches the browser.

## `GET /console/api/session`

```bash
curl -sS -D - -c jar -b jar http://localhost:3000/console/api/session
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-5492-7d1e-9398-de4367265c35
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 97
Date: Mon, 28 Sep 2026 08:42:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"tenant":"console-paths","subject_id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","username":"grace"}
```

## `GET /console/api/admin/tenants/{tenant}/subjects`

Anything under `/console/api/admin/` is forwarded to `/admin/` with the
session's access token. `limit=1` gives the list a second page, so the
admin API answers with a `Link` header.

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/api/admin/tenants/console-paths/subjects?limit=1'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-766f-72b0-a1cb-56965abcda92
content-type: application/json; charset=utf-8
link: </console/api/admin/tenants/console-paths/subjects?limit=1&cursor=eyJhZnRlciI6IjAxYTBlNzJkLTViYTktNzhjZC1iODc3LTdlYTZkNDA3NjAyOCIsImNvbGxlY3Rpb24iOiJzdWJqZWN0cyIsInRlbmFudElkIjoiMDFhMGU3MmQtNTkyNy03M2MzLWIxNGQtYTViNjBkMWNhOWFkIiwiZmlsdGVycyI6IlQxUE5vWXdycWd3RFZMdGZtajdMNWUwU3EwMk9FYnFIUEM4UkZoSUN1VVUifQ.wxCYgMzM9KahHxwDlrS6SAK5sacypLuVFOf9quYa9S8>; rel="next"
cache-control: no-store
content-length: 465
Date: Mon, 28 Sep 2026 08:42:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-09-28T08:41:44.607Z"}],"next":"eyJhZnRlciI6IjAxYTBlNzJkLTViYTktNzhjZC1iODc3LTdlYTZkNDA3NjAyOCIsImNvbGxlY3Rpb24iOiJzdWJqZWN0cyIsInRlbmFudElkIjoiMDFhMGU3MmQtNTkyNy03M2MzLWIxNGQtYTViNjBkMWNhOWFkIiwiZmlsdGVycyI6IlQxUE5vWXdycWd3RFZMdGZtajdMNWUwU3EwMk9FYnFIUEM4UkZoSUN1VVUifQ.wxCYgMzM9KahHxwDlrS6SAK5sacypLuVFOf9quYa9S8"}
```

The admin API sent `Link: </admin/tenants/console-paths/subjects?…>`, and the
gateway rewrote it to `/console/api/admin/`. Following it through the proxy
reaches the second page. `$NEXT` is the path inside the `<…>` above.

```bash
curl -sS -D - -c jar -b jar "http://localhost:3000$NEXT"
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-769f-7f59-94db-cc4723f16d15
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 175
Date: Mon, 28 Sep 2026 08:42:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4","type":"user","username":"hopper","email":"hopper@example.com","enabled":true,"created_at":"2026-09-28T08:41:53.858Z"}]}
```

## `PATCH /console/api/admin/tenants/{tenant}/subjects/{id}`

`If-Match` is one of the four request headers the proxy forwards. The
`ETag` comes from a read.

```bash
curl -sS -D - -c jar -b jar \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-a2d8-7154-a915-65d48917d8d0
content-type: application/json; charset=utf-8
etag: "e0e294cbbb3a1a76ae2d1962269e63e5016b9ac6c24613abe0a66c650dc679be"
cache-control: no-store
content-length: 163
Date: Mon, 28 Sep 2026 08:43:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4","type":"user","username":"hopper","email":"hopper@example.com","enabled":true,"created_at":"2026-09-28T08:41:53.858Z"}
```

A write under `/console/api/` must carry the base's `Origin` and
`X-Odudu-Console: 1` (see the next section).

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "e0e294cbbb3a1a76ae2d1962269e63e5016b9ac6c24613abe0a66c650dc679be"' \
  -d '{"email":"grace.hopper@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-a301-79f6-a905-0741fa0e45b1
content-type: application/json; charset=utf-8
etag: "219b14ef842053287d0395ac35365010a07eab13df970d5720b5e954e15d2a30"
cache-control: no-store
content-length: 169
Date: Mon, 28 Sep 2026 08:43:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4","type":"user","username":"hopper","email":"grace.hopper@example.com","enabled":true,"created_at":"2026-09-28T08:41:53.858Z"}
```

The same `If-Match` again, which that write made stale. The `412` is the
admin API's own, passed back unchanged:

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "e0e294cbbb3a1a76ae2d1962269e63e5016b9ac6c24613abe0a66c650dc679be"' \
  -d '{"enabled":false}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
```

```
HTTP/1.1 412 Precondition Failed
x-request-id: 01a0e72e-a32c-778f-803e-38c9877c381f
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 153
Date: Mon, 28 Sep 2026 08:43:08 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0e72e-a32e-7382-be1e-f970635fae6e"}
```

## `POST /console/api/admin/tenants/{tenant}/subjects`, refused as cross-site

A request to `/console/api/` or `/console/auth/` other than `GET`, `HEAD`
or `OPTIONS` is refused `403` before anything else runs, unless it carries
`Origin` equal to the base's origin and `X-Odudu-Console: 1`. All three
requests below have the same valid session cookie and the same body. The
first sends another origin:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: https://evil.example' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -d '{"username":"lovelace","email":"lovelace@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a0e72e-d2b3-71f6-a0b0-6aa71e18ec97
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 165
Date: Mon, 28 Sep 2026 08:43:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank#forbidden","title":"Forbidden","detail":"refused as cross-site: origin-mismatch","instance":"01a0e72e-d2b3-71f6-a0b0-6aa71e18ec97"}
```

The second sends the right origin without the console's header:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  -d '{"username":"lovelace","email":"lovelace@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a0e72e-d2c2-74d7-83a4-315c9c9080f6
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 172
Date: Mon, 28 Sep 2026 08:43:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank#forbidden","title":"Forbidden","detail":"refused as cross-site: console-header-missing","instance":"01a0e72e-d2c2-74d7-83a4-315c9c9080f6"}
```

The third sends both, and is forwarded. This shows the two refusals above
were the gateway's, not the admin API refusing the body or the session:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -d '{"username":"lovelace","email":"lovelace@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects
```

```
HTTP/1.1 201 Created
x-request-id: 01a0e72e-d2ce-7cde-b2b5-8469e690886f
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 167
Date: Mon, 28 Sep 2026 08:43:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72e-d2f9-7a02-8e77-615c6b2395fa","type":"user","username":"lovelace","email":"lovelace@example.com","enabled":true,"created_at":"2026-09-28T08:43:20.696Z"}
```

## `POST /console/auth/logout`

Sent with no body. The same CSRF guard applies here.

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  http://localhost:3000/console/auth/logout
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e72e-f75d-7f9a-aeac-318e9b76f8bd
cache-control: no-store
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/json; charset=utf-8
content-length: 985
Date: Mon, 28 Sep 2026 08:43:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"redirect":"http://localhost:3000/tenants/console-paths/protocol/openid-connect/logout?id_token_hint=eyJhbGciOiJSUzI1NiIsImtpZCI6IjAxYTBlNzJkLTU5OTEtNzE1Ny1iYWJhLTc3Y2EwNDZkYzgzNyJ9.eyJzdWIiOiIwMWEwZTcyZC01YmE5LTc4Y2QtYjg3Ny03ZWE2ZDQwNzYwMjgiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zb2xlLXBhdGhzIiwiYXVkIjoib2R1ZHUtYWRtaW4iLCJpYXQiOjE3OTA1ODQ5NjgsImV4cCI6MTc5MDU4NTI2OCwibm9uY2UiOiJJdTdSY0czNXUyQWNxeDVaWVhSajUweE1qOVotNUpMUmVrbXVfR2w3eHU0Iiwic2lkIjoiMDFhMGU3MmUtMzgwOC03YmVmLThmNTctMzk0NjEwNDA4ZTcwIiwiYW1yIjpbInB3ZCJdLCJhY3IiOiIxIn0.HhgkPSX4Suf8qDWj6RWQyoG9Z4mZTQlCW9jxAVyHouHJa5IhUzdjO0aRMjUhmRZDNxI8uorKRMIA_B9EEEvPRBFG9bnQrPAm3c19T1G4z0mTh_EHmMTmsKSPLVAMOgacvyx0bICxmYncFZBqSp6NHNWNXba6PObVKd5jeHr09SFTUH9mRHESHaJS4UzSoovboxvNZCuP-oWzcpMzvGkE4nbA9RZWl-abJF3UN27Mv05wjahKjBuAKQmovLaRJcC8KaYC5O1J-c1zOx8c1S32dwhTQ4hW8wcgEUMaUrcWUnAWdWhNEgsOZ6QJD6cvFogexoTAA07h0UXFjb17K2e1Ug&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2F&client_id=odudu-admin"}
```

By the time this answered, the gateway had revoked the session's refresh
token, deleted its `console_sessions` row and cleared its cookie. The
tenant's SSO session is still live. Only the browser's own navigation to
`redirect` carries the SSO cookie, so the SPA follows it itself.

## Following the logout redirect

`$REDIRECT` is the `redirect` above. The jar still holds
`console-paths-session` from the sign-in.

```bash
curl -sS -D - -c jar -b jar "$REDIRECT"
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e72f-19a6-73f2-ba84-d0cf486f9107
set-cookie: console-paths-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:3000/console/
content-length: 0
Date: Mon, 28 Sep 2026 08:43:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

What is left, read from the database as the superuser, with these three
queries in a file piped to
`docker exec -i docker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.
Each query is scoped to this tenant or to the SSO session id
`01a0e72e-3808-…`, the one in the `console-paths-session` cookie and the
ID token's `sid`:

```sql
select count(*) as console_sessions from console_sessions where tenant_id = '01a0e72d-5927-73c3-b14d-a5b60d1ca9ad';
select id, expires_at <= now() as expired from sessions where id = '01a0e72e-3808-7bef-8f57-394610408e70';
select g.session_id, g.revoked_at is not null as revoked from token_grants g join clients c on c.id = g.client_id where g.tenant_id = '01a0e72d-5927-73c3-b14d-a5b60d1ca9ad' and c.client_id = 'odudu-admin';
```

```
 console_sessions
------------------
                0
(1 row)

                  id                  | expired
--------------------------------------+---------
 01a0e72e-3808-7bef-8f57-394610408e70 | t
(1 row)

              session_id              | revoked
--------------------------------------+---------
 01a0e72e-3808-7bef-8f57-394610408e70 | t
(1 row)
```

The console cookie from before the logout, sent again (from a copy of the
jar taken just before the logout), is an ended session:

```bash
curl -sS -D - -b jar-before-logout http://localhost:3000/console/api/session
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a0e72f-4493-7a1a-a3c3-19b9bcfb0175
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 28 Sep 2026 08:43:49 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a0e72f-4493-7a1a-a3c3-19b9bcfb0175"}
```

## `GET /console/`

The logout's `302` lands on the console shell. The image has no built
console, so every path under `/console/` that neither the API nor the
sign-in routes claim answers `503`. The SPA is not built yet; see
[docs/request-paths.md](request-paths.md#what-is-not-implemented). The
shell's headers, its CSP included, are tested against a fixture build in
`apps/server/tests/console-shell.int.test.ts` rather than shown here.

```bash
curl -sS -D - -c jar -b jar http://localhost:3000/console/
```

```
HTTP/1.1 503 Service Unavailable
x-request-id: 01a0e72f-19f7-70dd-a222-d8228a939d36
content-type: text/plain; charset=utf-8
content-length: 25
Date: Mon, 28 Sep 2026 08:43:38 GMT
Connection: keep-alive
Keep-Alive: timeout=72

console build unavailable
```

## What this run does not show

Each item below is tested, not captured, because this run never reached it:

- **A refresh.** An access token is refreshed only within 30 s of expiry,
  and every request above ran on the code exchange's token. The single
  refresh per session, the `502` on a token-endpoint failure or a lock wait
  over 5 s, and the session-ended `401` on a refused refresh are in
  `apps/server/tests/console-proxy.int.test.ts`.
- **A path that escapes `/admin/`**, such as `/console/api/admin/%2e%2e/…`,
  which the proxy refuses with `404` before forwarding anything. Also in
  `apps/server/tests/console-proxy.int.test.ts`, both through `inject` and
  over a real socket.
- **A refused callback**, and the `302` to `/console/?login_error=<code>`
  after an error from the authorization endpoint. These are in
  `apps/server/tests/console-login.int.test.ts`.
- **The `__Host-` cookies**, which need an `https` base. These are in
  `apps/server/tests/console-session.int.test.ts`.
