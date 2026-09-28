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
restarted on the existing database volume. For the first two runs its `odudu`
service was built at commit `5fd4b11`; for the third it was rebuilt at
`6401476`. `ODUDU_PUBLIC_BASE_URL` is `http://localhost:3000` and
`ODUDU_CONSOLE` is left at its default, `true`. The base is plain HTTP, so the
cookies are `odudu-console` and `odudu-console-login`; over `https` they are
`__Host-odudu-console` and `__Host-odudu-console-login` and carry `Secure`.
The image built at those commits shipped no console build, so
`ODUDU_CONSOLE_DIR` (`/app/console`) was absent; the image has carried one
since `78826ac`, and [`GET /console/`](#get-console) was captured against
that build. The server logged these warnings when it booted for the third run.
The second line is the console cookie's plain-HTTP fallback, and the third
is the missing build:

```
{"level":40,"time":1790590008355,"pid":1,"hostname":"062313e900ce","msg":"authn-flows: serving session cookies without the __Host- prefix because TLS is off. This is expected for local development only — never in production."}
{"level":40,"time":1790590008355,"pid":1,"hostname":"062313e900ce","msg":"console: serving the odudu-console cookie without the __Host- prefix or Secure, because ODUDU_PUBLIC_BASE_URL (http://localhost:3000) is http. This is expected for local development only."}
{"level":40,"time":1790590008445,"pid":1,"hostname":"062313e900ce","msg":"ODUDU_CONSOLE_DIR (/app/console) has no console build (ENOENT); /console/* answers 503"}
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

Four sections come from **a second run**, twenty minutes after the first, on
the same container and tenant, with a new, empty `jar` and a new sign-in:
the refused callbacks, the path that escapes `/admin/`, the refresh and the
refresh that cannot take the lock, run in that order. Each says so in its
first line. The first run had left the tenant no `console_sessions` row, as
its last query shows.

Three sections come from **a third run**, at `6401476`, on the same tenant,
with a new, empty `jar` and a new sign-in: the `PATCH`, the cross-site
refusals and the refresh the server refuses. Each says so in its first line.
Between the second and third runs the gateway changed in four ways. It now
sends the console request's own `x-request-id` upstream. It answers its
cross-site `403` with the admin API's `about:blank` type. It ends a session
on any `401` the admin API answers, with no confirm against the session's
own tenant. And it revokes the grant of a session it finds over. The first
two runs' sections were not re-run at `6401476`. The only
change in what they show would be the `request_id` in the refresh sections'
audit rows, which predate the first change.

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

## `GET /console/auth/callback`, refused

From the second run. It signed in as the first run did, with the same
`login`, authorization-endpoint and `authenticate` requests; the two that
set what this section uses answered:

```
HTTP/1.1 302 Found
x-request-id: 01a0e740-cbe4-73a4-b368-87f79787f406
cache-control: no-store
set-cookie: odudu-console-login=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dM8FyhoJLRwaXvAcMLV-gpEdj-h3ZXpxom7_PcIWcUY; HttpOnly; SameSite=Lax; Path=/; Max-Age=600
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dM8FyhoJLRwaXvAcMLV-gpEdj-h3ZXpxom7_PcIWcUY&nonce=inB4oeD2LGFfK9sZ4pRc2B9X9_dr6-7491ikkBQVeds&code_challenge=ccgs9I0-exnmcWELhDzk0EcUHEUvfIO3lFy2uHHeVmA&code_challenge_method=S256
content-length: 0
Date: Mon, 28 Sep 2026 09:02:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e741-0d3a-7b29-a113-77c194ddb583
set-cookie: console-paths-session=01a0e741-0d89-724a-b675-8a86b18260ba:mfT66x18qplXy4Bllzeb0RgQetsFvoepwSNfNmALat4; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=5XkP0a7ZCxb_UMuoocehlzQyG3L9n3eHtnMkMg5vZxQ&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dM8FyhoJLRwaXvAcMLV-gpEdj-h3ZXpxom7_PcIWcUY&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
content-length: 0
Date: Mon, 28 Sep 2026 09:03:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A copy of the jar, `jar-before-callback`, was taken here. A refused callback
clears the login cookie, so each refused request below is sent without
`-c`, and the jar it reads still holds the login cookie.

**A `state` that does not match the login cookie.** The code and `iss` are
the real ones; the `state` keeps the tenant half and replaces the secret:

```bash
curl -sS -D - -b jar 'http://localhost:3000/console/auth/callback?code=5XkP0a7ZCxb_UMuoocehlzQyG3L9n3eHtnMkMg5vZxQ&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.not-the-login-cookie&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e741-390e-7091-bf83-07e31b252605
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 187
Date: Mon, 28 Sep 2026 09:03:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body>
<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
</body>
</html>
```

A mismatched `state` is refused before the pending sign-in is read, so the
pending sign-in and the code both survived it. The real callback, with the
same code, then signed in:

```bash
curl -sS -D - -c jar -b jar 'http://localhost:3000/console/auth/callback?code=5XkP0a7ZCxb_UMuoocehlzQyG3L9n3eHtnMkMg5vZxQ&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dM8FyhoJLRwaXvAcMLV-gpEdj-h3ZXpxom7_PcIWcUY&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e741-59d5-79b5-b13f-4b6ef887c835
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dB3bP0KksZ4nMzHuO9BJi2pCn-9Ge4_pHfpkgSMrDQI; HttpOnly; SameSite=Strict; Path=/
location: /console/x
content-length: 0
Date: Mon, 28 Sep 2026 09:03:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

**The same callback again.** The copy of the jar still holds the login
cookie, and its value is the `state` being replayed, so the refusal below
is not the missing or mismatched cookie refused above:

```bash
grep odudu-console-login jar-before-callback | cut -f6,7
```

```
odudu-console-login	01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dM8FyhoJLRwaXvAcMLV-gpEdj-h3ZXpxom7_PcIWcUY
```

```bash
curl -sS -D - -b jar-before-callback 'http://localhost:3000/console/auth/callback?code=5XkP0a7ZCxb_UMuoocehlzQyG3L9n3eHtnMkMg5vZxQ&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.dM8FyhoJLRwaXvAcMLV-gpEdj-h3ZXpxom7_PcIWcUY&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e741-88cb-725c-8b08-0e2f2773ca7b
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 187
Date: Mon, 28 Sep 2026 09:03:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body>
<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
</body>
</html>
```

The first callback took the pending sign-in, so the replay found none and
was refused before the code was presented again.

**An error from the authorization endpoint.** A new sign-in gave a new
login cookie and `state`:

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e741-a7d9-7a8b-9954-884464ed0bc8
cache-control: no-store
set-cookie: odudu-console-login=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.LQ36gGqeZQx-EjuRFtt7o9mUFB4QkwRJRCROC9wESTo; HttpOnly; SameSite=Lax; Path=/; Max-Age=600
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.LQ36gGqeZQx-EjuRFtt7o9mUFB4QkwRJRCROC9wESTo&nonce=pcd5eoUxYu76CbdxKeaPz1A5PaJjVBUHidls9nErraI&code_challenge=HWdl9bQiMkQIYgkZeI7AUGsJjlm5vXB20XleoMvHVEk&code_challenge_method=S256
content-length: 0
Date: Mon, 28 Sep 2026 09:03:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The callback an authorization endpoint sends when the user refuses, with
that pending `state` and its login cookie:

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/callback?error=access_denied&state=01a0e72d-5927-73c3-b14d-a5b60d1ca9ad.LQ36gGqeZQx-EjuRFtt7o9mUFB4QkwRJRCROC9wESTo'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e741-ccd5-7a04-a3e7-111123c5bf6e
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: /console/?login_error=access_denied
content-length: 0
Date: Mon, 28 Sep 2026 09:04:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The gateway took the pending sign-in and cleared its cookie.

What the tenant held afterwards, with the same `psql` as the first run's
closing queries and the same trimmed header spaces:

```sql
select id, created_at from console_sessions where tenant_id = '01a0e72d-5927-73c3-b14d-a5b60d1ca9ad';
select count(*) as console_logins from console_logins where tenant_id = '01a0e72d-5927-73c3-b14d-a5b60d1ca9ad';
```

```
                  id                  |         created_at
--------------------------------------+----------------------------
 01a0e741-5a28-749e-908e-9382b6129149 | 2026-09-28 09:03:34.869+00
(1 row)

 console_logins
----------------
              0
(1 row)
```

One session, created at 09:03:34 by the callback that signed in. The two
refusals and the error callback created none, and no pending sign-in is
left. That session is the one every later second-run section uses.

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

From the third run, on its session. `If-Match` is one of the four request
headers the proxy forwards. The `ETag` comes from a read.

```bash
curl -sS -D - -c jar -b jar \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e77b-de54-75ca-b651-6963d6c13426
content-type: application/json; charset=utf-8
etag: "219b14ef842053287d0395ac35365010a07eab13df970d5720b5e954e15d2a30"
cache-control: no-store
content-length: 169
Date: Mon, 28 Sep 2026 10:07:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4","type":"user","username":"hopper","email":"grace.hopper@example.com","enabled":true,"created_at":"2026-09-28T08:41:53.858Z"}
```

A write under `/console/api/` must carry the base's `Origin` and
`X-Odudu-Console: 1` (see the next section). The first run had changed this
address, so this write puts it back.

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "219b14ef842053287d0395ac35365010a07eab13df970d5720b5e954e15d2a30"' \
  -d '{"email":"hopper@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e77b-de8a-742b-b05b-bbadf4c187fe
content-type: application/json; charset=utf-8
etag: "e0e294cbbb3a1a76ae2d1962269e63e5016b9ac6c24613abe0a66c650dc679be"
cache-control: no-store
content-length: 163
Date: Mon, 28 Sep 2026 10:07:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4","type":"user","username":"hopper","email":"hopper@example.com","enabled":true,"created_at":"2026-09-28T08:41:53.858Z"}
```

The same `If-Match` again, which that write made stale. The `412` is the
admin API's own, passed back unchanged. Its `instance` is the `x-request-id`
the browser was answered with, because the gateway sends that id upstream:

```bash
curl -sS -D - -c jar -b jar -X PATCH \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "219b14ef842053287d0395ac35365010a07eab13df970d5720b5e954e15d2a30"' \
  -d '{"enabled":false}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
```

```
HTTP/1.1 412 Precondition Failed
x-request-id: 01a0e77b-deb5-7134-a6c8-1564eed93a82
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 153
Date: Mon, 28 Sep 2026 10:07:29 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0e77b-deb5-7134-a6c8-1564eed93a82"}
```

The write's audit row, read through the proxy for the second in which the
three requests ran, carries the `PATCH`'s own `x-request-id` as its
`request_id`:

```bash
curl -sS -D - -b jar \
  'http://localhost:3000/console/api/admin/tenants/console-paths/audit?from=2026-09-28T10:07:29Z&to=2026-09-28T10:07:30Z'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e77c-115f-7f9a-a6b6-8402f7575e23
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 580
Date: Mon, 28 Sep 2026 10:07:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e77b-dea5-777b-926e-7ef515714f64","occurred_at":"2026-09-28T10:07:29.949Z","event_type":"admin_mutation","action":"subject.amend","outcome":"allowed","actor_tenant_id":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","actor_subject_id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","actor_client_id":"01a0e72d-599e-701c-87a2-7672d411bed2","resource_type":"subject","resource_id":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4","request_id":"01a0e77b-de8a-742b-b05b-bbadf4c187fe","ip":"172.20.0.1","detail":{"email":{"after":"hopper@example.com","before":"grace.hopper@example.com"}}}]}
```

## `POST /console/api/admin/tenants/{tenant}/subjects`, refused as cross-site

From the third run, on its session. A request to `/console/api/` or
`/console/auth/` other than `GET`, `HEAD` or `OPTIONS` is refused `403`
before anything else runs, unless it carries `Origin` equal to the base's
origin and `X-Odudu-Console: 1`. The refusal has the admin API's own `403`
type, `about:blank`, and says why in `detail`. All three requests below
have the same valid session cookie and the same body. The first sends
another origin:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: https://evil.example' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -d '{"username":"babbage","email":"babbage@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a0e77c-1115-752e-ab58-bc1bf912de00
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 155
Date: Mon, 28 Sep 2026 10:07:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank","title":"Forbidden","detail":"refused as cross-site: origin-mismatch","instance":"01a0e77c-1115-752e-ab58-bc1bf912de00"}
```

The second sends the right origin without the console's header:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  -d '{"username":"babbage","email":"babbage@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a0e77c-1122-7841-9077-d3d8d06c3f29
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 162
Date: Mon, 28 Sep 2026 10:07:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank","title":"Forbidden","detail":"refused as cross-site: console-header-missing","instance":"01a0e77c-1122-7841-9077-d3d8d06c3f29"}
```

The third sends both, and is forwarded. This shows the two refusals above
were the gateway's, not the admin API refusing the body or the session:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -d '{"username":"babbage","email":"babbage@example.com"}' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects
```

```
HTTP/1.1 201 Created
x-request-id: 01a0e77c-1133-763b-a47a-001dca14a43f
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 165
Date: Mon, 28 Sep 2026 10:07:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e77c-1143-7905-8e81-8c9b7d67635a","type":"user","username":"babbage","email":"babbage@example.com","enabled":true,"created_at":"2026-09-28T10:07:42.915Z"}
```

## A path that escapes `/admin/`

From the second run, on its session. The proxy resolves the path it would
forward, dot segments and their percent-encoded form included, and refuses
`404` before reading the session when the result is outside `/admin/`.
`--path-as-is` stops curl from resolving the dot segments itself. Both
requests were sent between the two timestamps printed around them:

```bash
node -e 'console.log(new Date().toISOString())'
curl --path-as-is -sS -D - -b jar 'http://localhost:3000/console/api/admin/%2e%2e/tenants/console-paths/protocol/openid-connect/token'
curl --path-as-is -sS -D - -b jar 'http://localhost:3000/console/api/admin/../tenants/console-paths/protocol/openid-connect/token'
node -e 'console.log(new Date().toISOString())'
```

```
2026-09-28T09:04:13.850Z
HTTP/1.1 404 Not Found
x-request-id: 01a0e741-f233-7329-b0e0-5fd2a413d773
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 115
Date: Mon, 28 Sep 2026 09:04:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":404,"type":"about:blank#not-found","title":"Not Found","instance":"01a0e741-f233-7329-b0e0-5fd2a413d773"}
HTTP/1.1 404 Not Found
x-request-id: 01a0e741-f240-7a00-8b03-5531fda52ef8
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 115
Date: Mon, 28 Sep 2026 09:04:13 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":404,"type":"about:blank#not-found","title":"Not Found","instance":"01a0e741-f240-7a00-8b03-5531fda52ef8"}
2026-09-28T09:04:13.918Z
```

The admin API's audit trail for that window, read through the proxy on the
same session, is empty:

```bash
curl -sS -D - -b jar \
  'http://localhost:3000/console/api/admin/tenants/console-paths/audit?from=2026-09-28T09:04:13.850Z&to=2026-09-28T09:04:13.918Z'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e742-a8da-7abf-8bce-3c843cc365d0
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 12
Date: Mon, 28 Sep 2026 09:05:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
```

An empty audit trail alone proves little, since a forwarded `GET` writes no
audit row. What does prove it is the server's request log, which records a
forwarded call as a request of its own. The proxy's `404` is byte-identical
to the one the gateway answers for an unknown `/console/api/` path, so a
third request shows which route took these paths: the same `%2e%2e` form,
resolving back inside `/admin/`, between two more timestamps.

```bash
node -e 'console.log(new Date().toISOString())'
curl --path-as-is -sS -D - -b jar \
  'http://localhost:3000/console/api/admin/%2e%2e/admin/tenants/console-paths/subjects?limit=1'
node -e 'console.log(new Date().toISOString())'
```

```
2026-09-28T09:04:42.087Z
HTTP/1.1 200 OK
x-request-id: 01a0e742-6084-7ca6-a3a2-815d725c5921
content-type: application/json; charset=utf-8
link: </console/api/admin/tenants/console-paths/subjects?limit=1&cursor=eyJhZnRlciI6IjAxYTBlNzJkLTViYTktNzhjZC1iODc3LTdlYTZkNDA3NjAyOCIsImNvbGxlY3Rpb24iOiJzdWJqZWN0cyIsInRlbmFudElkIjoiMDFhMGU3MmQtNTkyNy03M2MzLWIxNGQtYTViNjBkMWNhOWFkIiwiZmlsdGVycyI6IlQxUE5vWXdycWd3RFZMdGZtajdMNWUwU3EwMk9FYnFIUEM4UkZoSUN1VVUifQ.wxCYgMzM9KahHxwDlrS6SAK5sacypLuVFOf9quYa9S8>; rel="next"
cache-control: no-store
content-length: 465
Date: Mon, 28 Sep 2026 09:04:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-09-28T08:41:44.607Z"}],"next":"eyJhZnRlciI6IjAxYTBlNzJkLTViYTktNzhjZC1iODc3LTdlYTZkNDA3NjAyOCIsImNvbGxlY3Rpb24iOiJzdWJqZWN0cyIsInRlbmFudElkIjoiMDFhMGU3MmQtNTkyNy03M2MzLWIxNGQtYTViNjBkMWNhOWFkIiwiZmlsdGVycyI6IlQxUE5vWXdycWd3RFZMdGZtajdMNWUwU3EwMk9FYnFIUEM4UkZoSUN1VVUifQ.wxCYgMzM9KahHxwDlrS6SAK5sacypLuVFOf9quYa9S8"}
2026-09-28T09:04:42.251Z
```

The request log for each window, the escapes' first:

```bash
docker logs --since 2026-09-28T09:04:13.850Z --until 2026-09-28T09:04:13.918Z docker-odudu-1 2>&1 \
  | jq -c 'select(.msg == "incoming request") | [.req.method, .req.url]'
docker logs --since 2026-09-28T09:04:42.087Z --until 2026-09-28T09:04:42.251Z docker-odudu-1 2>&1 \
  | jq -c 'select(.msg == "incoming request") | [.req.method, .req.url]'
```

```
["GET","/console/api/admin/%2e%2e/tenants/console-paths/protocol/openid-connect/token"]
["GET","/console/api/admin/../tenants/console-paths/protocol/openid-connect/token"]
```

```
["GET","/console/api/admin/%2e%2e/admin/tenants/console-paths/subjects"]
["GET","/admin/tenants/console-paths/subjects"]
```

The two escapes reached the server and nothing followed them. The third
request was followed by its forward to `/admin/`.

## A refresh

From the second run, on its session, `01a0e741-5a28-…`. Every request above
ran on an access token with more than 30 s left. The gateway refreshes
before forwarding when less is left, and the token lives 300 s, so this
section waited until the stored expiry was 18 s away. These ran one after
another, `$FROM` being the timestamp printed first:

```bash
node -e 'console.log(new Date().toISOString())'
curl -sS -D - -b jar \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-5ba9-78cd-b877-7ea6d4076028
curl -sS -D - -b jar \
  "http://localhost:3000/console/api/admin/tenants/console-paths/audit?event_type=token&from=$FROM"
curl -sS -D - -b jar \
  "http://localhost:3000/console/api/admin/tenants/console-paths/audit?action=grant.revoked_on_reuse&from=$FROM"
```

with this query, through the same `psql`, run before the `GET` and again
after it:

```sql
select access_expires_at, access_expires_at - now() as remaining from console_sessions where id = '01a0e741-5a28-749e-908e-9382b6129149';
```

Before:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-09-28 09:08:34.869+00 | 00:00:18.238342
(1 row)
```

`$FROM`, then the `GET`:

```
2026-09-28T09:08:16.679Z
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e745-a6bb-78aa-b182-6b87b290896d
content-type: application/json; charset=utf-8
etag: "c50e0060774baca49d598875d211f5ea891a6755d4c36f6107205c5301e08af9"
cache-control: no-store
content-length: 161
Date: Mon, 28 Sep 2026 09:08:16 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-09-28T08:41:44.607Z"}
```

After, the expiry is 300 s from the refresh:

```
    access_expires_at     |    remaining
--------------------------+-----------------
 2026-09-28 09:13:16.7+00 | 00:04:59.794902
(1 row)
```

The tenant's `token` audit rows since `$FROM` are one `token.refresh`, on
the grant the sign-in created:

```
HTTP/1.1 200 OK
x-request-id: 01a0e745-a79a-7d60-9932-578111766527
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 511
Date: Mon, 28 Sep 2026 09:08:16 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e745-a710-745c-a343-2ef6e3ea689b","occurred_at":"2026-09-28T09:08:16.761Z","event_type":"token","action":"token.refresh","outcome":"allowed","actor_tenant_id":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","actor_subject_id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","actor_client_id":"01a0e72d-599e-701c-87a2-7672d411bed2","resource_type":"grant","resource_id":"01a0e741-5a0b-706e-8ae5-3f10ef8a7447","request_id":"01a0e745-a6ce-761b-b162-9a095086871d","ip":"172.20.0.1","detail":{"scope":"openid"}}]}
```

and the refresh token was presented once, since reuse detection revoked
nothing:

```
HTTP/1.1 200 OK
x-request-id: 01a0e745-a7b2-78d5-919f-238160cd4bb4
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 12
Date: Mon, 28 Sep 2026 09:08:16 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
```

## A refresh that cannot take the lock

From the second run, on its session, about 4.5 minutes after the refresh
above. A refresh holds the session's row lock, waiting at most 5 s for it,
so that two refreshes of one session never present its refresh token
twice. Here `psql` holds that lock for 12 s while a request that needs a
refresh arrives. The lock is taken by this file, `q-lock.sql`, through the
same `psql`:

```sql
BEGIN;
SELECT id, clock_timestamp() AS locked_at FROM console_sessions WHERE id = '01a0e741-5a28-749e-908e-9382b6129149' FOR UPDATE;
SELECT pg_sleep(12);
SELECT clock_timestamp() AS releasing_at;
COMMIT;
```

The steps, in order: the expiry query from the section above; `$FROM`;
the lock file started in the background; one second later the `GET`, with
curl printing its total time; then, once `psql` had committed, the same
`GET`, the expiry query, and the `token` audit rows since `$FROM`.

```bash
node -e 'console.log(new Date().toISOString())'
docker exec -i docker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-lock.sql &
sleep 1
curl -sS -D - -w 'time_total: %{time_total}\n' -b jar \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-5ba9-78cd-b877-7ea6d4076028
wait
curl -sS -D - -b jar \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-5ba9-78cd-b877-7ea6d4076028
curl -sS -D - -b jar \
  "http://localhost:3000/console/api/admin/tenants/console-paths/audit?event_type=token&from=$FROM"
```

Before, the token was inside the refresh window:

```
    access_expires_at     |   remaining
--------------------------+----------------
 2026-09-28 09:13:16.7+00 | 00:00:24.50695
(1 row)
```

```
2026-09-28T09:12:52.238Z
```

The lock, held from 09:12:52.31 to 09:13:04.34. The `pg_sleep` value line
is a single space, trimmed below like the header spaces:

```
BEGIN
                  id                  |           locked_at
--------------------------------------+-------------------------------
 01a0e741-5a28-749e-908e-9382b6129149 | 2026-09-28 09:12:52.309939+00
(1 row)

 pg_sleep
----------

(1 row)

         releasing_at
-------------------------------
 2026-09-28 09:13:04.335897+00
(1 row)

COMMIT
```

The `GET` sent while it was held waited 5 s for the lock and was answered
`502`, at 09:12:58, inside the lock's twelve seconds. curl's `time_total`
follows the body on the same line, since the body ends without a newline:

```
HTTP/1.1 502 Bad Gateway
x-request-id: 01a0e749-df15-7dbe-b907-884d3f3c8f06
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 107
Date: Mon, 28 Sep 2026 09:12:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":502,"type":"about:blank","title":"Bad Gateway","instance":"01a0e749-df15-7dbe-b907-884d3f3c8f06"}time_total: 5.108921
```

The session was kept. The `GET` after the commit refreshed and was
forwarded:

```
HTTP/1.1 200 OK
x-request-id: 01a0e74a-0a6f-7b2c-a0ae-7c071decec61
content-type: application/json; charset=utf-8
etag: "c50e0060774baca49d598875d211f5ea891a6755d4c36f6107205c5301e08af9"
cache-control: no-store
content-length: 161
Date: Mon, 28 Sep 2026 09:13:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","type":"user","username":"grace","email":"grace@example.com","enabled":true,"created_at":"2026-09-28T08:41:44.607Z"}
```

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-09-28 09:18:04.367+00 | 00:04:59.799211
(1 row)
```

Since `$FROM` there is one `token.refresh`, the one after the commit. The
request that timed out on the lock never reached the token endpoint:

```
HTTP/1.1 200 OK
x-request-id: 01a0e74a-0b4f-77e3-b5d8-2b5d42acd4ca
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 511
Date: Mon, 28 Sep 2026 09:13:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e74a-0a95-71ab-ad6b-de15e65bb772","occurred_at":"2026-09-28T09:13:04.396Z","event_type":"token","action":"token.refresh","outcome":"allowed","actor_tenant_id":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","actor_subject_id":"01a0e72d-5ba9-78cd-b877-7ea6d4076028","actor_client_id":"01a0e72d-599e-701c-87a2-7672d411bed2","resource_type":"grant","resource_id":"01a0e741-5a0b-706e-8ae5-3f10ef8a7447","request_id":"01a0e74a-0a7b-7f8e-9764-6e7e42b23b8d","ip":"172.20.0.1","detail":{"scope":"openid"}}]}
```

The second run's session was not logged out, so its `console_sessions` row
is still there. It is the same throwaway tenant's, and it ends idle 30
minutes later.

## A refresh the server refuses

From the third run, on its session `01a0e77b-b064-…`, straight after the
cross-site section. Its grant is revoked through the console itself, by
ending the SSO session the grant is bound to. `grace`'s one live session
is the run's own, `01a0e77b-af7b-…`, the one in its `console-paths-session`
cookie:

```bash
curl -sS -D - -b jar http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-5ba9-78cd-b877-7ea6d4076028/sessions
curl -sS -D - -c jar -b jar -X DELETE \
  -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-5ba9-78cd-b877-7ea6d4076028/sessions/01a0e77b-af7b-72d1-96b3-6387337d514d
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e77c-3efd-7975-aa8e-bf250a5807aa
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 189
Date: Mon, 28 Sep 2026 10:07:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e77b-af7b-72d1-96b3-6387337d514d","created_at":"2026-09-28T10:07:17.879Z","last_active_at":"2026-09-28T10:07:17.879Z","remembered":false,"client_ids":["odudu-admin"]}]}
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0e77c-3f70-75f9-8035-8e6218ee4cf0
cache-control: no-store
Date: Mon, 28 Sep 2026 10:07:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

