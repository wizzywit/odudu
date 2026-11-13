---
title: "The tenant's own sign-in"
description: "The two requests between the gateway's redirect and its callback are the tenant's authorization endpoint and sign-in form, which…"
---

# The tenant's own sign-in

> **Not replayed after the device cookie.** A response on this page that ends a sign-in now also carries a `set-cookie` for `<tenant>-device`, which the blocks below do not show, because this page was captured before that cookie existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of the cookie.

The two requests between the gateway's redirect and its callback are the
tenant's authorization endpoint and sign-in form, which [the request
paths](../request-paths/index.md) documents. They are shown here only so that
the callback below has a real code. `$LOCATION` is the `location` the `login`
above printed.

```bash
curl -sS -D - -c jar -b jar "$LOCATION"
```

The page continues with the passkey form and its script; the block stops
at the end of the password form, where a `…` line says so.

```
HTTP/1.1 200 OK
x-request-id: 01a17b02-8ab9-72ca-8420-9d0b5cb0db9c
set-cookie: odudu-sign-in=01a17b02-8ad6-7f28-a5de-160ccba3fde5.3ljPUKnwSzSEvf4Wr9sA-93R5HntWiLC7yd16IfCg3s; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=1800
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:3000; base-uri 'none'; script-src 'nonce-GV/Ii0wiUDX9O6SDtClJVA=='; connect-src 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3581
Date: Tue, 27 Oct 2026 01:38:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Sign in</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Sign in</h1>
<p class="context">to continue to <bdi>Odudu administration</bdi></p>
<p class="tenant"><bdi>console-paths</bdi></p>
</header>
<form method="post" action="/tenants/console-paths/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a17b02-8ad6-7f28-a5de-160ccba3fde5">
  <label>Username <input type="text" name="username" autocomplete="username"></label>
  <label>Password <input type="password" name="password" autocomplete="current-password"></label>
  <button type="submit">Sign in</button>
</form>
…
```

The policy on this page also names the origin of the console's own
`redirect_uri` in `form-action`, as every page that continues an
authorization request does
([ADR 0018](https://github.com/wizzywit/odudu/blob/main/docs/adr/0018-framing-defence-on-rendered-pages.md)'s second
amendment). For the console that is the server's own origin, so nothing it
can reach changes.

```bash
curl -sS -D - -c jar -b jar -X POST \
  --data-urlencode auth_session_id=01a17b02-8ad6-7f28-a5de-160ccba3fde5 \
  --data-urlencode username=grace \
  --data-urlencode password=console-paths-throwaway \
  http://localhost:3000/tenants/console-paths/login-actions/authenticate
```

```
HTTP/1.1 302 Found
x-request-id: 01a17b02-c88f-7021-ab16-c3c59c320339
set-cookie: console-paths-session=01a17b02-c90d-7d65-a61c-8380a55dceed:JcZY8IODtyTttYAwKcuAlTa9PDDtc1ho--5ZtooaGT4; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=85eAmeU6LFGcTdS2rwRq1DbseXWPhqCrhtszaj9-Q34&state=01a17b02-1a9a-78f4-a746-1a223a533ca7.3CtlssHNJxU43xqp5aDXjUjTYI3DUcyyvPx-gvAS0dI&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
content-length: 0
Date: Tue, 27 Oct 2026 01:39:02 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

`console-paths-session` is the tenant's SSO cookie. The logout below needs
the browser to send it.
