---
title: 'GET /console/auth/callback, refused'
description: 'A callback whose state does not match the login cookie restarts the sign-in once; a second refusal inside the minute shows a page that links back.'
---

# `GET /console/auth/callback`, refused

This page is one run, on a database that held the tenant and its administrator and nothing else. The sign-in used the same
`login`, authorization-endpoint and `authenticate` requests as the first run, with `jar` as its cookie jar. The two that set what this section uses answered:

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7e9b-78ac-88fc-0ee61ab65335
cache-control: no-store
set-cookie: odudu-console-login=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.GihHGzT1tUkPLunylh5nFoxdJU4S1xwN-vB5D7HasHQ; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.GihHGzT1tUkPLunylh5nFoxdJU4S1xwN-vB5D7HasHQ&nonce=btwWLBHgoCseHC0qiCGRmha8MC68MQjhtnGSvGvbpes&code_challenge=SD6VmGFL4L02wKEvjpdt7agz_aafGwHw80u-UUBGFh0&code_challenge_method=S256
content-length: 0
Date: Mon, 16 Nov 2026 10:50:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7ec9-7e70-9b34-967bec49da4c
set-cookie: console-paths-session=01a1e3fa-7f01-7383-b4c5-226f581cf311:ktWcbgPXa4o0yBFfiTeWjSq2t8X_z2u0zBh3ybYic54; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: console-paths-device=K5FivSVs_rRA64Lr2o5hZw; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=jLX9PWyvBGRB1QJ61uHbvCfUMEexeHdLfPmxq7d99iw&state=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.GihHGzT1tUkPLunylh5nFoxdJU4S1xwN-vB5D7HasHQ&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
content-length: 0
Date: Mon, 16 Nov 2026 10:50:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A copy of the jar, `jar-before-callback`, was taken here. A refused callback
clears the login cookie, so each refused request below is sent without
`-c`, and the jar it reads still holds the login cookie.

**A `state` that does not match the login cookie.** The code and `iss` are the
real ones; the `state` keeps the tenant half and replaces the secret. Each
callback here ran on `http://localhost:3000`, with `jar` holding the login
cookie that sign-in set and `$BAD` the callback below:

```bash
curl -sS -D - -b jar "$BAD"
```

`$BAD`, whose `state` is `<tenant id>.not-the-login-secret`:

```
http://localhost:3000/console/auth/callback?code=jLX9PWyvBGRB1QJ61uHbvCfUMEexeHdLfPmxq7d99iw&state=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.not-the-login-secret&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
```

The first refusal restarts the sign-in rather than showing a page, and sets
`odudu-console-restart` so a second one inside its minute cannot loop:

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7f1e-7007-85c5-b649504740f8
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/
content-length: 0
Date: Mon, 16 Nov 2026 10:50:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The same request with that cookie sent answers the page. Its second header
block is the whole response:

```bash
curl -sS -D - -b jar -b odudu-console-restart=1 "$BAD"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1e3fa-7f29-7435-a978-29c6bdad613d
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Mon, 16 Nov 2026 10:50:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign-in failed</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
<p><a href="/console/">Sign in again</a></p>
</main>
</body>
</html>
```

A mismatched `state` is refused before the pending sign-in is read, so the
pending sign-in and the code both survived it. The real callback, `$CB`, with
the same code, then signed in:

```bash
curl -sS -D - -c jar -b jar "$CB"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7f32-74cc-934c-83f9fcd1200a
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.96h82PM1-HA2fIZZkCc5Ehyv-SD4vtqwQKpfyeMQG_o; HttpOnly; SameSite=Strict; Path=/
location: /console/x
content-length: 0
Date: Mon, 16 Nov 2026 10:50:07 GMT
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
odudu-console-login	01a1e3fa-7a8e-7dec-8617-cf1d8216b618.GihHGzT1tUkPLunylh5nFoxdJU4S1xwN-vB5D7HasHQ
```

```bash
curl -sS -D - -b jar-before-callback "$CB"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7f72-7497-ac94-4b82c5f5be95
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=console-paths
content-length: 0
Date: Mon, 16 Nov 2026 10:50:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The first refusal restarts again, this time to the tenant's own sign-in. With
the restart cookie sent, as above, it is the page:

```bash
curl -sS -D - -b jar-before-callback -b odudu-console-restart=1 "$CB"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1e3fa-7f7d-7d9b-9b90-278706094198
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Mon, 16 Nov 2026 10:50:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign-in failed</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Sign-in failed</h1>
<p>The sign-in could not be completed.</p>
<p><a href="/console/">Sign in again</a></p>
</main>
</body>
</html>
```

`$CB` is the `location` the tenant's `authenticate` answered, `$BAD` is `$CB`
with the secret replaced, and both are from this run. The first callback took
the pending sign-in, so the replay found none and was refused before the code
was presented again.

**An error from the authorization endpoint.** A new sign-in gave a new
login cookie and `state`, which `$STATE2` holds:

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7f88-7bd6-be42-e35bd35d7b99
cache-control: no-store
set-cookie: odudu-console-login=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.E30CfsM3oGxOGT5B000ObldCMJMGyUv5BEBjKUINESM; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a1e3fa-7a8e-7dec-8617-cf1d8216b618.E30CfsM3oGxOGT5B000ObldCMJMGyUv5BEBjKUINESM&nonce=99KCyxr8c--kh5qZL7caGnkJ1i-on3csAWee5zBHB5I&code_challenge=k2oxTYsEcz2KgoxrCRvXvJ7UOhlybnc9X7Cv2Cbf7mU&code_challenge_method=S256
content-length: 0
Date: Mon, 16 Nov 2026 10:50:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The callback an authorization endpoint sends when the user refuses, with
that pending `state` and its login cookie:

```bash
curl -sS -D - -c jar -b jar \
  "http://localhost:3000/console/auth/callback?error=access_denied&state=$STATE2"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fa-7f94-7b24-98df-07f1031cbfe8
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
location: /console/?login_error=access_denied
content-length: 0
Date: Mon, 16 Nov 2026 10:50:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The gateway took the pending sign-in and cleared its cookie.

What the tenant held afterwards, with the same `psql` as the first run's
closing queries and the same trimmed header spaces:

```sql
select id, created_at from console_sessions where tenant_id = '01a1e3fa-7a8e-7dec-8617-cf1d8216b618';
select count(*) as console_logins from console_logins where tenant_id = '01a1e3fa-7a8e-7dec-8617-cf1d8216b618';
```

```
                  id                  |         created_at
--------------------------------------+----------------------------
 01a1e3fa-7f63-76b0-9a9f-6dc248f20b55 | 2026-11-16 10:50:07.027+00
(1 row)

 console_logins
----------------
              0
(1 row)
```

One session, created at 10:50:07 by the callback that signed in. The first
run's session had been ended with a console logout before the query, so it
is not counted. The two refusals and the error callback created none, and no
pending sign-in is left. That session is the one every later second-run
section uses.