This file, `q-state.sql`, run through the same `psql` as the refresh
sections, reads the console session's stored access-token expiry and
whether the grant is revoked. psql's trailing header spaces are trimmed
below:

```sql
select id, access_expires_at, access_expires_at - now() as remaining from console_sessions where tenant_id = '01a0e72d-5927-73c3-b14d-a5b60d1ca9ad' and subject_id = '01a0e72d-5ba9-78cd-b877-7ea6d4076028';
select g.revoked_at is not null as revoked from token_grants g where g.session_id = '01a0e77b-af7b-72d1-96b3-6387337d514d';
```

Right after the `DELETE`, the grant is revoked and the console session is
still there, its access token good for four more minutes:

```
                  id                  |     access_expires_at      |    remaining
--------------------------------------+----------------------------+-----------------
 01a0e77b-b064-76ef-afcb-f6c3efe49e0d | 2026-09-28 10:12:17.913+00 | 00:04:12.225678
(1 row)

 revoked
---------
 t
(1 row)
```

Nothing was sent until the token was inside its 30 s refresh window. Then,
one after another: the query, a proxied `GET`, the query again, and the
session read with a copy of the jar taken before the `GET`:

```bash
docker exec -i docker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
cp jar jar-before-call
curl -sS -D - -c jar -b jar \
  http://localhost:3000/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4
docker exec -i docker-postgres-1 sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
curl -sS -D - -b jar-before-call http://localhost:3000/console/api/session
```

