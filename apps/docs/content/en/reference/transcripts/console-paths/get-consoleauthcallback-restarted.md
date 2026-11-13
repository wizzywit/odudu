---
title: 'GET /console/auth/callback, restarted'
description: 'A refused callback no longer ends on a refusal page: it restarts the sign-in once, for the tenant its state is bound to, with a fresh state.'
---

# `GET /console/auth/callback`, restarted

> **Not replayed after the device cookie.** A response on this page that ends a sign-in now also carries a `set-cookie` for `<tenant>-device`, which the blocks below do not show, because this page was captured before that cookie existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of the cookie.

This section runs on its own stack, on `http://localhost:3094`, with a throwaway
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
{"command":"tenant","created":true,"tenant":"signin-restart","tenantId":"01a17b03-b28e-7477-8a79-4e6796a78bf2"}
{"command":"user","tenant":"signin-restart","tenantId":"01a17b03-b28e-7477-8a79-4e6796a78bf2","username":"grace","userSubjectId":"01a17b03-b464-7e37-b47c-53c64db4c4f7"}
{"command":"grant-role","tenant":"signin-restart","tenantId":"01a17b03-b28e-7477-8a79-4e6796a78bf2","username":"grace","role":"odudu-admin:tenant-admin"}
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
x-request-id: 01a17b03-b666-7931-ab6c-7e3256094d0e
set-cookie: signin-restart-session=01a17b03-b698-74b5-97c0-b640136d27e0:YXIFQHHWZiRoTa4WrRF_D3fGg7WV5nnlYkOaKNxRRmg; HttpOnly; SameSite=Lax; Path=/
set-cookie: signin-restart-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/signin-restart/; Max-Age=0
location: http://localhost:3094/console/auth/callback?code=3BV3pWRJ-a9oR92gOWa66oiqNai5kFUrX4oxUrShk0U&state=01a17b03-b28e-7477-8a79-4e6796a78bf2.VnkBouNnhknVZ5-WY9-fIDVaYHQmTeR4pFSmnkcSGgw&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fsignin-restart
content-length: 0
Date: Tue, 27 Oct 2026 01:40:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The pending sign-in lasts 1800 seconds, in its row and in the login cookie's
`Max-Age`, as [`GET /console/auth/login`](./get-consoleauthlogin.md) shows. The row was expired with `psql` (header spaces trimmed, as above),
and the jar's login cookie was removed, as a browser drops it at its
`Max-Age`:

