---
title: 'GET /console/auth/callback, restarted'
description: 'A refused callback no longer ends on a refusal page: it restarts the sign-in once, for the tenant its state is bound to, with a fresh state.'
---

# `GET /console/auth/callback`, restarted

This section runs on its own stack, on `http://localhost:3000`, with a throwaway
tenant, `signin-restart`, holding `grace` as its administrator. A curl cookie
jar, `jar`, plays one browser throughout. The seed printed:

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name signin-restart
docker compose exec -T odudu node dist/main.js seed user --tenant signin-restart \
  --username grace --password signin-restart-throwaway
docker compose exec -T odudu node dist/main.js seed grant-role --tenant signin-restart \
  --username grace --role odudu-admin:tenant-admin
```

```
{"command":"tenant","created":true,"tenant":"signin-restart","tenantId":"01a1e3fb-d035-78ec-b0de-63555c0ca03d"}
{"command":"user","tenant":"signin-restart","tenantId":"01a1e3fb-d035-78ec-b0de-63555c0ca03d","username":"grace","userSubjectId":"01a1e3fb-d260-70ea-ad75-e4b57977a1c5"}
{"command":"grant-role","tenant":"signin-restart","tenantId":"01a1e3fb-d035-78ec-b0de-63555c0ca03d","username":"grace","role":"odudu-admin:tenant-admin"}
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
[the first run](./get-consoleauthlogin.md). The `authenticate` request answered:

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fb-d485-7002-8705-678529a650e9
set-cookie: signin-restart-session=01a1e3fb-d4b3-785e-87ef-ac043ea0d345:eouH7OE_E6s-xzMroN0c0njGNsyXh0i4Ixxg4cdM0YM; HttpOnly; SameSite=Lax; Path=/
set-cookie: signin-restart-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: signin-restart-device=FiLKnTWL5v_iC3vPKy6Ipg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/signin-restart/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=S_9KL1zmFYsFGsZ7t0B7sPdC5l4kDOgSNF_Hh3S4cAM&state=01a1e3fb-d035-78ec-b0de-63555c0ca03d.n-1VvXVi1QoYxXEMGb9kT7pvj7HPAWgPTcMn7WhC3gc&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsignin-restart
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The pending sign-in lasts 1800 seconds, in its row and in the login cookie's
`Max-Age`, as [`GET /console/auth/login`](./get-consoleauthlogin.md) shows. The row was expired with `psql` (header spaces trimmed, as above),
and the jar's login cookie was removed, as a browser drops it at its
`Max-Age`:

```sql
update console_logins set expires_at = now() - interval '1 second'
  where tenant_id = '01a1e3fb-d035-78ec-b0de-63555c0ca03d';
select expires_at < now() as expired from console_logins
  where tenant_id = '01a1e3fb-d035-78ec-b0de-63555c0ca03d';
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
x-request-id: 01a1e3fb-d52f-772c-a3ab-61557bfad292
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=signin-restart
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
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
x-request-id: 01a1e3fb-d53a-73af-a512-92553967bfd4
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Mon, 16 Nov 2026 10:51:34 GMT
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

**Following the restart.** The tenant's own session, set by the stale
sign-in, answers the fresh authorization request at once:

```bash
curl -sS -D - -o /dev/null -c jar -b jar 'http://localhost:3000/console/auth/login?tenant=signin-restart'
curl -sS -D - -o /dev/null -c jar -b jar "$AUTHORIZE"   # the location above
curl -sS -D - -o /dev/null -c jar -b jar "$CALLBACK"    # the location above
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fb-d546-7e39-92bf-88eb8e437798
cache-control: no-store
set-cookie: odudu-console-login=01a1e3fb-d035-78ec-b0de-63555c0ca03d.BiabuVjMRKw-0TFkpCjzOJnmsxoiMBQk8J9dPTmA9iY; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3000/tenants/signin-restart/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a1e3fb-d035-78ec-b0de-63555c0ca03d.BiabuVjMRKw-0TFkpCjzOJnmsxoiMBQk8J9dPTmA9iY&nonce=wc-jjtCOtgfOLxBxvwJBHoRtSfDB3VwIRAFvRM4-C4Q&code_challenge=X1znvltCy5lH8z1fCAs6XECLIpGqw31au9qjpBVkHUk&code_challenge_method=S256
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fb-d55a-7c84-ac4f-e483415f9ba8
location: http://localhost:3000/console/auth/callback?code=nCZV9X7qODUIAA1rKwYLDL1Nntih-d8AgJlBRTil9L8&state=01a1e3fb-d035-78ec-b0de-63555c0ca03d.BiabuVjMRKw-0TFkpCjzOJnmsxoiMBQk8J9dPTmA9iY&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsignin-restart
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fb-d579-7f11-aaf1-8d8237a84efe
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a1e3fb-d035-78ec-b0de-63555c0ca03d.YlbObz34G4tXnYV-9rvWv9StzljgVSsTi000UyQHXcM; HttpOnly; SameSite=Strict; Path=/
location: /console/
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The sign-in completed, and the restart cookie was cleared with the login
cookie. The code the stale callback carried, `S_9KL1zmFYsFGsZ7t0B7sPdC5l4kDOgSNF_Hh3S4cAM`, was never
exchanged. The tenant's codes afterwards, each named by matching its stored
hash (base64url SHA-256) against the two codes above:

```sql
select case code_hash
    when translate(rtrim(encode(sha256(convert_to('S_9KL1zmFYsFGsZ7t0B7sPdC5l4kDOgSNF_Hh3S4cAM', 'UTF8')), 'base64'), '='), '+/', '-_') then 'stale'
    when translate(rtrim(encode(sha256(convert_to('nCZV9X7qODUIAA1rKwYLDL1Nntih-d8AgJlBRTil9L8', 'UTF8')), 'base64'), '='), '+/', '-_') then 'restart'
  end as code, consumed_at is not null as consumed
  from authorization_codes where tenant_id = '01a1e3fb-d035-78ec-b0de-63555c0ca03d' order by 1;
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
set-cookie: odudu-console-login=01a1e3fb-d035-78ec-b0de-63555c0ca03d.5PTn6p4-RUQEktQ0dQ9mhBzWUjJnzMcE7byFuBxQllc; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
```

A callback whose `state` keeps that tenant and carries another secret of the
same shape is answered exactly as the expired one was:

```bash
curl -sS -D - -c jar2 -b jar2 'http://localhost:3000/console/auth/callback?code=anything&state=01a1e3fb-d035-78ec-b0de-63555c0ca03d.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fb-d619-7d87-8118-154c787ad031
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=signin-restart
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A `state` that names no tenant the gateway can read restarts at the
console's own `/console/` instead:

```bash
curl -sS -D - 'http://localhost:3000/console/auth/callback?code=anything&state=not-a-state&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3fb-d623-777b-b17a-ecae41cf147e
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/
content-length: 0
Date: Mon, 16 Nov 2026 10:51:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A callback with no `state` at all, which no sign-in of this console's
produces, is shown the page at once, with no restart cookie:

```bash
curl -sS -D - 'http://localhost:3000/console/auth/callback?code=anything&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1e3fb-d62c-7dba-8bb4-c8ce5a8f9a78
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Mon, 16 Nov 2026 10:51:34 GMT
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
