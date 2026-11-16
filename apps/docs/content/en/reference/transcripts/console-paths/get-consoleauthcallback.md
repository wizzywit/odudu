---
title: 'GET /console/auth/callback'
description: 'The console callback that takes the tenant sign-in redirect, ends the login cookie and starts the console session.'
---

# `GET /console/auth/callback`

`$LOCATION` is the `location` above.

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3f8-f8e7-7936-bcac-7ff0970db5b5
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a1e3f8-ef88-7bd7-af39-bd6085c44bef.xZrH5PylubWDpNnsqUI72b-KVUHF6X-X9ZVgU5mbWaM; HttpOnly; SameSite=Strict; Path=/
location: /console/x
content-length: 0
Date: Mon, 16 Nov 2026 10:48:27 GMT
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

## Behind TLS

With `ODUDU_TLS=true` the console's cookies carry the `__Host-` prefix and
`Secure`, which the sections above, run over plain http, do not show. This
section ran on the same stack, restarted with `ODUDU_TLS=true` and
`ODUDU_PUBLIC_BASE_URL=https://localhost:3000`, which the server refuses to
start without when TLS is on, and with `odudu console provision` run once for
the new base. The stack still speaks http, so curl was sent the cookies by hand,
as `$LOGIN_COOKIE` and `$SESSION_COOKIE` (curl does not send a `Secure` cookie
over http), and the `location` it follows is the http form of the same path.

```bash
curl -sS -D - 'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b1b-a47d-71ea-9f51-9624f067673b
cache-control: no-store
set-cookie: __Host-odudu-console-login=01a17b02-1a9a-78f4-a746-1a223a533ca7.yylnZsOwpnFCCe2eUfNJpsDi1vOEKfPmGSg6ZKLnf9A; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800; Secure
location: https://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=https%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.yylnZsOwpnFCCe2eUfNJpsDi1vOEKfPmGSg6ZKLnf9A&nonce=H07bt0XlIZq-xke_i-KPZyeZv0zp-MYDDiJCJq52qa8&code_challenge=QGkew__DR6snUVBDf3XGd4FNRnoNXy3vu6W0BpxGnwo&code_challenge_method=S256
content-length: 0
Date: Tue, 27 Oct 2026 02:06:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The tenant's own sign-in sets its cookies the same way
(`__Secure-odudu-sign-in`, then `__Host-console-paths-session`). The callback
that follows it clears the login cookie and the restart cookie under their
prefixed names and sets the session cookie:

```bash
curl -sS -D - -H "Cookie: $LOGIN_COOKIE" "$LOCATION"
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b1b-bad7-7031-a5fa-c3209e92ba4a
cache-control: no-store
set-cookie: __Host-odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure
set-cookie: __Host-odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure
set-cookie: __Host-odudu-console=01a17b02-1a9a-78f4-a746-1a223a533ca7.eaT5PA9T4bTFQ6dE5fEVqW8NEy4EkqMN56ylIcFElTg; HttpOnly; SameSite=Strict; Path=/; Secure
location: /console/x
content-length: 0
Date: Tue, 27 Oct 2026 02:06:17 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A refused callback sets the restart cookie under its prefixed name too:

```bash
curl -sS -D - 'http://localhost:3000/console/auth/callback?code=x&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.not-the-login-secret'
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b1b-d066-7eba-912b-3e87c4a7c121
cache-control: no-store
set-cookie: __Host-odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Secure
set-cookie: __Host-odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60; Secure
location: /console/
content-length: 0
Date: Tue, 27 Oct 2026 02:06:22 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The write guard follows the base: a logout sent with the `Origin` of the
`http` address the stack really speaks is refused, because the base is now
`https`:

```bash
curl -sS -D - -X POST -H 'Origin: http://localhost:3000' -H 'X-Odudu-Console: 1' \
  -H "Cookie: $SESSION_COOKIE" http://localhost:3000/console/auth/logout
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a17b1b-d0a9-7c90-b3ef-db5b44e49b27
content-type: application/problem+json; charset=utf-8
cache-control: no-store
content-length: 155
Date: Tue, 27 Oct 2026 02:06:22 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"status":403,"type":"about:blank","title":"Forbidden","detail":"refused as cross-site: origin-mismatch","instance":"01a17b1b-d0a9-7c90-b3ef-db5b44e49b27"}
```