```sql
update console_logins set expires_at = now() - interval '1 second'
  where tenant_id = '01a17b03-b28e-7477-8a79-4e6796a78bf2';
select expires_at < now() as expired from console_logins
  where tenant_id = '01a17b03-b28e-7477-8a79-4e6796a78bf2';
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
x-request-id: 01a17b03-d67c-74fb-a3c7-adef2f3eb0a0
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=signin-restart
content-length: 0
Date: Tue, 27 Oct 2026 01:40:11 GMT
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
x-request-id: 01a17b03-d68a-70c9-923a-d7af5d99f9a8
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Tue, 27 Oct 2026 01:40:11 GMT
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
curl -sS -D - -o /dev/null -c jar -b jar 'http://localhost:3094/console/auth/login?tenant=signin-restart'
curl -sS -D - -o /dev/null -c jar -b jar "$AUTHORIZE"   # the location above
curl -sS -D - -o /dev/null -c jar -b jar "$CALLBACK"    # the location above
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-d6c8-7858-9b52-fef81e214195
cache-control: no-store
set-cookie: odudu-console-login=01a17b03-b28e-7477-8a79-4e6796a78bf2.EpIAqY1bAn6Y6L9sIIWy92hf_zOtmlRzHij9TSCtqCw; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
location: http://localhost:3094/tenants/signin-restart/protocol/openid-connect/auth?response_type=code&client_id=odudu-admin&redirect_uri=http%3A%2F%2Flocalhost%3A3094%2Fconsole%2Fauth%2Fcallback&scope=openid&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=01a17b03-b28e-7477-8a79-4e6796a78bf2.EpIAqY1bAn6Y6L9sIIWy92hf_zOtmlRzHij9TSCtqCw&nonce=SlFNK3ucrY5ApXLwV7ACV_ccoLdgy9MG4-s2bNJwm3k&code_challenge=DkLZ2631Hg-hGWjW_xAZNP73O5lIDRWTBvrOMJMOVsU&code_challenge_method=S256
content-length: 0
Date: Tue, 27 Oct 2026 01:40:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-d6df-78b1-9c85-fe8034ebe9e1
location: http://localhost:3094/console/auth/callback?code=Xtq1m2KLq1X26j5Ur-kOnjDjRCYp5zIzXzwxTszgAME&state=01a17b03-b28e-7477-8a79-4e6796a78bf2.EpIAqY1bAn6Y6L9sIIWy92hf_zOtmlRzHij9TSCtqCw&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fsignin-restart
content-length: 0
Date: Tue, 27 Oct 2026 01:40:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-d6ff-73a7-9083-880f663827fa
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console=01a17b03-b28e-7477-8a79-4e6796a78bf2.H0E1RcvNCbPMVIBBVTH79qRZ--aKZR99rpsbh-Ik-pc; HttpOnly; SameSite=Strict; Path=/
location: /console/
content-length: 0
Date: Tue, 27 Oct 2026 01:40:11 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The sign-in completed, and the restart cookie was cleared with the login
cookie. The code the stale callback carried, `3BV3pWRJ-a9oR92gOWa66oiqNai5kFUrX4oxUrShk0U`, was never
exchanged. The tenant's codes afterwards, each named by matching its stored
hash (base64url SHA-256) against the two codes above:

```sql
select case code_hash
    when translate(rtrim(encode(sha256(convert_to('3BV3pWRJ-a9oR92gOWa66oiqNai5kFUrX4oxUrShk0U', 'UTF8')), 'base64'), '='), '+/', '-_') then 'stale'
    when translate(rtrim(encode(sha256(convert_to('Xtq1m2KLq1X26j5Ur-kOnjDjRCYp5zIzXzwxTszgAME', 'UTF8')), 'base64'), '='), '+/', '-_') then 'restart'
  end as code, consumed_at is not null as consumed
  from authorization_codes where tenant_id = '01a17b03-b28e-7477-8a79-4e6796a78bf2' order by 1;
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
set-cookie: odudu-console-login=01a17b03-b28e-7477-8a79-4e6796a78bf2.FeeU_1kfCzAPvSi9cBbZRlk-G2ZXgzz2MC7g8wV0PJc; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800
```

A callback whose `state` keeps that tenant and carries another secret of the
same shape is answered exactly as the expired one was:

```bash
curl -sS -D - -c jar2 -b jar2 'http://localhost:3094/console/auth/callback?code=anything&state=01a17b03-b28e-7477-8a79-4e6796a78bf2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-f94e-7d4c-9a47-0452fe26231b
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/auth/login?tenant=signin-restart
content-length: 0
Date: Tue, 27 Oct 2026 01:40:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A `state` that names no tenant the gateway can read restarts at the
console's own `/console/` instead:

```bash
curl -sS -D - 'http://localhost:3094/console/auth/callback?code=anything&state=not-a-state&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b03-f958-7571-be94-4571aec34a0c
cache-control: no-store
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-console-restart=1; HttpOnly; SameSite=Lax; Path=/; Max-Age=60
location: /console/
content-length: 0
Date: Tue, 27 Oct 2026 01:40:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A callback with no `state` at all, which no sign-in of this console's
produces, is shown the page at once, with no restart cookie:

```bash
curl -sS -D - 'http://localhost:3094/console/auth/callback?code=anything&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fsignin-restart'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a17b03-f960-7461-bf1f-dfe31d90a8fe
set-cookie: odudu-console-login=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
content-type: text/html; charset=utf-8
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 888
Date: Tue, 27 Oct 2026 01:40:20 GMT
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
