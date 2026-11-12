---
title: 'GET /console/auth/callback, refused'
description: 'A callback whose state does not match the login cookie restarts the sign-in once; a second refusal inside the minute shows a page that links back.'
---

# `GET /console/auth/callback`, refused

> **Not replayed after the device cookie.** A response on this page that ends a sign-in now also carries a `set-cookie` for `<tenant>-device`, which the blocks below do not show, because this page was captured before that cookie existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of the cookie.

The sign-in and the refusals up to the authorization endpoint's error are from a
later run, once a first refusal began to answer a restart and the page began to
link back to the console; what follows them is from an earlier one. The sign-in
used the same `login`, authorization-endpoint and `authenticate` requests as the
first run. The two that set what this section uses answered:

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-1cfa-7091-841d-dd6e40e29110
cache-control: no-store
set-cookie: odudu-console-login=01a17b02-1a9a-78f4-a746-1a223a533ca7.ZzCUF6fLgdyKbKXtC5Rx2_rxQ-hFGyGiEyL5Z-QhdKw; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3513/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3513%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.ZzCUF6fLgdyKbKXtC5Rx2_rxQ-hFGyGiEyL5Z-QhdKw&nonce=6JEInnRMH6Fwd2B1m7RjCFY7S3daJwqQPGWfCLRsHSU&code_challenge=XcAHVE2yfJmwtmvSbq-iMkVphoa-voyQLQ4ldj7YPl0&code_challenge_method=S256
content-length: 0
Date: Tue, 27 Oct 2026 01:39:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-1d2a-7151-bfea-01df1d25c3ba
set-cookie: console-paths-session=01a17b03-1d66-70de-8579-88ed1a7c721a:XAM0jCuOepyJT3JOedqh-69M2QRz4grx09AeIUT3hMs; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=0
location: http://localhost:3513/console/auth/callback?code=PJk7OQtyPvArgHkaEn1KvZrGJ34wT3yFNASEr7tkF94&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.ZzCUF6fLgdyKbKXtC5Rx2_rxQ-hFGyGiEyL5Z-QhdKw&iss=http%3A%2F%2Flocalhost%3A3513%2Ftenants%2Fconsole-paths
content-length: 0
Date: Tue, 27 Oct 2026 01:39:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A copy of the jar, `jar-before-callback`, was taken here. A refused callback
clears the login cookie, so each refused request below is sent without
`-c`, and the jar it reads still holds the login cookie.

**A `state` that does not match the login cookie.** The code and `iss` are the
real ones; the `state` keeps the tenant half and replaces the secret. Each
callback here ran on `http://localhost:3513`, with `jar` holding the login
cookie that sign-in set and `$BAD` the callback below:

```bash
curl -sS -D - -b jar "$BAD"
```

`$BAD`, whose `state` is `<tenant id>.not-the-login-secret`:

```
http://localhost:3513/console/auth/callback?code=PJk7OQtyPvArgHkaEn1KvZrGJ34wT3yFNASEr7tkF94&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.not-the-login-secret&iss=http%3A%2F%2Flocalhost%3A3513%2Ftenants%2Fconsole-paths
```

The first refusal restarts the sign-in rather than showing a page, and sets
`odudu-console-restart` so a second one inside its minute cannot loop:

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-1d82-77e1-b798-b4f59c168a51
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/
content-length: 0
Date: Tue, 27 Oct 2026 01:39:24 GMT
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
x-request-id: 01a17b03-1d8b-704f-9750-b1fba97c267c
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Tue, 27 Oct 2026 01:39:24 GMT
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
x-request-id: 01a17b03-384a-7161-be87-d11edcf4fa10
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a17b02-1a9a-78f4-a746-1a223a533ca7.rgE7db3AT1Kzlh00s4AFvpFP69zzSMWCYgLxxyfYJ2I; HttpOnly; SameSite=Strict; Path=/
location: /console/x
content-length: 0
Date: Tue, 27 Oct 2026 01:39:31 GMT
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
odudu-console-login	01a17b02-1a9a-78f4-a746-1a223a533ca7.ZzCUF6fLgdyKbKXtC5Rx2_rxQ-hFGyGiEyL5Z-QhdKw
```

```bash
curl -sS -D - -b jar-before-callback "$CB"
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-3882-792c-ad69-eee675813526
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=console-paths
content-length: 0
Date: Tue, 27 Oct 2026 01:39:31 GMT
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
x-request-id: 01a17b03-388e-7f70-b51c-bc4f7f920340
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Tue, 27 Oct 2026 01:39:31 GMT
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
login cookie and `state`:

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/login?tenant=console-paths&return_to=/console/x'
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-3899-79d6-ac22-c5338e6961db
cache-control: no-store
set-cookie: odudu-console-login=01a17b02-1a9a-78f4-a746-1a223a533ca7.JpWX1mygP-y_eW_pmJCcjIpLpdiuNuapMHJ2yBFEU5Q; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/console-paths/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.JpWX1mygP-y_eW_pmJCcjIpLpdiuNuapMHJ2yBFEU5Q&nonce=mrMk-q_x96XbbYAL6NqIB14HZX6D-yjJVwuYoSTpkps&code_challenge=-mhTpt2efEcray3yZV19a8oKrOQ8k0LIMjUuUcoPnm0&code_challenge_method=S256
content-length: 0
Date: Tue, 27 Oct 2026 01:39:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The callback an authorization endpoint sends when the user refuses, with
that pending `state` and its login cookie:

```bash
curl -sS -D - -c jar -b jar \
  'http://localhost:3000/console/auth/callback?error=access_denied&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.JpWX1mygP-y_eW_pmJCcjIpLpdiuNuapMHJ2yBFEU5Q'
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
select id, created_at from console_sessions where tenant_id = '01a17b02-1a9a-78f4-a746-1a223a533ca7';
select count(*) as console_logins from console_logins where tenant_id = '01a17b02-1a9a-78f4-a746-1a223a533ca7';
```

```
                  id                  |         created_at
--------------------------------------+----------------------------
 01a17b03-3871-701b-be14-10a33a8ccbe0 | 2026-10-27 01:39:31.019+00
(1 row)

 console_logins
----------------
              0
(1 row)
```

One session, created at 01:39:31 by the callback that signed in. The first
run's session had been ended with a console logout before the query, so it
is not counted. The two refusals and the error callback created none, and no
pending sign-in is left. That session is the one every later second-run
section uses.
