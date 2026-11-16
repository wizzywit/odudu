---
title: "The tenant's own sign-in"
description: "The two requests between the gateway's redirect and its callback are the tenant's authorization endpoint and sign-in form, which…"
---

# The tenant's own sign-in

The two requests between the gateway's redirect and its callback are the
tenant's authorization endpoint and sign-in form, which [the request
paths](../request-paths/index.md) documents. They are shown here only so that
the callback below has a real code. `$LOCATION` is the `location` the `login`
above printed.

```bash
curl -sS -D - -c jar -b jar "$LOCATION" | sed '/<\/form>/q'; echo '…'
```

The page continues with the passkey form and its script; the block stops
at the end of the password form, where a `…` line says so.

```
HTTP/1.1 200 OK
x-request-id: 01a1e40a-9c67-77cd-977e-9299aaf9e999
set-cookie: odudu-sign-in=01a1e40a-9c6e-7dc2-bb67-9ee780e76199.Iv3yC32GPDRGsFtSwlCT9xWLxFVPFc-w2Q2Tigi6PfU; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=1800
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:3000; base-uri 'none'; script-src 'nonce-wzIeEjgGPGQHv1JKRj0wTA=='; connect-src 'self'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3581
Date: Mon, 16 Nov 2026 11:07:43 GMT
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
  <input type="hidden" name="auth_session_id" value="01a1e40a-9c6e-7dc2-bb67-9ee780e76199">
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
  --data-urlencode auth_session_id=$AUTHSID \
  --data-urlencode username=grace \
  --data-urlencode password=console-paths-throwaway \
  http://localhost:3000/tenants/console-paths/login-actions/authenticate
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e40a-9c81-77f8-9412-5acf0ad2b349
set-cookie: console-paths-session=01a1e40a-9ccb-7fb9-b81d-fe193820f4bc:Th1Jy-A2vQC6inJrp8zu-A0MrvPB9Li8XHh8bb29kC4; HttpOnly; SameSite=Lax; Path=/
set-cookie: console-paths-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: console-paths-device=7uZOFjMCF2TN0YpZD2r-Bw; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/console-paths/; Max-Age=0
location: http://localhost:3000/console/auth/callback?code=TPYJy1W24fZC4lIciERQie-HnpWIvh9sK8jClNPoHh4&state=01a1e40a-95ad-78bf-80da-9bd2262c5363.BjO0JkIDSX4IKGzjT5SPzjFbf88k8pjLgVqbPXBFe48&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsole-paths
content-length: 0
Date: Mon, 16 Nov 2026 11:07:43 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

`console-paths-session` is the tenant's SSO cookie. The logout below needs
the browser to send it.