```
                  id                  |     access_expires_at      |    remaining
--------------------------------------+----------------------------+-----------------
 01a0e77b-b064-76ef-afcb-f6c3efe49e0d | 2026-09-28 10:12:17.913+00 | 00:00:24.380626
(1 row)

 revoked
---------
 t
(1 row)
```

The `GET` is the session-ended `401`, and its cookie is cleared:

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a0e77f-e46a-737e-b2f3-a4a613baabcf
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 28 Sep 2026 10:11:53 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a0e77f-e46a-737e-b2f3-a4a613baabcf"}
```

The row is gone:

```
 id | access_expires_at | remaining
----+-------------------+-----------
(0 rows)

 revoked
---------
 t
(1 row)
```

The cookie from before the `GET` names nothing now:

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a0e77f-e4f4-7f6b-b9a5-fa87a1ce9956
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 28 Sep 2026 10:11:53 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a0e77f-e4f4-7f6b-b9a5-fa87a1ce9956"}
```

The server's request log for that second shows which check ended it. The
`GET` never reached `/admin/`. The gateway refreshed first, under the
`GET`'s own request id, and the token endpoint answered `400`:

```bash
docker logs --since 2026-09-28T10:11:53Z --until 2026-09-28T10:11:54Z docker-odudu-1 2>&1 \
  | jq -c 'select(.msg == "incoming request" or .msg == "request completed") | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
["01a0e77f-e46a-737e-b2f3-a4a613baabcf","GET","/console/api/admin/tenants/console-paths/subjects/01a0e72d-7fc7-7950-a1e7-1d079588f8b4"]
["01a0e77f-e46a-737e-b2f3-a4a613baabcf","POST","/tenants/console-paths/protocol/openid-connect/token"]
["01a0e77f-e46a-737e-b2f3-a4a613baabcf",400,null]
["01a0e77f-e46a-737e-b2f3-a4a613baabcf",401,null]
["01a0e77f-e4f4-7f6b-b9a5-fa87a1ce9956","GET","/console/api/session"]
["01a0e77f-e4f4-7f6b-b9a5-fa87a1ce9956",401,null]
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
ID token's `sid`. psql ends each header line with a space, which the
formatter trims below; nothing else differs from what it printed:

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

The logout's `302` lands on the console shell. Every path under `/console/`
that neither the API nor the sign-in routes claim answers the shell, with
the gateway's CSP, and each hashed asset the shell names is served
`immutable`. The shell has no features yet; see
[docs/request-paths.md](request-paths.md#what-is-not-implemented).

**The stack for this section only.** Not `docker-odudu-1`: a separate
compose project, `odudu-smoke`, of the same `infra/docker/compose.yaml`
built at `78826ac` on a fresh database, with its `odudu` service published
on `127.0.0.1:3100` so that it ran beside the development stack. The shell
reads no cookie, so none is sent.

```bash
curl -sS -D - http://localhost:3100/console/
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e7ea-5fc3-751a-ae48-8f0a1237a8db
content-type: text/html; charset=utf-8
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' 'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
content-length: 330
Date: Mon, 28 Sep 2026 12:08:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Odudu console</title>
    <script type="module" crossorigin src="/console/assets/index-I408uhrW.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

```bash
curl -sS -D - -o /dev/null http://localhost:3100/console/assets/index-I408uhrW.js
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e7ea-5fe0-7ea2-a5d3-5102b91ef1e3
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
content-length: 294585
Date: Mon, 28 Sep 2026 12:08:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## What these runs do not show

Each item below is tested, not captured:

- **The `502` on a token-endpoint failure.** A healthy stack's token
  endpoint answers a live grant's refresh, so this needs a fault injected
  into it. It is in `apps/server/tests/console-proxy.int.test.ts`.
- **The admin API's own `401`**, confirmed against the session's own tenant
  with a `whoami`, ending the session and revoking its grant only when that
  confirm is also a `401`, and passed through with the session kept for an
  unknown tenant or another tenant's path. These are in
  `apps/server/tests/console-proxy.int.test.ts`.
- **The `__Host-` cookies**, which need an `https` base. These are in
  `apps/server/tests/console-session.int.test.ts`, and the `conformance`
  job's `infra/conformance/run-console-check.sh` asserts both over that
  stack's TLS proxy ([its README](../infra/conformance/README.md#the-console-over-https)).
