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
`/console/` route this document names to the routes the server serves. The
audit rows below that come from the earlier runs were captured before each row
answered `actor_name` and `actor_origin` as well, resolved when it is read
([Admin paths](admin-paths.md#get-audit)); every other field is as shown, and
the seventh run's rows answer both.

**The stack.** The `docker-odudu-1` container of `infra/docker/compose.yaml`,
restarted on the existing database volume. For the first two runs its `odudu`
service was built at commit `5fd4b11`; for the third it was rebuilt at
`6401476`. `ODUDU_PUBLIC_BASE_URL` is `http://localhost:3000` and
`ODUDU_CONSOLE` is left at its default, `true`. The base is plain HTTP, so the
cookies are `odudu-console` and `odudu-console-login`; over `https` they are
`__Host-odudu-console` and `__Host-odudu-console-login` and carry `Secure`.
The image built at those commits shipped no console build, so
`ODUDU_CONSOLE_DIR` (`/app/console`) was absent, and the third run logged
that below. The image has carried a build since `78826ac`;
[`GET /console/`](#get-console) is captured separately, against its own
throwaway stack, since this stack's own build predates the console's
foundation. The server logged these warnings when it booted for the third
run. The second line is the console cookie's plain-HTTP fallback, and the
third is the missing build:

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

One section comes from **a fourth run**, on a stack of its own: the
`infra/docker` compose file as the project `odudu-fix-capture`, on
`http://localhost:3080`, its `odudu` service built from the tree of commit
`62e4734`, with a throwaway tenant, `principal-check`, holding `grace` as its
administrator and `hopper` beside her. `grace` signed in through the same
four steps the first run shows, with a new, empty `jar`. The seed printed:

```bash
docker compose -p odudu-fix-capture exec -T odudu node dist/main.js seed tenant --name principal-check
docker compose -p odudu-fix-capture exec -T odudu node dist/main.js seed user --tenant principal-check \
  --username grace --password principal-check-throwaway --email grace@example.com
docker compose -p odudu-fix-capture exec -T odudu node dist/main.js seed grant-role --tenant principal-check \
  --username grace --role odudu-admin:tenant-admin
docker compose -p odudu-fix-capture exec -T odudu node dist/main.js seed user --tenant principal-check \
  --username hopper --password principal-check-throwaway-2 --email hopper@example.com
```

```
{"command":"tenant","created":true,"tenant":"principal-check","tenantId":"01a0e95a-054b-71ee-ba7c-25720d128406"}
{"command":"user","tenant":"principal-check","tenantId":"01a0e95a-054b-71ee-ba7c-25720d128406","username":"grace","userSubjectId":"01a0e95a-081b-76fa-af1b-6da2485d3057"}
{"command":"grant-role","tenant":"principal-check","tenantId":"01a0e95a-054b-71ee-ba7c-25720d128406","username":"grace","role":"odudu-admin:tenant-admin"}
{"command":"user","tenant":"principal-check","tenantId":"01a0e95a-054b-71ee-ba7c-25720d128406","username":"hopper","userSubjectId":"01a0e95a-0bcc-748d-a790-cb413990b992"}
```

Since that commit the gateway refuses a write naming no subject in
`X-Odudu-Console-Subject`, so the earlier runs' writes, which send none,
would each be answered `409` today; the fourth run's section shows that
refusal and the same write forwarded once it names the session's subject.
The earlier runs were not re-captured.

One section comes from **a fifth run**, on a stack of its own, the project
`odudu-signin` on `http://localhost:3082` at `0824c4e7`: the restarted
callback. It says what it seeded in its first lines.

One response comes from **a sixth run**, after the pending sign-in's window
was raised: `GET /console/auth/login` says which.

**A seventh run** follows `odudu-admin` becoming a confidential client, which
is what the gateway now signs in as: a stack of its own, the project
`odudu-docs-12b` on `http://localhost:3082`, its `odudu` service built from
commit `b4efbb72` on an empty volume, with a console key made for it by
`infra/docker/console-key.sh`. `seed admin --username ada` made the `system`
tenant's administrator, who signed in to the console with a new, empty `jar`.
Every section that makes a token, refresh or revocation call ran on it, and
each says so in its first line: [the gateway is a confidential
client](#the-gateway-is-a-confidential-client), the first block of the
discovery read, [a refresh](#a-refresh), [a refresh that cannot take the
lock](#a-refresh-that-cannot-take-the-lock), [a refresh the server
refuses](#a-refresh-the-server-refuses), and the logout with the redirect it
ends on. Their audit rows answer `actor_name` and `actor_origin`; the sections
from earlier runs that show audit rows are labelled where they predate them.

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
hash, the PKCE verifier and the nonce. It lasted 600 seconds when this run
was captured, as the cookie's `Max-Age` says, and every login cookie below
says the same. It lasts 1800 seconds now — as long as the tenant's own
sign-in lasts by default (`login_ttl_seconds`), since that is where the time
goes. The same request on **a sixth run**, on a stack of its own, the
project `odudu-t10` on `http://localhost:3082` at `511db0fd`, in a tenant
`reach-demo` made there with `odudu seed tenant`, after the change:

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3082/console/auth/login?tenant=reach-demo&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a10b70-ca94-750f-8ee9-f5fe252bfd43
cache-control: no-store
set-cookie: odudu-console-login=01a10b4d-ca70-77b4-b690-4c149c9775eb.4RfyPlgrm1a6I2t_qGwFXpyZbQIhhuZB7hlG0YiYvas; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3082/tenants/reach-demo/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3082%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a10b4d-ca70-77b4-b690-4c149c9775eb.4RfyPlgrm1a6I2t_qGwFXpyZbQIhhuZB7hlG0YiYvas&nonce=7XpTun4XRrP3iXuSYuc-0TQw1-NF8dFAs64w4am1HCM&code_challenge=u10his0Q0sYMd8ssYQj0QsRM4Owk0QhwsAGJHHuFUzk&code_challenge_method=S256
content-length: 0
Date: Mon, 05 Oct 2026 09:41:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The sections below go on from the first run's `location`, not this one's.

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

Since 2026-10-05 the policy on this page also names the origin of the
console's own `redirect_uri` in `form-action`, as every page that continues
an authorization request does
([ADR 0018](adr/0018-framing-defence-on-rendered-pages.md)'s second
amendment). For the console that is the server's own origin, so nothing it
can reach changes. The same request, re-run on a stack of its own — the
project `odudu-t8d` on `http://localhost:3086` at commit `511db0fd`, with
`console-paths` seeded on it — answers with this policy, the rest of the
response as above:

```
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self' http://localhost:3086; base-uri 'none'; script-src 'nonce-tGaiwaKzNEDPCRk05fGcWA=='; connect-src 'self'
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

## The gateway is a confidential client

From the seventh run. The callback above exchanges the code it was given at
the tenant's token endpoint, and `odudu-admin`, the client it does so as, is
confidential: that exchange carries an RFC 7523 assertion signed with the
console's key, and so do the refresh and the revocation. The sign-in is as
the first run showed it, `ada` through the tenant's form with no password
change owed this time; the callback, and the server's request log for that
second, which names the call the gateway made in between (`$SINCE` is the
second before it):

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
docker compose -p odudu-docs-12b logs --since $SINCE odudu 2>&1 \
  | sed 's/^[^{]*//' \
  | jq -c 'select(.msg == "incoming request" or .msg == "request completed") | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1203f-07e2-7fbe-a009-7453e2a8df37
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=0199aa00-0000-7000-8000-000000000001.2HS33GTmBoQ1jBz_2vnrBYoDiCG5YsvoCenMz3_RESY; HttpOnly; SameSite=Strict; Path=/
location: /console/
content-length: 0
Date: Fri, 09 Oct 2026 10:39:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The log, filtered to the callback's own request id. The `POST` is the
exchange, and it was answered `200`:

```
["01a1203f-07e2-7fbe-a009-7453e2a8df37","GET","/console/auth/callback"]
["01a1203f-07e2-7fbe-a009-7453e2a8df37","GET","/tenants/system/.well-known/openid-configuration"]
["01a1203f-07e2-7fbe-a009-7453e2a8df37",200,null]
["01a1203f-07e2-7fbe-a009-7453e2a8df37","POST","/tenants/system/protocol/openid-connect/token"]
["01a1203f-07e2-7fbe-a009-7453e2a8df37",200,null]
["01a1203f-07e2-7fbe-a009-7453e2a8df37","GET","/tenants/system/protocol/openid-connect/certs"]
["01a1203f-07e2-7fbe-a009-7453e2a8df37",200,null]
["01a1203f-07e2-7fbe-a009-7453e2a8df37",302,null]
```

What the assertion buys is what the same calls are without it. The
loopback client's session at `system` left a refresh token from the first
sign-in of the stack (`docs/admin-paths.md`'s "Getting the token" is the same
stack), `$R1`, and `console assertion` prints a signed assertion. The refresh
and the revocation, each without one, are refused, and a refusal spends
nothing:

```bash
curl -sS -D - --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=$R1" \
  --data-urlencode client_id=odudu-admin \
  http://localhost:3082/tenants/system/protocol/openid-connect/token
curl -sS -D - --data-urlencode "token=$R1" --data-urlencode token_type_hint=refresh_token \
  --data-urlencode client_id=odudu-admin \
  http://localhost:3082/tenants/system/protocol/openid-connect/revoke
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1203f-2ea5-71cf-aa0d-fdf882ed4b46
vary: Origin
www-authenticate: Basic realm="token"
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 26
Date: Fri, 09 Oct 2026 10:39:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_client"}
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1203f-2edf-7f31-a75b-6c9933dc1f23
www-authenticate: Basic realm="token"
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 26
Date: Fri, 09 Oct 2026 10:39:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_client"}
```

With an assertion, signed for the endpoint's own tenant and presented once,
the refresh answers and rotates the token. The `ASSERTION` is printed by the
`odudu` container, as the operator holds the key:

```bash
ASSERTION=$(docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console assertion --tenant system)
curl -sS -D - --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=$R1" \
  --data-urlencode client_id=odudu-admin \
  --data-urlencode client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer \
  --data-urlencode "client_assertion=$ASSERTION" \
  http://localhost:3082/tenants/system/protocol/openid-connect/token
```

```
HTTP/1.1 200 OK
x-request-id: 01a1203f-33b1-7a72-bf9c-227d94e20c5e
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 837
Date: Fri, 09 Oct 2026 10:39:35 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token":"eyJhbGciOiJFUzI1NiIsImtp…","refresh_token":"AG63NELqKwsz9hxTTAfClb0a…","token_type":"Bearer","expires_in":300,"scope":"openid"}
```

(The tokens are cut to their first 24 characters, as in "Getting the token".) A
revocation presents the rotated token, `$R2`, the same way, and the refresh that
follows is refused for a grant that is gone, not for the client that asked:

```bash
curl -sS -D - --data-urlencode "token=$R2" --data-urlencode token_type_hint=refresh_token \
  --data-urlencode client_id=odudu-admin \
  --data-urlencode client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer \
  --data-urlencode "client_assertion=$(docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console assertion --tenant system)" \
  http://localhost:3082/tenants/system/protocol/openid-connect/revoke
curl -sS -D - --data-urlencode grant_type=refresh_token --data-urlencode "refresh_token=$R2" \
  --data-urlencode client_id=odudu-admin \
  --data-urlencode client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer \
  --data-urlencode "client_assertion=$(docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console assertion --tenant system)" \
  http://localhost:3082/tenants/system/protocol/openid-connect/token
```

```
HTTP/1.1 200 OK
x-request-id: 01a1203f-4c3f-7fc0-80b1-e201cbf46442
cache-control: no-store
content-length: 0
Date: Fri, 09 Oct 2026 10:39:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1203f-4e6b-734a-aacc-5d3bbe1072fe
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 25
Date: Fri, 09 Oct 2026 10:39:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_grant"}
```

An assertion is good once. The same one presented twice at `/revoke`, the
status of each:

```bash
A=$(docker compose -p odudu-docs-12b exec -T odudu node dist/main.js console assertion --tenant system)
for i in 1 2; do
  curl -sS -o /dev/null -w "%{http_code} " --data-urlencode token=x --data-urlencode client_id=odudu-admin \
    --data-urlencode client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer \
    --data-urlencode "client_assertion=$A" \
    http://localhost:3082/tenants/system/protocol/openid-connect/revoke
done
```

```
200 401
```

## `GET /console/auth/callback`, refused

From the second run, before a refused callback restarted the sign-in. The
two refusals below answered the page at `5fd4b11`; a first refusal now
answers the restart that [the fifth run](#get-consoleauthcallback-restarted)
shows, and only a second inside its minute answers the page, which now also
links back to the console. Everything else here is unchanged. It signed in as the first run did, with the same
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

## `GET /console/auth/callback`, restarted

From **the fifth run**, on its own stack: the `infra/docker` compose file as
the project `odudu-signin`, on `http://localhost:3082`, built from commit
`0824c4e7`, with a throwaway tenant, `signin-restart`, holding `grace` as its
administrator. A curl cookie jar, `jar`, plays one browser throughout. With
`COMPOSE_PROJECT_NAME=odudu-signin` set, the seed printed:

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name signin-restart
docker compose exec -T odudu node dist/main.js seed user --tenant signin-restart \
  --username grace --password signin-restart-throwaway
docker compose exec -T odudu node dist/main.js seed grant-role --tenant signin-restart \
  --username grace --role odudu-admin:tenant-admin
```

```
{"command":"tenant","created":true,"tenant":"signin-restart","tenantId":"01a108bd-b4b2-756b-b09e-6dbd32fbdf4d"}
{"command":"user","tenant":"signin-restart","tenantId":"01a108bd-b4b2-756b-b09e-6dbd32fbdf4d","username":"grace","userSubjectId":"01a108bd-b7a3-7793-9eb4-90662b8361a6"}
{"command":"grant-role","tenant":"signin-restart","tenantId":"01a108bd-b4b2-756b-b09e-6dbd32fbdf4d","username":"grace","role":"odudu-admin:tenant-admin"}
```

A refused callback no longer ends on the refusal page. It begins the
sign-in again, once, for the tenant its `state` is bound to, with a fresh
`state` of its own. The answer is the same whichever check refused, so it
says nothing about which one failed, and the code it carried is never
presented. A refusal that arrives while that restart's `odudu-console-restart`
cookie is still set (60 seconds) is shown the page instead, and the page links
back to the console.

The tenant is read from the `state` alone, which nothing authenticates:
anyone can write `<uuid>.<43 characters>`, so the restart's `location` names
the tenant for any tenant uuid it is given. That is accepted. A tenant's name
is public in every `/tenants/<name>/` URL, its uuid already travels in its
own `state` and session cookie, and the `location` only ever leads to this
gateway's own `/console/auth/login`. Without the name, an expired sign-in
could restart only at `/console/`, and would lose the silent sign-in shown
below.

**A sign-in left open past the login's lifetime.** The gateway's `login`, the
tenant's authorization endpoint and `grace`'s password were sent as in
[the first run](#get-consoleauthlogin). The `authenticate` request answered:

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-ba01-7e72-983b-9c5723d52461
set-cookie: signin-restart-session=01a108bd-ba7d-7791-9abe-a02b0204e94c:C7aSHxAgyTFJm5Ry7Bx28LUEtD1vhyIY9ik97mgvc2s; HttpOnly; SameSite=Lax; Path=/
set-cookie: signin-restart-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: http://localhost:3082/console/auth/callback?code=8ADlLQH5BSxI1o5sTM5Q-W7-tBUd3DUqIXj6uF2JZCo&state=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.OBy4NmYU1OoW4R0WN8IMpzfwcPZeCI6M1kPVrIcW-dk&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fsignin-restart
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The pending sign-in lasted 600 seconds when this run was captured, in its
row and in the login cookie's `Max-Age`; it lasts 1800 now, as
[`GET /console/auth/login`](#get-consoleauthlogin) shows. The row was expired with `psql` (header spaces trimmed, as above),
and the jar's login cookie was removed, as a browser drops it at its
`Max-Age`:

```sql
update console_logins set expires_at = now() - interval '1 second'
  where tenant_id = '01a108bd-b4b2-756b-b09e-6dbd32fbdf4d';
select expires_at < now() as expired from console_logins
  where tenant_id = '01a108bd-b4b2-756b-b09e-6dbd32fbdf4d';
```

```
UPDATE 1
 expired
---------
 t
(1 row)
```

The callback the tenant redirected to, `$LOCATION` being its `location`:

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-bb85-796f-a4fb-f852b4efbde9
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=signin-restart
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

**The same callback again, inside the minute.** The jar now holds
`odudu-console-restart`, so the refusal is shown rather than restarted:

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a108bd-bb92-747c-8473-cfb43f7a262c
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 232
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body>
<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
<p><a href="/console/">Sign in again</a></p>
</body>
</html>
```

**Following the restart.** The tenant's own session, set by the stale
sign-in, answers the fresh authorization request at once:

```bash
curl -sS -D - -o /dev/null -c jar -b jar 'http://localhost:3082/console/auth/login?tenant=signin-restart'
curl -sS -D - -o /dev/null -c jar -b jar "$AUTHORIZE"   # the location above
curl -sS -D - -o /dev/null -c jar -b jar "$CALLBACK"    # the location above
```

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-bb9f-7380-892c-60da383b71ed
cache-control: no-store
set-cookie: odudu-console-login=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.n5MLNmKsBZv-2kzRjxAg2x6If0LcDxxX1icbUHWcTdg; HttpOnly; SameSite=Lax; Path=/; Max-Age=600
location: http://localhost:3082/tenants/signin-restart/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3082%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.n5MLNmKsBZv-2kzRjxAg2x6If0LcDxxX1icbUHWcTdg&nonce=za05eaGWkGl-80bANrVOSNGoFVSKmHIetP98tsp5wNg&code_challenge=hO_cQP-XyHQfTSeU9Tc0HgIZvwU8rGmjcUcdAllAxCM&code_challenge_method=S256
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-bbb1-7d8a-a51b-ff70caba4603
location: http://localhost:3082/console/auth/callback?code=XFi8934NxcJ53y9sgsa21AeNlOqLL-OJnhKaAbT7NUQ&state=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.n5MLNmKsBZv-2kzRjxAg2x6If0LcDxxX1icbUHWcTdg&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fsignin-restart
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-bbcd-7fba-959d-50f20e039bfd
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.UbeLBc78w8nIIDjDx0defSDsAIXwMI8NM5PVt5hzYU4; HttpOnly; SameSite=Strict; Path=/
location: /console/
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The sign-in completed, and the restart cookie was cleared with the login
cookie. The code the stale callback carried, `8ADlLQH5BSxI1o5sTM5Q-W7-tBUd3DUqIXj6uF2JZCo`, was never
exchanged. The tenant's codes afterwards, each named by matching its stored
hash (base64url SHA-256) against the two codes above:

```sql
select case code_hash
    when translate(rtrim(encode(sha256(convert_to('8ADlLQH5BSxI1o5sTM5Q-W7-tBUd3DUqIXj6uF2JZCo', 'UTF8')), 'base64'), '='), '+/', '-_') then 'stale'
    when translate(rtrim(encode(sha256(convert_to('XFi8934NxcJ53y9sgsa21AeNlOqLL-OJnhKaAbT7NUQ', 'UTF8')), 'base64'), '='), '+/', '-_') then 'restart'
  end as code, consumed_at is not null as consumed
  from authorization_codes where tenant_id = '01a108bd-b4b2-756b-b09e-6dbd32fbdf4d' order by 1;
```

```
  code   | consumed
---------+----------
 restart | t
 stale   | f
(2 rows)
```

**A `state` that does not match the login cookie.** A new jar, `jar2`, began
a sign-in, which set:

```
set-cookie: odudu-console-login=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.Tt75gHXd-5LC_-i08TD36f3ALE03L3H86v-z1jC5krE; HttpOnly; SameSite=Lax; Path=/; Max-Age=600
```

A callback whose `state` keeps that tenant and carries another secret of the
same shape is answered exactly as the expired one was:

```bash
curl -sS -D - -c jar2 -b jar2 'http://localhost:3082/console/auth/callback?code=anything&state=01a108bd-b4b2-756b-b09e-6dbd32fbdf4d.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-bca7-7961-b9ad-723fceebeb08
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=signin-restart
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A `state` that names no tenant the gateway can read restarts at the
console's own `/console/` instead:

```bash
curl -sS -D - 'http://localhost:3082/console/auth/callback?code=anything&state=not-a-state&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 302 Found
x-request-id: 01a108bd-bcbd-7314-9346-f6db2569fdfa
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/
content-length: 0
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A callback with no `state` at all, which no sign-in of this console's
produces, is shown the page at once, with no restart cookie:

```bash
curl -sS -D - 'http://localhost:3082/console/auth/callback?code=anything&iss=http%3A%2F%2Flocalhost%3A3082%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a108bd-bcb2-7035-967d-bb9efc17f4a2
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
content-length: 232
Date: Sun, 04 Oct 2026 21:06:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body>
<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
<p><a href="/console/">Sign in again</a></p>
</body>
</html>
```

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

## `GET /console/api/tenants/{tenant}/discovery`, `GET /console/api/tenants/{tenant}/jwks`

Read-only mirrors of the tenant's own public discovery document and JWKS
(`docs/request-paths.md`'s `GET /tenants/{tenant}/.well-known/openid-configuration`
and `GET /tenants/{tenant}/protocol/openid-connect/certs`), reached through
the gateway so the console never needs a transport exception to read them
and the issuer shown is always the one the gateway's own `OduduPort` reads
by inject with the public base's authority pinned — never whatever `Host`
the browser sent. Both require the session `GET /console/api/session`
above shows; a session whose own tenant is neither `system` nor the one
named answers `403`, and a tenant unknown to the server answers `404`.

**The stack for this section only.** Not `docker-odudu-1`: a throwaway
compose project, `odudu-task3`, built from this branch (`40e9e43f`) and
removed afterwards, on `http://localhost:3080`. Two administrators: `ada`,
`seed admin`'s system-tenant administrator, signed in through the forced
password change `docs/request-paths.md` documents; and `grace`,
`odudu-admin:tenant-admin` on a second throwaway tenant, `console-paths-disc`,
signed in the same way `console-paths`' `grace` is above. Neither sign-in is
re-shown here.

A request to `ada`'s own session, with a forged `Host` the gateway never
consults for this call, still answers with the public base's issuer. This
block alone was captured again, on the seventh run, `ada` being that run's
`system` administrator and `$ADA_SESSION` the `odudu-console` cookie of her
sign-in on `http://localhost:3082`, because the discovery document now lists
`private_key_jwt` among the methods `/introspect` and `/revoke` accept; the
blocks after it are from the stack named above:

```bash
curl -sS -D - -H 'Host: evil.example' -H "Cookie: $ADA_SESSION" \
  http://localhost:3082/console/api/tenants/system/discovery
```

```
HTTP/1.1 200 OK
x-request-id: 01a12040-179a-7591-ade8-51f93d4ab822
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 2312
Date: Fri, 09 Oct 2026 10:40:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"issuer":"http://localhost:3082/tenants/system","authorization_endpoint":"http://localhost:3082/tenants/system/protocol/openid-connect/auth","token_endpoint":"http://localhost:3082/tenants/system/protocol/openid-connect/token","introspection_endpoint":"http://localhost:3082/tenants/system/protocol/openid-connect/token/introspect","revocation_endpoint":"http://localhost:3082/tenants/system/protocol/openid-connect/revoke","userinfo_endpoint":"http://localhost:3082/tenants/system/protocol/openid-connect/userinfo","jwks_uri":"http://localhost:3082/tenants/system/protocol/openid-connect/certs","end_session_endpoint":"http://localhost:3082/tenants/system/protocol/openid-connect/logout","response_types_supported":["code"],"response_modes_supported":["query"],"subject_types_supported":["public"],"id_token_signing_alg_values_supported":["RS256","ES256"],"userinfo_signing_alg_values_supported":["ES256","none"],"userinfo_encryption_alg_values_supported":["RSA-OAEP-256","ECDH-ES","ECDH-ES+A128KW","ECDH-ES+A192KW","ECDH-ES+A256KW"],"userinfo_encryption_enc_values_supported":["A128CBC-HS256","A192CBC-HS384","A256CBC-HS512","A128GCM","A192GCM","A256GCM"],"code_challenge_methods_supported":["S256"],"grant_types_supported":["authorization_code","refresh_token","client_credentials","urn:ietf:params:oauth:grant-type:token-exchange"],"token_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","none","private_key_jwt"],"introspection_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","private_key_jwt","none"],"revocation_endpoint_auth_methods_supported":["client_secret_basic","client_secret_post","private_key_jwt","none"],"authorization_response_iss_parameter_supported":true,"claims_parameter_supported":true,"backchannel_logout_supported":true,"backchannel_logout_session_supported":true,"frontchannel_logout_supported":true,"frontchannel_logout_session_supported":true,"scopes_supported":["address","email","groups","offline_access","openid","phone","profile","roles"],"claims_supported":["sub","name","given_name","family_name","middle_name","nickname","preferred_username","profile","picture","website","gender","birthdate","zoneinfo","locale","updated_at","email","email_verified","roles","groups","address","phone_number","phone_number_verified"]}
```

`ada`'s own tenant is `system`, so the same session also reads a tenant
that does not exist, answering `404` rather than `403`:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/no-such-tenant/discovery
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0ea81-1f40-7eee-afb6-44749ad9d15c
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 115
Date: Tue, 29 Sep 2026 00:12:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":404,"type":"about:blank#not-found","title":"Not Found","instance":"01a0ea81-1f40-7eee-afb6-44749ad9d15c"}
```

`grace`'s own tenant is `console-paths-disc`, so her session reads its own
discovery document:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/console-paths-disc/discovery
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea81-11a0-7825-9253-a2e8ba6b0124
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 2372
Date: Tue, 29 Sep 2026 00:12:02 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"issuer":"http://localhost:3080/tenants/console-paths-disc", …}
```

The same session reading `system`'s discovery instead is refused, never
saying whether `system` exists — the same shape a tenant admin's cross-tenant
`/admin/` read is refused with:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/system/discovery
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a0ea81-11be-7cc1-8400-879d64e2dd0f
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 105
Date: Tue, 29 Sep 2026 00:12:02 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank","title":"Forbidden","instance":"01a0ea81-11be-7cc1-8400-879d64e2dd0f"}
```

`/jwks` answers the same way, unabbreviated because it is short — here
`grace`'s own tenant's one signing key:

```bash
curl -sS -D - -b jar http://localhost:3080/console/api/tenants/console-paths-disc/jwks
```

```
HTTP/1.1 200 OK
x-request-id: 01a0ea81-2f1d-7b5a-ab99-9fddd047757c
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 455
Date: Tue, 29 Sep 2026 00:12:09 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"keys":[{"kty":"RSA","n":"lraNFVOr79JY8qqcZdDshqkjsQSPpd8XmqNT-Zpq65MSgLTfkDmhtrdY6y-xDLyH4SNHCzGIEX5Y_WnNc9egH5as8Q2C7ucd0f2dU6ZoNupSJtcoUmYSkzOwHqLD2NhFEGWbLan0rIrTMZwxuUBAPrnMr6zwiZW9kaISCpP6KuKyulFJnVo7cdRcSWkkfZTvFODJpJeWzZ59YEnVr6yMes-1nQbJWvOVpH4T2dc3CX70PWOoadRFgm2FcwwlyidwdhC7GuNvVbjHajmNU96PgtliVOCDzIH9DLg8koXWCG_ruEQ_ZRgRTm6ndKBalMFUzsSnZ22n8APa1nW9DNYLlw","e":"AQAB","kid":"01a0ea7f-01af-7637-a8b5-093872f1685f","alg":"RS256","use":"sig"}]}
```

```bash
cd infra/docker
COMPOSE_PROJECT_NAME=odudu-task3 ODUDU_HOST_PORT=3080 POSTGRES_HOST_PORT=5462 \
  docker compose down -v
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

_(Captured before each audit row answered `actor_name` and `actor_origin`; not re-run, since the third run this section comes from cannot be repeated on one stack without the session, grants and timings it names. Every other field is as shown.)_

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

## `POST /console/api/admin/tenants/{tenant}/subjects`, refused for another principal

From the fourth run, on its own stack and tenant. Every tab of a browser
shares the console cookie, so another tab's sign-in can replace the session
under a page that still shows the old administrator. The console therefore
names, on each admin request, the subject its tab believes is signed in, in
`X-Odudu-Console-Subject`. The session this run's `jar` carries is
`grace`'s:

```bash
curl -sS -D - -c jar -b jar http://localhost:3080/console/api/session
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e95a-6c11-74c9-b130-35dc74a68b8a
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 99
Date: Mon, 28 Sep 2026 18:50:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"tenant":"principal-check","subject_id":"01a0e95a-081b-76fa-af1b-6da2485d3057","username":"grace"}
```

The three writes below ran one after another, between
`2026-09-28T18:50:12.410Z` and `2026-09-28T18:50:12.538Z` as
`new Date().toISOString()` printed them before and after, with the same
cookie and body. The first names `hopper`, another subject of the tenant, and is
refused `409` with the gateway's own problem type. The session is live, so
the cookie is left alone:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3080' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a0e95a-0bcc-748d-a790-cb413990b992' \
  -H 'Content-Type: application/json' \
  -d '{"username":"babbage","email":"babbage@example.com"}' \
  http://localhost:3080/console/api/admin/tenants/principal-check/subjects
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a0e95a-6c4b-7e13-a475-6eba0048593d
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 28 Sep 2026 18:50:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":409,"type":"about:blank#console-principal-changed","title":"Conflict","instance":"01a0e95a-6c4b-7e13-a475-6eba0048593d"}
```

The second names no subject. A write that does not say who it acts for is
refused the same way; a read that names nobody is still forwarded:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3080' -H 'X-Odudu-Console: 1' \
  -H 'Content-Type: application/json' \
  -d '{"username":"babbage","email":"babbage@example.com"}' \
  http://localhost:3080/console/api/admin/tenants/principal-check/subjects
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a0e95a-6c5a-78c9-b7db-e72cfd3f2a95
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Mon, 28 Sep 2026 18:50:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":409,"type":"about:blank#console-principal-changed","title":"Conflict","instance":"01a0e95a-6c5a-78c9-b7db-e72cfd3f2a95"}
```

The third names `grace`, and is forwarded. The refusals above were the
gateway's, not the admin API refusing the body:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3080' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a0e95a-081b-76fa-af1b-6da2485d3057' \
  -H 'Content-Type: application/json' \
  -d '{"username":"babbage","email":"babbage@example.com"}' \
  http://localhost:3080/console/api/admin/tenants/principal-check/subjects
```

```
HTTP/1.1 201 Created
x-request-id: 01a0e95a-6c79-7552-8df2-d2de317ef73a
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 165
Date: Mon, 28 Sep 2026 18:50:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a0e95a-6c92-7aa6-bf80-69f93079a62b","type":"user","username":"babbage","email":"babbage@example.com","enabled":true,"created_at":"2026-09-28T18:50:12.497Z"}
```

The audit trail for that second, read through the proxy, holds one row,
the third write's. The two refused writes reached nothing:

```bash
curl -sS -D - -b jar -H 'X-Odudu-Console-Subject: 01a0e95a-081b-76fa-af1b-6da2485d3057' \
  'http://localhost:3080/console/api/admin/tenants/principal-check/audit?from=2026-09-28T18:50:12Z&to=2026-09-28T18:50:13Z'
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e95a-88e9-7d34-94e0-be4b07dbcc20
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 507
Date: Mon, 28 Sep 2026 18:50:19 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a0e95a-6c98-7609-92cc-53689a8ccae6","occurred_at":"2026-09-28T18:50:12.497Z","event_type":"admin_mutation","action":"subject.create","outcome":"allowed","actor_tenant_id":"01a0e95a-054b-71ee-ba7c-25720d128406","actor_subject_id":"01a0e95a-081b-76fa-af1b-6da2485d3057","actor_client_id":"01a0e95a-05d4-790f-86b0-9cf1e44c3dd1","resource_type":"subject","resource_id":"01a0e95a-6c92-7aa6-bf80-69f93079a62b","request_id":"01a0e95a-6c79-7552-8df2-d2de317ef73a","ip":"172.21.0.1","detail":{}}]}
```

_(Captured before each audit row answered `actor_name` and `actor_origin`; not re-run, since the fourth run this section comes from cannot be repeated on one stack without the session, grants and timings it names. Every other field is as shown.)_

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

From the seventh run, on the session `01a1203f-0879-…` of `ada`'s first sign-in.
Every request before it ran on an access token with more than 30 s left. The
gateway refreshes before forwarding when less is left, and the token lives 300 s,
so this section waited until the stored expiry was 18 s away. The refresh is a
call to the tenant's token endpoint as `odudu-admin`, carrying the assertion it
signs; the server's own `token` audit row names the grant and the client, and
the proxied `GET` shows no difference to the browser. These ran one after another,
`$FROM` being the timestamp printed first:

```bash
python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.')+'%03dZ'%(datetime.datetime.now().microsecond//1000))"
curl -sS -D - -b jar \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f
curl -sS -D - -b jar \
  "http://localhost:3082/console/api/admin/tenants/system/audit?event_type=token&from=$FROM"
curl -sS -D - -b jar \
  "http://localhost:3082/console/api/admin/tenants/system/audit?action=grant.revoked_on_reuse&from=$FROM"
```

with this query, on the standard input of `docker compose -p odudu-docs-12b exec -T
postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`, run before the
`GET` and again after it:

```sql
select access_expires_at, access_expires_at - now() as remaining from console_sessions where id = '01a1203f-0879-7a1c-bfb3-9ede557fa475';
```

Before:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-10-09 10:44:24.136+00 | 00:00:18.691772
(1 row)
```

`$FROM`, then the `GET`:

```
2026-10-09T10:44:05.483Z
```

```
HTTP/1.1 200 OK
x-request-id: 01a12043-5301-7cce-b4d6-9a4e34815cb7
content-type: application/json; charset=utf-8
etag: "8f184ae83744abf07346b2aeb60c88049dd813d5f36f0820b6e1ab4216f2a0cd"
cache-control: no-store
content-length: 144
Date: Fri, 09 Oct 2026 10:44:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1203a-f86d-7e8e-a537-e39f5d77b04f","type":"user","username":"ada","email":null,"enabled":true,"created_at":"2026-10-09T10:34:57.804Z"}
```

After, the expiry is 300 s from the refresh:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-10-09 10:49:05.514+00 | 00:04:59.673808
(1 row)
```

The tenant's `token` audit rows since `$FROM` are one `token.refresh`, on
the grant the sign-in created, by the client `odudu-admin`:

```
HTTP/1.1 200 OK
x-request-id: 01a12043-5472-7982-b939-3864922d61fb
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 554
Date: Fri, 09 Oct 2026 10:44:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a12043-5374-7221-bd12-c458eec0d9d0","occurred_at":"2026-10-09T10:44:05.608Z","event_type":"token","action":"token.refresh","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a1203a-f86d-7e8e-a537-e39f5d77b04f","actor_client_id":"01a1203a-f7c6-76b2-89fa-7c51f3507f28","actor_name":"ada","actor_origin":"tenant","resource_type":"grant","resource_id":"01a1203f-0864-7643-8bc4-e32975f8c31d","request_id":"01a12043-5301-7cce-b4d6-9a4e34815cb7","ip":"172.22.0.1","detail":{"scope":"openid"}}]}
```

and the refresh token was presented once, since reuse detection revoked
nothing:

```
HTTP/1.1 200 OK
x-request-id: 01a12043-54b1-700c-a08d-0635ebd9e6f1
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 12
Date: Fri, 09 Oct 2026 10:44:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
```

## A refresh that cannot take the lock

From the seventh run, on the same session, about 4.5 minutes after the refresh
above. A refresh holds the session's row lock, waiting at most 5 s for it,
so that two refreshes of one session never present its refresh token
twice. Here `psql` holds that lock for 12 s while a request that needs a
refresh arrives. The lock is taken by this file, `q-lock.sql`, through the
same `psql`:

```sql
BEGIN;
SELECT id, clock_timestamp() AS locked_at FROM console_sessions WHERE id = '01a1203f-0879-7a1c-bfb3-9ede557fa475' FOR UPDATE;
SELECT pg_sleep(12);
SELECT clock_timestamp() AS releasing_at;
COMMIT;
```

The steps, in order: the expiry query from the section above; `$FROM`;
the lock file started in the background; one second later the `GET`, with
curl printing its total time; then, once `psql` had committed, the same
`GET`, the expiry query, and the `token` audit rows since `$FROM`.

```bash
python3 -c "import datetime;print(datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.')+'%03dZ'%(datetime.datetime.now().microsecond//1000))"
docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-lock.sql &
sleep 1
curl -sS -D - -w 'time_total: %{time_total}\n' -b jar \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f
wait
curl -sS -D - -b jar \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f
curl -sS -D - -b jar \
  "http://localhost:3082/console/api/admin/tenants/system/audit?event_type=token&from=$FROM"
```

Before, the token was inside the refresh window:

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-10-09 10:49:05.514+00 | 00:00:24.238473
(1 row)
```

```
2026-10-09T10:48:41.309Z
```

The lock, held from 10:48:41.44 to 10:48:53.45. The `pg_sleep` value line
is a single space, trimmed below like the header spaces:

```
BEGIN
                  id                  |           locked_at
--------------------------------------+-------------------------------
 01a1203f-0879-7a1c-bfb3-9ede557fa475 | 2026-10-09 10:48:41.441836+00
(1 row)

 pg_sleep
----------

(1 row)

         releasing_at
-------------------------------
 2026-10-09 10:48:53.451078+00
(1 row)

COMMIT
```

The `GET` sent while it was held waited 5 s for the lock and was answered
`502`, at 10:48:47, inside the lock's twelve seconds. curl's `time_total`
follows the body on the same line, since the body ends without a newline:

```
HTTP/1.1 502 Bad Gateway
x-request-id: 01a12047-8c7d-7ae6-be03-e1f46bbd2bcd
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 107
Date: Fri, 09 Oct 2026 10:48:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":502,"type":"about:blank","title":"Bad Gateway","instance":"01a12047-8c7d-7ae6-be03-e1f46bbd2bcd"}time_total: 5.126018
```

The session was kept. The `GET` after the commit refreshed and was
forwarded:

```
HTTP/1.1 200 OK
x-request-id: 01a12047-b7ed-7793-af71-d2b5d3c5d757
content-type: application/json; charset=utf-8
etag: "8f184ae83744abf07346b2aeb60c88049dd813d5f36f0820b6e1ab4216f2a0cd"
cache-control: no-store
content-length: 144
Date: Fri, 09 Oct 2026 10:48:53 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1203a-f86d-7e8e-a537-e39f5d77b04f","type":"user","username":"ada","email":null,"enabled":true,"created_at":"2026-10-09T10:34:57.804Z"}
```

```
     access_expires_at      |    remaining
----------------------------+-----------------
 2026-10-09 10:53:53.486+00 | 00:04:59.811109
(1 row)
```

Since `$FROM` there is one `token.refresh`, the one after the commit. The
request that timed out on the lock never reached the token endpoint:

```
HTTP/1.1 200 OK
x-request-id: 01a12047-b8c3-785d-bbef-c5b36d0fd8fd
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 554
Date: Fri, 09 Oct 2026 10:48:53 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a12047-b81e-71cb-8f77-2c76058f549c","occurred_at":"2026-10-09T10:48:53.528Z","event_type":"token","action":"token.refresh","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a1203a-f86d-7e8e-a537-e39f5d77b04f","actor_client_id":"01a1203a-f7c6-76b2-89fa-7c51f3507f28","actor_name":"ada","actor_origin":"tenant","resource_type":"grant","resource_id":"01a1203f-0864-7643-8bc4-e32975f8c31d","request_id":"01a12047-b7ed-7793-af71-d2b5d3c5d757","ip":"172.22.0.1","detail":{"scope":"openid"}}]}
```

The run's session was not logged out until the next section ended it, so its
`console_sessions` row was there throughout.

## A refresh the server refuses

From the seventh run, on the same session, straight after the lock section. Its
grant is revoked through the console itself, by ending the SSO session the grant is
bound to; a write names the session's subject in `X-Odudu-Console-Subject`, as
every write must, or it is refused as another principal's. `ada` holds two live
sessions on this stack, the first sign-in's loopback one and this run's own,
`01a1203e-f2ca-…`, the one in its `system-session` cookie:

```bash
curl -sS -D - -b jar http://localhost:3082/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f/sessions
curl -sS -D - -c jar -b jar -X DELETE \
  -H 'Origin: http://localhost:3082' -H 'X-Odudu-Console: 1' \
  -H 'X-Odudu-Console-Subject: 01a1203a-f86d-7e8e-a537-e39f5d77b04f' \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f/sessions/01a1203e-f2ca-78cb-833c-3ae98a36ca3d
```

```
HTTP/1.1 200 OK
x-request-id: 01a1204c-4db5-7d7c-bd3d-83edadb2f3cc
content-type: application/json; charset=utf-8
cache-control: no-store
content-length: 367
Date: Fri, 09 Oct 2026 10:53:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1203b-5383-79a0-892a-1da6060f57f0","created_at":"2026-10-09T10:35:21.344Z","last_active_at":"2026-10-09T10:39:35.356Z","remembered":false,"client_ids":["odudu-admin"]},{"id":"01a1203e-f2ca-78cb-833c-3ae98a36ca3d","created_at":"2026-10-09T10:39:18.727Z","last_active_at":"2026-10-09T10:53:34.315Z","remembered":false,"client_ids":["odudu-admin"]}]}
```

```
HTTP/1.1 204 No Content
x-request-id: 01a1204c-4de9-7e43-80c8-dbf1b89fd6ae
cache-control: no-store
Date: Fri, 09 Oct 2026 10:53:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

This file, `q-state.sql`, run through the same `psql` as the refresh
sections, reads the console session's stored access-token expiry and
whether the grant is revoked. psql's trailing header spaces are trimmed
below:

```sql
select id, access_expires_at, access_expires_at - now() as remaining from console_sessions where tenant_id = '0199aa00-0000-7000-8000-000000000001' and subject_id = '01a1203a-f86d-7e8e-a537-e39f5d77b04f' and id = '01a1203f-0879-7a1c-bfb3-9ede557fa475';
select g.revoked_at is not null as revoked from token_grants g where g.session_id = '01a1203e-f2ca-78cb-833c-3ae98a36ca3d';
```

Right after the `DELETE`, the grant is revoked and the console session is
still there, its access token good for four more minutes:

```
                  id                  |     access_expires_at      |    remaining
--------------------------------------+----------------------------+-----------------
 01a1203f-0879-7a1c-bfb3-9ede557fa475 | 2026-10-09 10:58:34.254+00 | 00:04:40.003913
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
docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
cp jar jar-before-call
curl -sS -D - -c jar -b jar \
  http://localhost:3082/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f
docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < q-state.sql
curl -sS -D - -b jar-before-call http://localhost:3082/console/api/session
```

```
                  id                  |     access_expires_at      |    remaining
--------------------------------------+----------------------------+-----------------
 01a1203f-0879-7a1c-bfb3-9ede557fa475 | 2026-10-09 10:58:34.254+00 | 00:00:19.181579
(1 row)

 revoked
---------
 t
(1 row)
```

The `GET` is the session-ended `401`, and its cookie is cleared:

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a12050-49e1-7823-83b7-70f09b95f1fc
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Fri, 09 Oct 2026 10:58:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a12050-49e1-7823-83b7-70f09b95f1fc"}
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
x-request-id: 01a12050-4ab7-7137-83c3-f6d2dc04728c
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Fri, 09 Oct 2026 10:58:15 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a12050-4ab7-7137-83c3-f6d2dc04728c"}
```

The server's request log for that second shows which check ended it. The
`GET` never reached `/admin/`. The gateway refreshed first, under the
`GET`'s own request id, and the token endpoint answered `400`:

```bash
docker compose -p odudu-docs-12b logs --since $(cat p3-from.txt) odudu 2>&1 \
  | sed 's/^[^{]*//' \
  | jq -c 'select(.msg == "incoming request" or .msg == "request completed") | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
["01a12050-49e1-7823-83b7-70f09b95f1fc","GET","/console/api/admin/tenants/system/subjects/01a1203a-f86d-7e8e-a537-e39f5d77b04f"]
["01a12050-49e1-7823-83b7-70f09b95f1fc","POST","/tenants/system/protocol/openid-connect/token"]
["01a12050-49e1-7823-83b7-70f09b95f1fc",400,null]
["01a12050-49e1-7823-83b7-70f09b95f1fc",401,null]
["01a12050-4ab7-7137-83c3-f6d2dc04728c","GET","/console/api/session"]
["01a12050-4ab7-7137-83c3-f6d2dc04728c",401,null]
```

## `POST /console/auth/logout`

From the seventh run, on a second console session of `ada`'s, signed in with its
own `jar` and ended here, so the sections around it keep the first. Sent with no
body. The same CSRF guard applies here. `$SINCE` is the second before it:

```bash
curl -sS -D - -c jar -b jar -X POST \
  -H 'Origin: http://localhost:3082' -H 'X-Odudu-Console: 1' \
  http://localhost:3082/console/auth/logout
docker compose -p odudu-docs-12b logs --since $SINCE odudu 2>&1 \
  | sed 's/^[^{]*//' \
  | jq -c 'select(.msg == "incoming request" or .msg == "request completed") | [.reqId, .req.method // .res.statusCode, .req.url // null]'
```

```
HTTP/1.1 200 OK
x-request-id: 01a12040-dabb-7606-a68f-4dd2c7304ac6
cache-control: no-store
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/json; charset=utf-8
content-length: 713
Date: Fri, 09 Oct 2026 10:41:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"redirect":"http://localhost:3082/tenants/system/protocol/openid-connect/logout?id_token_hint=eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTEyMDNhLWY4NjItN2M0OC1hMWUwLWQxODAyMmE1NjMyYiJ9.eyJzdWIiOiIwMWExMjAzYS1mODZkLTdlOGUtYTUzNy1lMzlmNWQ3N2IwNGYiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwODIvdGVuYW50cy9zeXN0ZW0iLCJhdWQiOiJvZHVkdS1hZG1pbiIsImlhdCI6MTc5MTU0MjQ3NiwiZXhwIjoxNzkxNTQyNzc2LCJub25jZSI6IkNUZldrOFQ1WUNwX0ppRVVNaC1vZzhkQjkwLU80NE43Rjhya3lteU1ka0EiLCJzaWQiOiIwMWExMjA0MC1jMDRkLTdlOTItOTE3Zi1hZGY3OTZiZDBlOTMiLCJhbXIiOlsicHdkIl0sImFjciI6IjEifQ.ZZbqhRp1FSFfE0hzibzxLSyCkZ1LOCBTr3b3Brq4wh6hMtaGlWQy9I5FCTWeWd8wJZS4B-VwUVl9jUma4g39Kg&post_logout_redirect_uri=http%3A%2F%2Flocalhost%3A3082%2Fconsole%2F&client_id=odudu-admin"}
```

The log, with the stack's own health probes left out. The gateway revoked the
session's refresh token at the tenant's `/revoke`, signing the assertion it
authenticates with, and the endpoint answered `200`. An unsigned revocation would
have been refused and the token left alive; [the section above](#the-gateway-is-a-confidential-client)
shows that refusal:

```
["01a12040-dabb-7606-a68f-4dd2c7304ac6","POST","/console/auth/logout"]
["01a12040-dabb-7606-a68f-4dd2c7304ac6","POST","/tenants/system/protocol/openid-connect/revoke"]
["01a12040-dabb-7606-a68f-4dd2c7304ac6",200,null]
["01a12040-dabb-7606-a68f-4dd2c7304ac6","GET","/tenants/system/.well-known/openid-configuration"]
["01a12040-dabb-7606-a68f-4dd2c7304ac6",200,null]
["01a12040-dabb-7606-a68f-4dd2c7304ac6",200,null]
```

By the time this answered, the gateway had revoked the session's refresh
token, deleted its `console_sessions` row and cleared its cookie. The
tenant's SSO session is still live. Only the browser's own navigation to
`redirect` carries the SSO cookie, so the SPA follows it itself.

## Following the logout redirect

From the seventh run. `$REDIRECT` is the `redirect` above. The jar still holds
`system-session` from the sign-in.

```bash
curl -sS -D - -c jar -b jar "$REDIRECT"
```

```
HTTP/1.1 302 Found
x-request-id: 01a12040-db4a-7d9e-9fb1-c6bc676c7cea
set-cookie: system-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: system-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
cache-control: no-store
location: http://localhost:3082/console/
content-length: 0
Date: Fri, 09 Oct 2026 10:41:23 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

What is left, read from the database as the superuser, with these three
queries in a file piped to
`docker compose -p odudu-docs-12b exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'`.
Each query is scoped to this session's `console_sessions` row or to the SSO
session id `01a12040-c04d-…`, the one in the `system-session` cookie and the
ID token's `sid`. psql ends each header line with a space, which the
formatter trims below; nothing else differs from what it printed:

```sql
select count(*) as console_sessions from console_sessions where tenant_id = '0199aa00-0000-7000-8000-000000000001' and id = '01a12040-c096-7eef-8eac-4c64f5f6d0a4';
select id, expires_at <= now() as expired from sessions where id = '01a12040-c04d-7e92-917f-adf796bd0e93';
select g.session_id, g.revoked_at is not null as revoked from token_grants g join clients c on c.id = g.client_id where g.tenant_id = '0199aa00-0000-7000-8000-000000000001' and c.client_id = 'odudu-admin' and g.session_id = '01a12040-c04d-7e92-917f-adf796bd0e93';
```

```
 console_sessions
------------------
                0
(1 row)

                  id                  | expired
--------------------------------------+---------
 01a12040-c04d-7e92-917f-adf796bd0e93 | t
(1 row)

              session_id              | revoked
--------------------------------------+---------
 01a12040-c04d-7e92-917f-adf796bd0e93 | t
(1 row)
```

The console cookie from before the logout, sent again (from a copy of the
jar taken just before the logout), is an ended session:

```bash
curl -sS -D - -b jar-before-logout http://localhost:3082/console/api/session
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a12040-f610-7864-ab5f-dc37d2bafd61
set-cookie: odudu-console=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 130
Date: Fri, 09 Oct 2026 10:41:30 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":401,"type":"about:blank#console-session-ended","title":"Unauthorized","instance":"01a12040-f610-7864-ab5f-dc37d2bafd61"}
```

## `GET /console/`

The logout's `302` lands on the console shell. Every path under `/console/`
that neither the API nor the sign-in routes claim answers the shell, with
the gateway's CSP, and each hashed asset the shell names is served
`immutable`. The shell holds Instrument's tokens, the app frame, the
session gate and the sign-in flow; every area past the rail is still a
placeholder. See
[docs/request-paths.md](request-paths.md#what-is-not-implemented) for what
that leaves undone.

**The stack for this section only.** Not `docker-odudu-1`: a throwaway
compose project, `odudu-try`, built from this branch (`c43d473`) and
removed afterwards, on its own ports beside anything else running. The
shell reads no cookie, so none is sent.

```bash
cd infra/docker
COMPOSE_PROJECT_NAME=odudu-try ODUDU_HOST_PORT=3080 POSTGRES_HOST_PORT=5462 \
  docker compose up -d --build
```

```bash
curl -sS -D - http://localhost:3080/console/
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e930-f572-73dd-a1a4-1310c8d8b036
content-type: text/html; charset=utf-8
content-security-policy: default-src 'self'; script-src 'self'; style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o=' 'sha256-gYiS/BvZvRcK27JIXTuwhZ3hs2+VJ1X+2gUlE+farlg='; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
content-length: 412
Date: Mon, 28 Sep 2026 18:04:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Odudu console</title>
    <script type="module" crossorigin src="/console/assets/index-CYySuAHG.js"></script>
    <link rel="stylesheet" crossorigin href="/console/assets/index-BoHWD5ls.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

The two style hashes are React Aria's own injected `<style>` elements —
`usePress`'s pressable style and, on iOS WebKit only, `usePreventScroll`'s
`overscroll-behavior: contain` rule — recomputed from the installed
react-aria by `packages/console-gateway/src/view/react-aria-style.test.ts`.
The stylesheet is Instrument's tokens and fonts, built and hashed like any
other asset.

```bash
curl -sS -D - -o /dev/null http://localhost:3080/console/assets/index-CYySuAHG.js
```

```
HTTP/1.1 200 OK
x-request-id: 01a0e931-04aa-7699-a95f-fbc4d89fd7d0
content-type: text/javascript; charset=utf-8
cache-control: public, max-age=31536000, immutable
content-length: 562745
Date: Mon, 28 Sep 2026 18:04:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```bash
cd infra/docker
COMPOSE_PROJECT_NAME=odudu-try ODUDU_HOST_PORT=3080 POSTGRES_HOST_PORT=5462 \
  docker compose down -v
```

## What these runs do not show

Each item below is tested, not captured:

- **A read naming another subject**, refused `409` like a write, and the
  refusal of a session another sign-in in the same browser replaced. These
  are in `apps/server/tests/console-proxy.int.test.ts`.
- **The `502` on a token-endpoint failure.** A healthy stack's token
  endpoint answers a live grant's refresh, so this needs a fault injected
  into it. It is in `apps/server/tests/console-proxy.int.test.ts`.
- **The admin API's own `401`**, confirmed against the session's own tenant
  with a `whoami`, ending the session and revoking its grant only when that
  confirm is also a `401`, and passed through with the session kept for an
  unknown tenant or another tenant's path. These are in
  `apps/server/tests/console-proxy.int.test.ts`.
- **An assertion signed with a key no tenant registers, or naming another
  tenant's token endpoint**, redeeming a code: refused `invalid_client`, and
  the code stays good. It is in
  `apps/server/tests/console-client-authentication.int.test.ts`.
- **The `__Host-` cookies**, which need an `https` base. These are in
  `apps/server/tests/console-session.int.test.ts`, and the `conformance`
  job's `infra/conformance/run-console-check.sh` asserts both over that
  stack's TLS proxy ([its README](../infra/conformance/README.md#the-console-over-https)).
