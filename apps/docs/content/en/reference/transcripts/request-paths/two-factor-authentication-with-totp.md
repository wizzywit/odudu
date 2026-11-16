---
title: 'Two-factor authentication with TOTP'
description: "A tenant's otp_required decides whether every subject in it is expected to hold a second factor."
---

# Two-factor authentication with TOTP

A tenant's `otp_required` decides whether every subject in it is expected to
hold a second factor. It is off by default, like the three account-lifecycle
settings above: a tenant does not acquire a second factor because it was
upgraded. Off does not mean "no second factor" — a subject who has enrolled
one is always asked for it. What `otp_required` adds is everybody else: a
subject with no TOTP credential is given the `configure-totp` required
action at their next login, and the login does not complete until they have
enrolled.

On a stack of its own, started on an empty volume (each block names its port),
with this section, the `otp-demo` half of [Recovery codes](./recovery-codes.md)
and its `rc8-demo` half run front to back against it. The HTML bodies are the
bytes it served, line breaks, indentation and all. A fenced response block
carries no language tag, so Prettier leaves them alone.

`otp_required` is a tenant setting, which `seed tenant --set` applies:

```bash
odudu seed \
  --tenant otp-demo --client otp-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery
odudu seed tenant --name otp-demo --set otp_required=true
```

```
{"created":true,"tenant":"otp-demo","tenantId":"01a1e3f4-c245-7665-8689-ddd831abe8be","clientId":"otp-spa","userSubjectId":"01a1e3f4-c2e0-7767-8801-9e564d3486a9"}
{"command":"tenant","created":false,"tenant":"otp-demo","tenantId":"01a1e3f4-c245-7665-8689-ddd831abe8be","settings":["otp_required"]}
```

`created` is `false` because the line above it made the tenant: `seed tenant`
resolves one or creates it, and `--set` then applies to whichever it found.
The settings are echoed as they were given.

## The password is right, and the login still does not finish

`/authorize` parks the request and renders the same password form
[Path A](./path-a-authorization-code-with-pkce.md) shows — nothing about a
second factor is decided before somebody has said who they are, because
which account a code belongs to is not knowable until then.

```bash
AUTH=$(curl -sS 'http://localhost:3000/tenants/otp-demo/protocol/openid-connect/auth?response_type=code&client_id=otp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')
```

The `auth_session_id` in that form, which the line above keeps as `$AUTH`, is what
every request below carries. Posting the correct
password answers 200 with an enrolment page rather than 302 with a code:
the password was accepted, and the pending action is what stops the login
from completing (no `set-cookie`, no `code`).

```bash
curl -sS -X POST http://localhost:3000/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' | tee enrol.html
SECRET=$(sed -n 's/.*name="secret" value="\([^"]*\)".*/\1/p' enrol.html)
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Set up your authenticator</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Set up your authenticator</h1>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<p>Scan this with your authenticator app, or enter the key by hand.</p>
<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 188 188"  preserveAspectRatio="xMinYMin meet"><rect width="100%" height="100%" fill="white" cx="0" cy="0"/><path d="M4,4l4,0 0,4 -4,0 0,-4z M8,4l4,0 0,4 -4,0 0,-4z M12,4l4,0 0,4 -4,0 0,-4z M16,4l4,0 0,4 -4,0 0,-4z M20,4l4,0 0,4 -4,0 0,-4z M24,4l4,0 0,4 -4,0 0,-4z M28,4l4,0 0,4 -4,0 0,-4z M36,4l4,0 0,4 -4,0 0,-4z M44,4l4,0 0,4 -4,0 0,-4z M60,4l4,0 0,4 -4,0 0,-4z M64,4l4,0 0,4 -4,0 0,-4z M68,4l4,0 0,4 -4,0 0,-4z M76,4l4,0 0,4 -4,0 0,-4z M84,4l4,0 0,4 -4,0 0,-4z M92,4l4,0 0,4 -4,0 0,-4z M108,4l4,0 0,4 -4,0 0,-4z M112,4l4,0 0,4 -4,0 0,-4z M124,4l4,0 0,4 -4,0 0,-4z M128,4l4,0 0,4 -4,0 0,-4z M132,4l4,0 0,4 -4,0 0,-4z M148,4l4,0 0,4 -4,0 0,-4z M156,4l4,0 0,4 -4,0 0,-4z M160,4l4,0 0,4 -4,0 0,-4z M164,4l4,0 0,4 -4,0 0,-4z M168,4l4,0 0,4 -4,0 0,-4z M172,4l4,0 0,4 -4,0 0,-4z M176,4l4,0 0,4 -4,0 0,-4z M180,4l4,0 0,4 -4,0 0,-4z M4,8l4,0 0,4 -4,0 0,-4z M28,8l4,0 0,4 -4,0 0,-4z M44,8l4,0 0,4 -4,0 0,-4z M48,8l4,0 0,4 -4,0 0,-4z M56,8l4,0 0,4 -4,0 0,-4z M80,8l4,0 0,4 -4,0 0,-4z M92,8l4,0 0,4 -4,0 0,-4z M96,8l4,0 0,4 -4,0 0,-4z M100,8l4,0 0,4 -4,0 0,-4z M104,8l4,0 0,4 -4,0 0,-4z M112,8l4,0 0,4 -4,0 0,-4z M128,8l4,0 0,4 -4,0 0,-4z M132,8l4,0 0,4 -4,0 0,-4z M136,8l4,0 0,4 -4,0 0,-4z M144,8l4,0 0,4 -4,0 0,-4z M156,8l4,0 0,4 -4,0 0,-4z M180,8l4,0 0,4 -4,0 0,-4z M4,12l4,0 0,4 -4,0 0,-4z M12,12l4,0 0,4 -4,0 0,-4z M16,12l4,0 0,4 -4,0 0,-4z M20,12l4,0 0,4 -4,0 0,-4z M28,12l4,0 0,4 -4,0 0,-4z M48,12l4,0 0,4 -4,0 0,-4z M56,12l4,0 0,4 -4,0 0,-4z M68,12l4,0 0,4 -4,0 0,-4z M80,12l4,0 0,4 -4,0 0,-4z M92,12l4,0 0,4 -4,0 0,-4z M96,12l4,0 0,4 -4,0 0,-4z M100,12l4,0 0,4 -4,0 0,-4z M108,12l4,0 0,4 -4,0 0,-4z M112,12l4,0 0,4 -4,0 0,-4z M116,12l4,0 0,4 -4,0 0,-4z M120,12l4,0 0,4 -4,0 0,-4z M128,12l4,0 0,4 -4,0 0,-4z M132,12l4,0 0,4 -4,0 0,-4z M136,12l4,0 0,4 -4,0 0,-4z M144,12l4,0 0,4 -4,0 0,-4z M156,12l4,0 0,4 -4,0 0,-4z M164,12l4,0 0,4 -4,0 0,-4z M168,12l4,0 0,4 -4,0 0,-4z M172,12l4,0 0,4 -4,0 0,-4z M180,12l4,0 0,4 -4,0 0,-4z M4,16l4,0 0,4 -4,0 0,-4z M12,16l4,0 0,4 -4,0 0,-4z M16,16l4,0 0,4 -4,0 0,-4z M20,16l4,0 0,4 -4,0 0,-4z M28,16l4,0 0,4 -4,0 0,-4z M36,16l4,0 0,4 -4,0 0,-4z M44,16l4,0 0,4 -4,0 0,-4z M48,16l4,0 0,4 -4,0 0,-4z M56,16l4,0 0,4 -4,0 0,-4z M68,16l4,0 0,4 -4,0 0,-4z M80,16l4,0 0,4 -4,0 0,-4z M84,16l4,0 0,4 -4,0 0,-4z M88,16l4,0 0,4 -4,0 0,-4z M92,16l4,0 0,4 -4,0 0,-4z M96,16l4,0 0,4 -4,0 0,-4z M100,16l4,0 0,4 -4,0 0,-4z M104,16l4,0 0,4 -4,0 0,-4z M116,16l4,0 0,4 -4,0 0,-4z M124,16l4,0 0,4 -4,0 0,-4z M144,16l4,0 0,4 -4,0 0,-4z M148,16l4,0 0,4 -4,0 0,-4z M156,16l4,0 0,4 -4,0 0,-4z M164,16l4,0 0,4 -4,0 0,-4z M168,16l4,0 0,4 -4,0 0,-4z M172,16l4,0 0,4 -4,0 0,-4z M180,16l4,0 0,4 -4,0 0,-4z M4,20l4,0 0,4 -4,0 0,-4z M12,20l4,0 0,4 -4,0 0,-4z M16,20l4,0 0,4 -4,0 0,-4z M20,20l4,0 0,4 -4,0 0,-4z M28,20l4,0 0,4 -4,0 0,-4z M36,20l4,0 0,4 -4,0 0,-4z M44,20l4,0 0,4 -4,0 0,-4z M60,20l4,0 0,4 -4,0 0,-4z M64,20l4,0 0,4 -4,0 0,-4z M72,20l4,0 0,4 -4,0 0,-4z M84,20l4,0 0,4 -4,0 0,-4z M88,20l4,0 0,4 -4,0 0,-4z M92,20l4,0 0,4 -4,0 0,-4z M96,20l4,0 0,4 -4,0 0,-4z M100,20l4,0 0,4 -4,0 0,-4z M108,20l4,0 0,4 -4,0 0,-4z M112,20l4,0 0,4 -4,0 0,-4z M120,20l4,0 0,4 -4,0 0,-4z M124,20l4,0 0,4 -4,0 0,-4z M132,20l4,0 0,4 -4,0 0,-4z M136,20l4,0 0,4 -4,0 0,-4z M140,20l4,0 0,4 -4,0 0,-4z M144,20l4,0 0,4 -4,0 0,-4z M148,20l4,0 0,4 -4,0 0,-4z M156,20l4,0 0,4 -4,0 0,-4z M164,20l4,0 0,4 -4,0 0,-4z M168,20l4,0 0,4 -4,0 0,-4z M172,20l4,0 0,4 -4,0 0,-4z M180,20l4,0 0,4 -4,0 0,-4z M4,24l4,0 0,4 -4,0 0,-4z M28,24l4,0 0,4 -4,0 0,-4z M36,24l4,0 0,4 -4,0 0,-4z M44,24l4,0 0,4 -4,0 0,-4z M48,24l4,0 0,4 -4,0 0,-4z M60,24l4,0 0,4 -4,0 0,-4z M64,24l4,0 0,4 -4,0 0,-4z M68,24l4,0 0,4 -4,0 0,-4z M76,24l4,0 0,4 -4,0 0,-4z M80,24l4,0 0,4 -4,0 0,-4z M84,24l4,0 0,4 -4,0 0,-4z M100,24l4,0 0,4 -4,0 0,-4z M104,24l4,0 0,4 -4,0 0,-4z M112,24l4,0 0,4 -4,0 0,-4z M124,24l4,0 0,4 -4,0 0,-4z M156,24l4,0 0,4 -4,0 0,-4z M180,24l4,0 0,4 -4,0 0,-4z M4,28l4,0 0,4 -4,0 0,-4z M8,28l4,0 0,4 -4,0 0,-4z M12,28l4,0 0,4 -4,0 0,-4z M16,28l4,0 0,4 -4,0 0,-4z M20,28l4,0 0,4 -4,0 0,-4z M24,28l4,0 0,4 -4,0 0,-4z M28,28l4,0 0,4 -4,0 0,-4z M36,28l4,0 0,4 -4,0 0,-4z M44,28l4,0 0,4 -4,0 0,-4z M52,28l4,0 0,4 -4,0 0,-4z M60,28l4,0 0,4 -4,0 0,-4z M68,28l4,0 0,4 -4,0 0,-4z M76,28l4,0 0,4 -4,0 0,-4z M84,28l4,0 0,4 -4,0 0,-4z M92,28l4,0 0,4 -4,0 0,-4z M100,28l4,0 0,4 -4,0 0,-4z M108,28l4,0 0,4 -4,0 0,-4z M116,28l4,0 0,4 -4,0 0,-4z M124,28l4,0 0,4 -4,0 0,-4z M132,28l4,0 0,4 -4,0 0,-4z M140,28l4,0 0,4 -4,0 0,-4z M148,28l4,0 0,4 -4,0 0,-4z M156,28l4,0 0,4 -4,0 0,-4z M160,28l4,0 0,4 -4,0 0,-4z M164,28l4,0 0,4 -4,0 0,-4z M168,28l4,0 0,4 -4,0 0,-4z M172,28l4,0 0,4 -4,0 0,-4z M176,28l4,0 0,4 -4,0 0,-4z M180,28l4,0 0,4 -4,0 0,-4z M36,32l4,0 0,4 -4,0 0,-4z M40,32l4,0 0,4 -4,0 0,-4z M44,32l4,0 0,4 -4,0 0,-4z M48,32l4,0 0,4 -4,0 0,-4z M52,32l4,0 0,4 -4,0 0,-4z M64,32l4,0 0,4 -4,0 0,-4z M68,32l4,0 0,4 -4,0 0,-4z M80,32l4,0 0,4 -4,0 0,-4z M84,32l4,0 0,4 -4,0 0,-4z M100,32l4,0 0,4 -4,0 0,-4z M104,32l4,0 0,4 -4,0 0,-4z M112,32l4,0 0,4 -4,0 0,-4z M124,32l4,0 0,4 -4,0 0,-4z M132,32l4,0 0,4 -4,0 0,-4z M144,32l4,0 0,4 -4,0 0,-4z M148,32l4,0 0,4 -4,0 0,-4z M4,36l4,0 0,4 -4,0 0,-4z M20,36l4,0 0,4 -4,0 0,-4z M28,36l4,0 0,4 -4,0 0,-4z M32,36l4,0 0,4 -4,0 0,-4z M36,36l4,0 0,4 -4,0 0,-4z M48,36l4,0 0,4 -4,0 0,-4z M56,36l4,0 0,4 -4,0 0,-4z M76,36l4,0 0,4 -4,0 0,-4z M84,36l4,0 0,4 -4,0 0,-4z M88,36l4,0 0,4 -4,0 0,-4z M92,36l4,0 0,4 -4,0 0,-4z M96,36l4,0 0,4 -4,0 0,-4z M100,36l4,0 0,4 -4,0 0,-4z M104,36l4,0 0,4 -4,0 0,-4z M108,36l4,0 0,4 -4,0 0,-4z M112,36l4,0 0,4 -4,0 0,-4z M120,36l4,0 0,4 -4,0 0,-4z M132,36l4,0 0,4 -4,0 0,-4z M136,36l4,0 0,4 -4,0 0,-4z M140,36l4,0 0,4 -4,0 0,-4z M144,36l4,0 0,4 -4,0 0,-4z M152,36l4,0 0,4 -4,0 0,-4z M156,36l4,0 0,4 -4,0 0,-4z M160,36l4,0 0,4 -4,0 0,-4z M164,36l4,0 0,4 -4,0 0,-4z M168,36l4,0 0,4 -4,0 0,-4z M180,36l4,0 0,4 -4,0 0,-4z M8,40l4,0 0,4 -4,0 0,-4z M20,40l4,0 0,4 -4,0 0,-4z M32,40l4,0 0,4 -4,0 0,-4z M40,40l4,0 0,4 -4,0 0,-4z M52,40l4,0 0,4 -4,0 0,-4z M64,40l4,0 0,4 -4,0 0,-4z M68,40l4,0 0,4 -4,0 0,-4z M72,40l4,0 0,4 -4,0 0,-4z M76,40l4,0 0,4 -4,0 0,-4z M88,40l4,0 0,4 -4,0 0,-4z M92,40l4,0 0,4 -4,0 0,-4z M96,40l4,0 0,4 -4,0 0,-4z M108,40l4,0 0,4 -4,0 0,-4z M112,40l4,0 0,4 -4,0 0,-4z M120,40l4,0 0,4 -4,0 0,-4z M124,40l4,0 0,4 -4,0 0,-4z M132,40l4,0 0,4 -4,0 0,-4z M144,40l4,0 0,4 -4,0 0,-4z M148,40l4,0 0,4 -4,0 0,-4z M156,40l4,0 0,4 -4,0 0,-4z M160,40l4,0 0,4 -4,0 0,-4z M172,40l4,0 0,4 -4,0 0,-4z M4,44l4,0 0,4 -4,0 0,-4z M28,44l4,0 0,4 -4,0 0,-4z M52,44l4,0 0,4 -4,0 0,-4z M56,44l4,0 0,4 -4,0 0,-4z M72,44l4,0 0,4 -4,0 0,-4z M88,44l4,0 0,4 -4,0 0,-4z M92,44l4,0 0,4 -4,0 0,-4z M96,44l4,0 0,4 -4,0 0,-4z M108,44l4,0 0,4 -4,0 0,-4z M124,44l4,0 0,4 -4,0 0,-4z M128,44l4,0 0,4 -4,0 0,-4z M132,44l4,0 0,4 -4,0 0,-4z M136,44l4,0 0,4 -4,0 0,-4z M148,44l4,0 0,4 -4,0 0,-4z M152,44l4,0 0,4 -4,0 0,-4z M156,44l4,0 0,4 -4,0 0,-4z M164,44l4,0 0,4 -4,0 0,-4z M168,44l4,0 0,4 -4,0 0,-4z M172,44l4,0 0,4 -4,0 0,-4z M176,44l4,0 0,4 -4,0 0,-4z M8,48l4,0 0,4 -4,0 0,-4z M12,48l4,0 0,4 -4,0 0,-4z M16,48l4,0 0,4 -4,0 0,-4z M44,48l4,0 0,4 -4,0 0,-4z M52,48l4,0 0,4 -4,0 0,-4z M56,48l4,0 0,4 -4,0 0,-4z M60,48l4,0 0,4 -4,0 0,-4z M76,48l4,0 0,4 -4,0 0,-4z M80,48l4,0 0,4 -4,0 0,-4z M84,48l4,0 0,4 -4,0 0,-4z M92,48l4,0 0,4 -4,0 0,-4z M100,48l4,0 0,4 -4,0 0,-4z M112,48l4,0 0,4 -4,0 0,-4z M128,48l4,0 0,4 -4,0 0,-4z M132,48l4,0 0,4 -4,0 0,-4z M136,48l4,0 0,4 -4,0 0,-4z M140,48l4,0 0,4 -4,0 0,-4z M144,48l4,0 0,4 -4,0 0,-4z M156,48l4,0 0,4 -4,0 0,-4z M176,48l4,0 0,4 -4,0 0,-4z M180,48l4,0 0,4 -4,0 0,-4z M4,52l4,0 0,4 -4,0 0,-4z M20,52l4,0 0,4 -4,0 0,-4z M24,52l4,0 0,4 -4,0 0,-4z M28,52l4,0 0,4 -4,0 0,-4z M32,52l4,0 0,4 -4,0 0,-4z M48,52l4,0 0,4 -4,0 0,-4z M52,52l4,0 0,4 -4,0 0,-4z M56,52l4,0 0,4 -4,0 0,-4z M60,52l4,0 0,4 -4,0 0,-4z M72,52l4,0 0,4 -4,0 0,-4z M76,52l4,0 0,4 -4,0 0,-4z M80,52l4,0 0,4 -4,0 0,-4z M92,52l4,0 0,4 -4,0 0,-4z M100,52l4,0 0,4 -4,0 0,-4z M108,52l4,0 0,4 -4,0 0,-4z M112,52l4,0 0,4 -4,0 0,-4z M128,52l4,0 0,4 -4,0 0,-4z M132,52l4,0 0,4 -4,0 0,-4z M140,52l4,0 0,4 -4,0 0,-4z M144,52l4,0 0,4 -4,0 0,-4z M148,52l4,0 0,4 -4,0 0,-4z M156,52l4,0 0,4 -4,0 0,-4z M4,56l4,0 0,4 -4,0 0,-4z M8,56l4,0 0,4 -4,0 0,-4z M12,56l4,0 0,4 -4,0 0,-4z M16,56l4,0 0,4 -4,0 0,-4z M20,56l4,0 0,4 -4,0 0,-4z M24,56l4,0 0,4 -4,0 0,-4z M36,56l4,0 0,4 -4,0 0,-4z M40,56l4,0 0,4 -4,0 0,-4z M48,56l4,0 0,4 -4,0 0,-4z M52,56l4,0 0,4 -4,0 0,-4z M56,56l4,0 0,4 -4,0 0,-4z M60,56l4,0 0,4 -4,0 0,-4z M68,56l4,0 0,4 -4,0 0,-4z M108,56l4,0 0,4 -4,0 0,-4z M116,56l4,0 0,4 -4,0 0,-4z M124,56l4,0 0,4 -4,0 0,-4z M128,56l4,0 0,4 -4,0 0,-4z M132,56l4,0 0,4 -4,0 0,-4z M144,56l4,0 0,4 -4,0 0,-4z M148,56l4,0 0,4 -4,0 0,-4z M156,56l4,0 0,4 -4,0 0,-4z M160,56l4,0 0,4 -4,0 0,-4z M172,56l4,0 0,4 -4,0 0,-4z M12,60l4,0 0,4 -4,0 0,-4z M20,60l4,0 0,4 -4,0 0,-4z M28,60l4,0 0,4 -4,0 0,-4z M36,60l4,0 0,4 -4,0 0,-4z M44,60l4,0 0,4 -4,0 0,-4z M68,60l4,0 0,4 -4,0 0,-4z M84,60l4,0 0,4 -4,0 0,-4z M88,60l4,0 0,4 -4,0 0,-4z M92,60l4,0 0,4 -4,0 0,-4z M112,60l4,0 0,4 -4,0 0,-4z M116,60l4,0 0,4 -4,0 0,-4z M120,60l4,0 0,4 -4,0 0,-4z M124,60l4,0 0,4 -4,0 0,-4z M128,60l4,0 0,4 -4,0 0,-4z M160,60l4,0 0,4 -4,0 0,-4z M164,60l4,0 0,4 -4,0 0,-4z M168,60l4,0 0,4 -4,0 0,-4z M172,60l4,0 0,4 -4,0 0,-4z M8,64l4,0 0,4 -4,0 0,-4z M12,64l4,0 0,4 -4,0 0,-4z M20,64l4,0 0,4 -4,0 0,-4z M24,64l4,0 0,4 -4,0 0,-4z M40,64l4,0 0,4 -4,0 0,-4z M52,64l4,0 0,4 -4,0 0,-4z M76,64l4,0 0,4 -4,0 0,-4z M80,64l4,0 0,4 -4,0 0,-4z M88,64l4,0 0,4 -4,0 0,-4z M92,64l4,0 0,4 -4,0 0,-4z M104,64l4,0 0,4 -4,0 0,-4z M108,64l4,0 0,4 -4,0 0,-4z M112,64l4,0 0,4 -4,0 0,-4z M124,64l4,0 0,4 -4,0 0,-4z M128,64l4,0 0,4 -4,0 0,-4z M132,64l4,0 0,4 -4,0 0,-4z M136,64l4,0 0,4 -4,0 0,-4z M140,64l4,0 0,4 -4,0 0,-4z M152,64l4,0 0,4 -4,0 0,-4z M164,64l4,0 0,4 -4,0 0,-4z M176,64l4,0 0,4 -4,0 0,-4z M12,68l4,0 0,4 -4,0 0,-4z M24,68l4,0 0,4 -4,0 0,-4z M28,68l4,0 0,4 -4,0 0,-4z M36,68l4,0 0,4 -4,0 0,-4z M44,68l4,0 0,4 -4,0 0,-4z M48,68l4,0 0,4 -4,0 0,-4z M52,68l4,0 0,4 -4,0 0,-4z M68,68l4,0 0,4 -4,0 0,-4z M72,68l4,0 0,4 -4,0 0,-4z M76,68l4,0 0,4 -4,0 0,-4z M80,68l4,0 0,4 -4,0 0,-4z M100,68l4,0 0,4 -4,0 0,-4z M108,68l4,0 0,4 -4,0 0,-4z M112,68l4,0 0,4 -4,0 0,-4z M120,68l4,0 0,4 -4,0 0,-4z M132,68l4,0 0,4 -4,0 0,-4z M136,68l4,0 0,4 -4,0 0,-4z M140,68l4,0 0,4 -4,0 0,-4z M160,68l4,0 0,4 -4,0 0,-4z M172,68l4,0 0,4 -4,0 0,-4z M4,72l4,0 0,4 -4,0 0,-4z M12,72l4,0 0,4 -4,0 0,-4z M16,72l4,0 0,4 -4,0 0,-4z M20,72l4,0 0,4 -4,0 0,-4z M24,72l4,0 0,4 -4,0 0,-4z M32,72l4,0 0,4 -4,0 0,-4z M44,72l4,0 0,4 -4,0 0,-4z M48,72l4,0 0,4 -4,0 0,-4z M56,72l4,0 0,4 -4,0 0,-4z M60,72l4,0 0,4 -4,0 0,-4z M68,72l4,0 0,4 -4,0 0,-4z M76,72l4,0 0,4 -4,0 0,-4z M80,72l4,0 0,4 -4,0 0,-4z M84,72l4,0 0,4 -4,0 0,-4z M100,72l4,0 0,4 -4,0 0,-4z M108,72l4,0 0,4 -4,0 0,-4z M120,72l4,0 0,4 -4,0 0,-4z M124,72l4,0 0,4 -4,0 0,-4z M128,72l4,0 0,4 -4,0 0,-4z M132,72l4,0 0,4 -4,0 0,-4z M136,72l4,0 0,4 -4,0 0,-4z M148,72l4,0 0,4 -4,0 0,-4z M152,72l4,0 0,4 -4,0 0,-4z M156,72l4,0 0,4 -4,0 0,-4z M160,72l4,0 0,4 -4,0 0,-4z M164,72l4,0 0,4 -4,0 0,-4z M168,72l4,0 0,4 -4,0 0,-4z M176,72l4,0 0,4 -4,0 0,-4z M180,72l4,0 0,4 -4,0 0,-4z M4,76l4,0 0,4 -4,0 0,-4z M8,76l4,0 0,4 -4,0 0,-4z M12,76l4,0 0,4 -4,0 0,-4z M28,76l4,0 0,4 -4,0 0,-4z M32,76l4,0 0,4 -4,0 0,-4z M40,76l4,0 0,4 -4,0 0,-4z M52,76l4,0 0,4 -4,0 0,-4z M56,76l4,0 0,4 -4,0 0,-4z M68,76l4,0 0,4 -4,0 0,-4z M80,76l4,0 0,4 -4,0 0,-4z M92,76l4,0 0,4 -4,0 0,-4z M108,76l4,0 0,4 -4,0 0,-4z M116,76l4,0 0,4 -4,0 0,-4z M120,76l4,0 0,4 -4,0 0,-4z M124,76l4,0 0,4 -4,0 0,-4z M128,76l4,0 0,4 -4,0 0,-4z M144,76l4,0 0,4 -4,0 0,-4z M148,76l4,0 0,4 -4,0 0,-4z M156,76l4,0 0,4 -4,0 0,-4z M164,76l4,0 0,4 -4,0 0,-4z M176,76l4,0 0,4 -4,0 0,-4z M4,80l4,0 0,4 -4,0 0,-4z M8,80l4,0 0,4 -4,0 0,-4z M20,80l4,0 0,4 -4,0 0,-4z M24,80l4,0 0,4 -4,0 0,-4z M32,80l4,0 0,4 -4,0 0,-4z M40,80l4,0 0,4 -4,0 0,-4z M52,80l4,0 0,4 -4,0 0,-4z M68,80l4,0 0,4 -4,0 0,-4z M72,80l4,0 0,4 -4,0 0,-4z M80,80l4,0 0,4 -4,0 0,-4z M92,80l4,0 0,4 -4,0 0,-4z M104,80l4,0 0,4 -4,0 0,-4z M108,80l4,0 0,4 -4,0 0,-4z M112,80l4,0 0,4 -4,0 0,-4z M116,80l4,0 0,4 -4,0 0,-4z M120,80l4,0 0,4 -4,0 0,-4z M128,80l4,0 0,4 -4,0 0,-4z M132,80l4,0 0,4 -4,0 0,-4z M140,80l4,0 0,4 -4,0 0,-4z M144,80l4,0 0,4 -4,0 0,-4z M148,80l4,0 0,4 -4,0 0,-4z M160,80l4,0 0,4 -4,0 0,-4z M164,80l4,0 0,4 -4,0 0,-4z M4,84l4,0 0,4 -4,0 0,-4z M8,84l4,0 0,4 -4,0 0,-4z M16,84l4,0 0,4 -4,0 0,-4z M20,84l4,0 0,4 -4,0 0,-4z M24,84l4,0 0,4 -4,0 0,-4z M28,84l4,0 0,4 -4,0 0,-4z M32,84l4,0 0,4 -4,0 0,-4z M36,84l4,0 0,4 -4,0 0,-4z M44,84l4,0 0,4 -4,0 0,-4z M52,84l4,0 0,4 -4,0 0,-4z M64,84l4,0 0,4 -4,0 0,-4z M68,84l4,0 0,4 -4,0 0,-4z M72,84l4,0 0,4 -4,0 0,-4z M76,84l4,0 0,4 -4,0 0,-4z M80,84l4,0 0,4 -4,0 0,-4z M84,84l4,0 0,4 -4,0 0,-4z M88,84l4,0 0,4 -4,0 0,-4z M92,84l4,0 0,4 -4,0 0,-4z M96,84l4,0 0,4 -4,0 0,-4z M100,84l4,0 0,4 -4,0 0,-4z M112,84l4,0 0,4 -4,0 0,-4z M120,84l4,0 0,4 -4,0 0,-4z M128,84l4,0 0,4 -4,0 0,-4z M132,84l4,0 0,4 -4,0 0,-4z M136,84l4,0 0,4 -4,0 0,-4z M140,84l4,0 0,4 -4,0 0,-4z M148,84l4,0 0,4 -4,0 0,-4z M152,84l4,0 0,4 -4,0 0,-4z M156,84l4,0 0,4 -4,0 0,-4z M160,84l4,0 0,4 -4,0 0,-4z M164,84l4,0 0,4 -4,0 0,-4z M168,84l4,0 0,4 -4,0 0,-4z M172,84l4,0 0,4 -4,0 0,-4z M180,84l4,0 0,4 -4,0 0,-4z M4,88l4,0 0,4 -4,0 0,-4z M8,88l4,0 0,4 -4,0 0,-4z M16,88l4,0 0,4 -4,0 0,-4z M20,88l4,0 0,4 -4,0 0,-4z M36,88l4,0 0,4 -4,0 0,-4z M48,88l4,0 0,4 -4,0 0,-4z M52,88l4,0 0,4 -4,0 0,-4z M68,88l4,0 0,4 -4,0 0,-4z M80,88l4,0 0,4 -4,0 0,-4z M84,88l4,0 0,4 -4,0 0,-4z M100,88l4,0 0,4 -4,0 0,-4z M108,88l4,0 0,4 -4,0 0,-4z M120,88l4,0 0,4 -4,0 0,-4z M124,88l4,0 0,4 -4,0 0,-4z M136,88l4,0 0,4 -4,0 0,-4z M144,88l4,0 0,4 -4,0 0,-4z M148,88l4,0 0,4 -4,0 0,-4z M164,88l4,0 0,4 -4,0 0,-4z M168,88l4,0 0,4 -4,0 0,-4z M172,88l4,0 0,4 -4,0 0,-4z M4,92l4,0 0,4 -4,0 0,-4z M20,92l4,0 0,4 -4,0 0,-4z M28,92l4,0 0,4 -4,0 0,-4z M36,92l4,0 0,4 -4,0 0,-4z M40,92l4,0 0,4 -4,0 0,-4z M44,92l4,0 0,4 -4,0 0,-4z M48,92l4,0 0,4 -4,0 0,-4z M56,92l4,0 0,4 -4,0 0,-4z M60,92l4,0 0,4 -4,0 0,-4z M64,92l4,0 0,4 -4,0 0,-4z M68,92l4,0 0,4 -4,0 0,-4z M76,92l4,0 0,4 -4,0 0,-4z M80,92l4,0 0,4 -4,0 0,-4z M84,92l4,0 0,4 -4,0 0,-4z M92,92l4,0 0,4 -4,0 0,-4z M100,92l4,0 0,4 -4,0 0,-4z M108,92l4,0 0,4 -4,0 0,-4z M116,92l4,0 0,4 -4,0 0,-4z M136,92l4,0 0,4 -4,0 0,-4z M148,92l4,0 0,4 -4,0 0,-4z M156,92l4,0 0,4 -4,0 0,-4z M164,92l4,0 0,4 -4,0 0,-4z M168,92l4,0 0,4 -4,0 0,-4z M176,92l4,0 0,4 -4,0 0,-4z M4,96l4,0 0,4 -4,0 0,-4z M8,96l4,0 0,4 -4,0 0,-4z M16,96l4,0 0,4 -4,0 0,-4z M20,96l4,0 0,4 -4,0 0,-4z M36,96l4,0 0,4 -4,0 0,-4z M40,96l4,0 0,4 -4,0 0,-4z M48,96l4,0 0,4 -4,0 0,-4z M52,96l4,0 0,4 -4,0 0,-4z M64,96l4,0 0,4 -4,0 0,-4z M72,96l4,0 0,4 -4,0 0,-4z M76,96l4,0 0,4 -4,0 0,-4z M84,96l4,0 0,4 -4,0 0,-4z M100,96l4,0 0,4 -4,0 0,-4z M104,96l4,0 0,4 -4,0 0,-4z M112,96l4,0 0,4 -4,0 0,-4z M128,96l4,0 0,4 -4,0 0,-4z M132,96l4,0 0,4 -4,0 0,-4z M144,96l4,0 0,4 -4,0 0,-4z M148,96l4,0 0,4 -4,0 0,-4z M164,96l4,0 0,4 -4,0 0,-4z M176,96l4,0 0,4 -4,0 0,-4z M180,96l4,0 0,4 -4,0 0,-4z M4,100l4,0 0,4 -4,0 0,-4z M8,100l4,0 0,4 -4,0 0,-4z M12,100l4,0 0,4 -4,0 0,-4z M20,100l4,0 0,4 -4,0 0,-4z M24,100l4,0 0,4 -4,0 0,-4z M28,100l4,0 0,4 -4,0 0,-4z M32,100l4,0 0,4 -4,0 0,-4z M36,100l4,0 0,4 -4,0 0,-4z M44,100l4,0 0,4 -4,0 0,-4z M48,100l4,0 0,4 -4,0 0,-4z M60,100l4,0 0,4 -4,0 0,-4z M68,100l4,0 0,4 -4,0 0,-4z M72,100l4,0 0,4 -4,0 0,-4z M84,100l4,0 0,4 -4,0 0,-4z M88,100l4,0 0,4 -4,0 0,-4z M92,100l4,0 0,4 -4,0 0,-4z M96,100l4,0 0,4 -4,0 0,-4z M100,100l4,0 0,4 -4,0 0,-4z M108,100l4,0 0,4 -4,0 0,-4z M124,100l4,0 0,4 -4,0 0,-4z M128,100l4,0 0,4 -4,0 0,-4z M132,100l4,0 0,4 -4,0 0,-4z M136,100l4,0 0,4 -4,0 0,-4z M140,100l4,0 0,4 -4,0 0,-4z M148,100l4,0 0,4 -4,0 0,-4z M152,100l4,0 0,4 -4,0 0,-4z M156,100l4,0 0,4 -4,0 0,-4z M160,100l4,0 0,4 -4,0 0,-4z M164,100l4,0 0,4 -4,0 0,-4z M168,100l4,0 0,4 -4,0 0,-4z M176,100l4,0 0,4 -4,0 0,-4z M180,100l4,0 0,4 -4,0 0,-4z M4,104l4,0 0,4 -4,0 0,-4z M8,104l4,0 0,4 -4,0 0,-4z M36,104l4,0 0,4 -4,0 0,-4z M60,104l4,0 0,4 -4,0 0,-4z M64,104l4,0 0,4 -4,0 0,-4z M76,104l4,0 0,4 -4,0 0,-4z M84,104l4,0 0,4 -4,0 0,-4z M92,104l4,0 0,4 -4,0 0,-4z M100,104l4,0 0,4 -4,0 0,-4z M108,104l4,0 0,4 -4,0 0,-4z M120,104l4,0 0,4 -4,0 0,-4z M124,104l4,0 0,4 -4,0 0,-4z M128,104l4,0 0,4 -4,0 0,-4z M136,104l4,0 0,4 -4,0 0,-4z M156,104l4,0 0,4 -4,0 0,-4z M160,104l4,0 0,4 -4,0 0,-4z M168,104l4,0 0,4 -4,0 0,-4z M172,104l4,0 0,4 -4,0 0,-4z M176,104l4,0 0,4 -4,0 0,-4z M4,108l4,0 0,4 -4,0 0,-4z M12,108l4,0 0,4 -4,0 0,-4z M16,108l4,0 0,4 -4,0 0,-4z M20,108l4,0 0,4 -4,0 0,-4z M24,108l4,0 0,4 -4,0 0,-4z M28,108l4,0 0,4 -4,0 0,-4z M40,108l4,0 0,4 -4,0 0,-4z M56,108l4,0 0,4 -4,0 0,-4z M60,108l4,0 0,4 -4,0 0,-4z M64,108l4,0 0,4 -4,0 0,-4z M72,108l4,0 0,4 -4,0 0,-4z M76,108l4,0 0,4 -4,0 0,-4z M84,108l4,0 0,4 -4,0 0,-4z M92,108l4,0 0,4 -4,0 0,-4z M100,108l4,0 0,4 -4,0 0,-4z M108,108l4,0 0,4 -4,0 0,-4z M112,108l4,0 0,4 -4,0 0,-4z M116,108l4,0 0,4 -4,0 0,-4z M124,108l4,0 0,4 -4,0 0,-4z M144,108l4,0 0,4 -4,0 0,-4z M148,108l4,0 0,4 -4,0 0,-4z M164,108l4,0 0,4 -4,0 0,-4z M176,108l4,0 0,4 -4,0 0,-4z M8,112l4,0 0,4 -4,0 0,-4z M16,112l4,0 0,4 -4,0 0,-4z M20,112l4,0 0,4 -4,0 0,-4z M32,112l4,0 0,4 -4,0 0,-4z M40,112l4,0 0,4 -4,0 0,-4z M44,112l4,0 0,4 -4,0 0,-4z M60,112l4,0 0,4 -4,0 0,-4z M68,112l4,0 0,4 -4,0 0,-4z M72,112l4,0 0,4 -4,0 0,-4z M76,112l4,0 0,4 -4,0 0,-4z M88,112l4,0 0,4 -4,0 0,-4z M96,112l4,0 0,4 -4,0 0,-4z M104,112l4,0 0,4 -4,0 0,-4z M128,112l4,0 0,4 -4,0 0,-4z M132,112l4,0 0,4 -4,0 0,-4z M140,112l4,0 0,4 -4,0 0,-4z M148,112l4,0 0,4 -4,0 0,-4z M156,112l4,0 0,4 -4,0 0,-4z M176,112l4,0 0,4 -4,0 0,-4z M16,116l4,0 0,4 -4,0 0,-4z M24,116l4,0 0,4 -4,0 0,-4z M28,116l4,0 0,4 -4,0 0,-4z M36,116l4,0 0,4 -4,0 0,-4z M44,116l4,0 0,4 -4,0 0,-4z M48,116l4,0 0,4 -4,0 0,-4z M56,116l4,0 0,4 -4,0 0,-4z M60,116l4,0 0,4 -4,0 0,-4z M76,116l4,0 0,4 -4,0 0,-4z M80,116l4,0 0,4 -4,0 0,-4z M88,116l4,0 0,4 -4,0 0,-4z M96,116l4,0 0,4 -4,0 0,-4z M104,116l4,0 0,4 -4,0 0,-4z M112,116l4,0 0,4 -4,0 0,-4z M128,116l4,0 0,4 -4,0 0,-4z M132,116l4,0 0,4 -4,0 0,-4z M140,116l4,0 0,4 -4,0 0,-4z M156,116l4,0 0,4 -4,0 0,-4z M160,116l4,0 0,4 -4,0 0,-4z M164,116l4,0 0,4 -4,0 0,-4z M168,116l4,0 0,4 -4,0 0,-4z M180,116l4,0 0,4 -4,0 0,-4z M4,120l4,0 0,4 -4,0 0,-4z M8,120l4,0 0,4 -4,0 0,-4z M20,120l4,0 0,4 -4,0 0,-4z M24,120l4,0 0,4 -4,0 0,-4z M32,120l4,0 0,4 -4,0 0,-4z M44,120l4,0 0,4 -4,0 0,-4z M48,120l4,0 0,4 -4,0 0,-4z M52,120l4,0 0,4 -4,0 0,-4z M56,120l4,0 0,4 -4,0 0,-4z M60,120l4,0 0,4 -4,0 0,-4z M80,120l4,0 0,4 -4,0 0,-4z M84,120l4,0 0,4 -4,0 0,-4z M88,120l4,0 0,4 -4,0 0,-4z M96,120l4,0 0,4 -4,0 0,-4z M108,120l4,0 0,4 -4,0 0,-4z M112,120l4,0 0,4 -4,0 0,-4z M120,120l4,0 0,4 -4,0 0,-4z M124,120l4,0 0,4 -4,0 0,-4z M132,120l4,0 0,4 -4,0 0,-4z M148,120l4,0 0,4 -4,0 0,-4z M152,120l4,0 0,4 -4,0 0,-4z M156,120l4,0 0,4 -4,0 0,-4z M160,120l4,0 0,4 -4,0 0,-4z M168,120l4,0 0,4 -4,0 0,-4z M172,120l4,0 0,4 -4,0 0,-4z M176,120l4,0 0,4 -4,0 0,-4z M4,124l4,0 0,4 -4,0 0,-4z M20,124l4,0 0,4 -4,0 0,-4z M24,124l4,0 0,4 -4,0 0,-4z M28,124l4,0 0,4 -4,0 0,-4z M36,124l4,0 0,4 -4,0 0,-4z M40,124l4,0 0,4 -4,0 0,-4z M64,124l4,0 0,4 -4,0 0,-4z M84,124l4,0 0,4 -4,0 0,-4z M92,124l4,0 0,4 -4,0 0,-4z M100,124l4,0 0,4 -4,0 0,-4z M104,124l4,0 0,4 -4,0 0,-4z M116,124l4,0 0,4 -4,0 0,-4z M124,124l4,0 0,4 -4,0 0,-4z M128,124l4,0 0,4 -4,0 0,-4z M152,124l4,0 0,4 -4,0 0,-4z M164,124l4,0 0,4 -4,0 0,-4z M168,124l4,0 0,4 -4,0 0,-4z M172,124l4,0 0,4 -4,0 0,-4z M176,124l4,0 0,4 -4,0 0,-4z M4,128l4,0 0,4 -4,0 0,-4z M8,128l4,0 0,4 -4,0 0,-4z M12,128l4,0 0,4 -4,0 0,-4z M24,128l4,0 0,4 -4,0 0,-4z M36,128l4,0 0,4 -4,0 0,-4z M44,128l4,0 0,4 -4,0 0,-4z M56,128l4,0 0,4 -4,0 0,-4z M60,128l4,0 0,4 -4,0 0,-4z M64,128l4,0 0,4 -4,0 0,-4z M72,128l4,0 0,4 -4,0 0,-4z M96,128l4,0 0,4 -4,0 0,-4z M104,128l4,0 0,4 -4,0 0,-4z M108,128l4,0 0,4 -4,0 0,-4z M112,128l4,0 0,4 -4,0 0,-4z M124,128l4,0 0,4 -4,0 0,-4z M128,128l4,0 0,4 -4,0 0,-4z M132,128l4,0 0,4 -4,0 0,-4z M140,128l4,0 0,4 -4,0 0,-4z M144,128l4,0 0,4 -4,0 0,-4z M148,128l4,0 0,4 -4,0 0,-4z M156,128l4,0 0,4 -4,0 0,-4z M160,128l4,0 0,4 -4,0 0,-4z M164,128l4,0 0,4 -4,0 0,-4z M4,132l4,0 0,4 -4,0 0,-4z M28,132l4,0 0,4 -4,0 0,-4z M32,132l4,0 0,4 -4,0 0,-4z M36,132l4,0 0,4 -4,0 0,-4z M48,132l4,0 0,4 -4,0 0,-4z M52,132l4,0 0,4 -4,0 0,-4z M56,132l4,0 0,4 -4,0 0,-4z M72,132l4,0 0,4 -4,0 0,-4z M76,132l4,0 0,4 -4,0 0,-4z M80,132l4,0 0,4 -4,0 0,-4z M88,132l4,0 0,4 -4,0 0,-4z M96,132l4,0 0,4 -4,0 0,-4z M100,132l4,0 0,4 -4,0 0,-4z M112,132l4,0 0,4 -4,0 0,-4z M120,132l4,0 0,4 -4,0 0,-4z M132,132l4,0 0,4 -4,0 0,-4z M136,132l4,0 0,4 -4,0 0,-4z M148,132l4,0 0,4 -4,0 0,-4z M152,132l4,0 0,4 -4,0 0,-4z M156,132l4,0 0,4 -4,0 0,-4z M172,132l4,0 0,4 -4,0 0,-4z M176,132l4,0 0,4 -4,0 0,-4z M8,136l4,0 0,4 -4,0 0,-4z M16,136l4,0 0,4 -4,0 0,-4z M20,136l4,0 0,4 -4,0 0,-4z M36,136l4,0 0,4 -4,0 0,-4z M48,136l4,0 0,4 -4,0 0,-4z M60,136l4,0 0,4 -4,0 0,-4z M92,136l4,0 0,4 -4,0 0,-4z M96,136l4,0 0,4 -4,0 0,-4z M104,136l4,0 0,4 -4,0 0,-4z M108,136l4,0 0,4 -4,0 0,-4z M112,136l4,0 0,4 -4,0 0,-4z M120,136l4,0 0,4 -4,0 0,-4z M124,136l4,0 0,4 -4,0 0,-4z M136,136l4,0 0,4 -4,0 0,-4z M144,136l4,0 0,4 -4,0 0,-4z M148,136l4,0 0,4 -4,0 0,-4z M160,136l4,0 0,4 -4,0 0,-4z M172,136l4,0 0,4 -4,0 0,-4z M180,136l4,0 0,4 -4,0 0,-4z M20,140l4,0 0,4 -4,0 0,-4z M28,140l4,0 0,4 -4,0 0,-4z M32,140l4,0 0,4 -4,0 0,-4z M36,140l4,0 0,4 -4,0 0,-4z M44,140l4,0 0,4 -4,0 0,-4z M48,140l4,0 0,4 -4,0 0,-4z M56,140l4,0 0,4 -4,0 0,-4z M64,140l4,0 0,4 -4,0 0,-4z M68,140l4,0 0,4 -4,0 0,-4z M72,140l4,0 0,4 -4,0 0,-4z M84,140l4,0 0,4 -4,0 0,-4z M96,140l4,0 0,4 -4,0 0,-4z M100,140l4,0 0,4 -4,0 0,-4z M108,140l4,0 0,4 -4,0 0,-4z M124,140l4,0 0,4 -4,0 0,-4z M128,140l4,0 0,4 -4,0 0,-4z M132,140l4,0 0,4 -4,0 0,-4z M136,140l4,0 0,4 -4,0 0,-4z M148,140l4,0 0,4 -4,0 0,-4z M152,140l4,0 0,4 -4,0 0,-4z M160,140l4,0 0,4 -4,0 0,-4z M164,140l4,0 0,4 -4,0 0,-4z M172,140l4,0 0,4 -4,0 0,-4z M176,140l4,0 0,4 -4,0 0,-4z M8,144l4,0 0,4 -4,0 0,-4z M12,144l4,0 0,4 -4,0 0,-4z M16,144l4,0 0,4 -4,0 0,-4z M20,144l4,0 0,4 -4,0 0,-4z M36,144l4,0 0,4 -4,0 0,-4z M44,144l4,0 0,4 -4,0 0,-4z M48,144l4,0 0,4 -4,0 0,-4z M52,144l4,0 0,4 -4,0 0,-4z M64,144l4,0 0,4 -4,0 0,-4z M72,144l4,0 0,4 -4,0 0,-4z M76,144l4,0 0,4 -4,0 0,-4z M80,144l4,0 0,4 -4,0 0,-4z M84,144l4,0 0,4 -4,0 0,-4z M88,144l4,0 0,4 -4,0 0,-4z M104,144l4,0 0,4 -4,0 0,-4z M116,144l4,0 0,4 -4,0 0,-4z M120,144l4,0 0,4 -4,0 0,-4z M124,144l4,0 0,4 -4,0 0,-4z M128,144l4,0 0,4 -4,0 0,-4z M132,144l4,0 0,4 -4,0 0,-4z M136,144l4,0 0,4 -4,0 0,-4z M160,144l4,0 0,4 -4,0 0,-4z M176,144l4,0 0,4 -4,0 0,-4z M4,148l4,0 0,4 -4,0 0,-4z M16,148l4,0 0,4 -4,0 0,-4z M20,148l4,0 0,4 -4,0 0,-4z M28,148l4,0 0,4 -4,0 0,-4z M36,148l4,0 0,4 -4,0 0,-4z M56,148l4,0 0,4 -4,0 0,-4z M60,148l4,0 0,4 -4,0 0,-4z M64,148l4,0 0,4 -4,0 0,-4z M68,148l4,0 0,4 -4,0 0,-4z M76,148l4,0 0,4 -4,0 0,-4z M84,148l4,0 0,4 -4,0 0,-4z M88,148l4,0 0,4 -4,0 0,-4z M92,148l4,0 0,4 -4,0 0,-4z M96,148l4,0 0,4 -4,0 0,-4z M100,148l4,0 0,4 -4,0 0,-4z M104,148l4,0 0,4 -4,0 0,-4z M108,148l4,0 0,4 -4,0 0,-4z M112,148l4,0 0,4 -4,0 0,-4z M124,148l4,0 0,4 -4,0 0,-4z M132,148l4,0 0,4 -4,0 0,-4z M136,148l4,0 0,4 -4,0 0,-4z M148,148l4,0 0,4 -4,0 0,-4z M152,148l4,0 0,4 -4,0 0,-4z M156,148l4,0 0,4 -4,0 0,-4z M160,148l4,0 0,4 -4,0 0,-4z M164,148l4,0 0,4 -4,0 0,-4z M172,148l4,0 0,4 -4,0 0,-4z M36,152l4,0 0,4 -4,0 0,-4z M40,152l4,0 0,4 -4,0 0,-4z M52,152l4,0 0,4 -4,0 0,-4z M76,152l4,0 0,4 -4,0 0,-4z M84,152l4,0 0,4 -4,0 0,-4z M100,152l4,0 0,4 -4,0 0,-4z M104,152l4,0 0,4 -4,0 0,-4z M108,152l4,0 0,4 -4,0 0,-4z M112,152l4,0 0,4 -4,0 0,-4z M116,152l4,0 0,4 -4,0 0,-4z M120,152l4,0 0,4 -4,0 0,-4z M124,152l4,0 0,4 -4,0 0,-4z M128,152l4,0 0,4 -4,0 0,-4z M132,152l4,0 0,4 -4,0 0,-4z M136,152l4,0 0,4 -4,0 0,-4z M148,152l4,0 0,4 -4,0 0,-4z M164,152l4,0 0,4 -4,0 0,-4z M172,152l4,0 0,4 -4,0 0,-4z M176,152l4,0 0,4 -4,0 0,-4z M4,156l4,0 0,4 -4,0 0,-4z M8,156l4,0 0,4 -4,0 0,-4z M12,156l4,0 0,4 -4,0 0,-4z M16,156l4,0 0,4 -4,0 0,-4z M20,156l4,0 0,4 -4,0 0,-4z M24,156l4,0 0,4 -4,0 0,-4z M28,156l4,0 0,4 -4,0 0,-4z M36,156l4,0 0,4 -4,0 0,-4z M40,156l4,0 0,4 -4,0 0,-4z M44,156l4,0 0,4 -4,0 0,-4z M52,156l4,0 0,4 -4,0 0,-4z M60,156l4,0 0,4 -4,0 0,-4z M68,156l4,0 0,4 -4,0 0,-4z M72,156l4,0 0,4 -4,0 0,-4z M76,156l4,0 0,4 -4,0 0,-4z M80,156l4,0 0,4 -4,0 0,-4z M84,156l4,0 0,4 -4,0 0,-4z M92,156l4,0 0,4 -4,0 0,-4z M100,156l4,0 0,4 -4,0 0,-4z M104,156l4,0 0,4 -4,0 0,-4z M108,156l4,0 0,4 -4,0 0,-4z M120,156l4,0 0,4 -4,0 0,-4z M128,156l4,0 0,4 -4,0 0,-4z M144,156l4,0 0,4 -4,0 0,-4z M148,156l4,0 0,4 -4,0 0,-4z M156,156l4,0 0,4 -4,0 0,-4z M164,156l4,0 0,4 -4,0 0,-4z M168,156l4,0 0,4 -4,0 0,-4z M176,156l4,0 0,4 -4,0 0,-4z M4,160l4,0 0,4 -4,0 0,-4z M28,160l4,0 0,4 -4,0 0,-4z M48,160l4,0 0,4 -4,0 0,-4z M56,160l4,0 0,4 -4,0 0,-4z M68,160l4,0 0,4 -4,0 0,-4z M84,160l4,0 0,4 -4,0 0,-4z M100,160l4,0 0,4 -4,0 0,-4z M104,160l4,0 0,4 -4,0 0,-4z M108,160l4,0 0,4 -4,0 0,-4z M120,160l4,0 0,4 -4,0 0,-4z M128,160l4,0 0,4 -4,0 0,-4z M132,160l4,0 0,4 -4,0 0,-4z M140,160l4,0 0,4 -4,0 0,-4z M144,160l4,0 0,4 -4,0 0,-4z M148,160l4,0 0,4 -4,0 0,-4z M164,160l4,0 0,4 -4,0 0,-4z M176,160l4,0 0,4 -4,0 0,-4z M4,164l4,0 0,4 -4,0 0,-4z M12,164l4,0 0,4 -4,0 0,-4z M16,164l4,0 0,4 -4,0 0,-4z M20,164l4,0 0,4 -4,0 0,-4z M28,164l4,0 0,4 -4,0 0,-4z M36,164l4,0 0,4 -4,0 0,-4z M40,164l4,0 0,4 -4,0 0,-4z M44,164l4,0 0,4 -4,0 0,-4z M48,164l4,0 0,4 -4,0 0,-4z M60,164l4,0 0,4 -4,0 0,-4z M80,164l4,0 0,4 -4,0 0,-4z M84,164l4,0 0,4 -4,0 0,-4z M88,164l4,0 0,4 -4,0 0,-4z M92,164l4,0 0,4 -4,0 0,-4z M96,164l4,0 0,4 -4,0 0,-4z M100,164l4,0 0,4 -4,0 0,-4z M108,164l4,0 0,4 -4,0 0,-4z M112,164l4,0 0,4 -4,0 0,-4z M124,164l4,0 0,4 -4,0 0,-4z M132,164l4,0 0,4 -4,0 0,-4z M144,164l4,0 0,4 -4,0 0,-4z M148,164l4,0 0,4 -4,0 0,-4z M152,164l4,0 0,4 -4,0 0,-4z M156,164l4,0 0,4 -4,0 0,-4z M160,164l4,0 0,4 -4,0 0,-4z M164,164l4,0 0,4 -4,0 0,-4z M180,164l4,0 0,4 -4,0 0,-4z M4,168l4,0 0,4 -4,0 0,-4z M12,168l4,0 0,4 -4,0 0,-4z M16,168l4,0 0,4 -4,0 0,-4z M20,168l4,0 0,4 -4,0 0,-4z M28,168l4,0 0,4 -4,0 0,-4z M44,168l4,0 0,4 -4,0 0,-4z M52,168l4,0 0,4 -4,0 0,-4z M56,168l4,0 0,4 -4,0 0,-4z M68,168l4,0 0,4 -4,0 0,-4z M72,168l4,0 0,4 -4,0 0,-4z M80,168l4,0 0,4 -4,0 0,-4z M84,168l4,0 0,4 -4,0 0,-4z M88,168l4,0 0,4 -4,0 0,-4z M92,168l4,0 0,4 -4,0 0,-4z M108,168l4,0 0,4 -4,0 0,-4z M124,168l4,0 0,4 -4,0 0,-4z M132,168l4,0 0,4 -4,0 0,-4z M136,168l4,0 0,4 -4,0 0,-4z M156,168l4,0 0,4 -4,0 0,-4z M168,168l4,0 0,4 -4,0 0,-4z M172,168l4,0 0,4 -4,0 0,-4z M4,172l4,0 0,4 -4,0 0,-4z M12,172l4,0 0,4 -4,0 0,-4z M16,172l4,0 0,4 -4,0 0,-4z M20,172l4,0 0,4 -4,0 0,-4z M28,172l4,0 0,4 -4,0 0,-4z M40,172l4,0 0,4 -4,0 0,-4z M60,172l4,0 0,4 -4,0 0,-4z M76,172l4,0 0,4 -4,0 0,-4z M84,172l4,0 0,4 -4,0 0,-4z M88,172l4,0 0,4 -4,0 0,-4z M92,172l4,0 0,4 -4,0 0,-4z M108,172l4,0 0,4 -4,0 0,-4z M116,172l4,0 0,4 -4,0 0,-4z M120,172l4,0 0,4 -4,0 0,-4z M124,172l4,0 0,4 -4,0 0,-4z M128,172l4,0 0,4 -4,0 0,-4z M136,172l4,0 0,4 -4,0 0,-4z M156,172l4,0 0,4 -4,0 0,-4z M164,172l4,0 0,4 -4,0 0,-4z M168,172l4,0 0,4 -4,0 0,-4z M176,172l4,0 0,4 -4,0 0,-4z M4,176l4,0 0,4 -4,0 0,-4z M28,176l4,0 0,4 -4,0 0,-4z M52,176l4,0 0,4 -4,0 0,-4z M56,176l4,0 0,4 -4,0 0,-4z M76,176l4,0 0,4 -4,0 0,-4z M84,176l4,0 0,4 -4,0 0,-4z M92,176l4,0 0,4 -4,0 0,-4z M96,176l4,0 0,4 -4,0 0,-4z M104,176l4,0 0,4 -4,0 0,-4z M112,176l4,0 0,4 -4,0 0,-4z M120,176l4,0 0,4 -4,0 0,-4z M128,176l4,0 0,4 -4,0 0,-4z M132,176l4,0 0,4 -4,0 0,-4z M140,176l4,0 0,4 -4,0 0,-4z M144,176l4,0 0,4 -4,0 0,-4z M148,176l4,0 0,4 -4,0 0,-4z M152,176l4,0 0,4 -4,0 0,-4z M164,176l4,0 0,4 -4,0 0,-4z M168,176l4,0 0,4 -4,0 0,-4z M4,180l4,0 0,4 -4,0 0,-4z M8,180l4,0 0,4 -4,0 0,-4z M12,180l4,0 0,4 -4,0 0,-4z M16,180l4,0 0,4 -4,0 0,-4z M20,180l4,0 0,4 -4,0 0,-4z M24,180l4,0 0,4 -4,0 0,-4z M28,180l4,0 0,4 -4,0 0,-4z M36,180l4,0 0,4 -4,0 0,-4z M40,180l4,0 0,4 -4,0 0,-4z M44,180l4,0 0,4 -4,0 0,-4z M48,180l4,0 0,4 -4,0 0,-4z M56,180l4,0 0,4 -4,0 0,-4z M60,180l4,0 0,4 -4,0 0,-4z M72,180l4,0 0,4 -4,0 0,-4z M84,180l4,0 0,4 -4,0 0,-4z M96,180l4,0 0,4 -4,0 0,-4z M100,180l4,0 0,4 -4,0 0,-4z M108,180l4,0 0,4 -4,0 0,-4z M112,180l4,0 0,4 -4,0 0,-4z M124,180l4,0 0,4 -4,0 0,-4z M128,180l4,0 0,4 -4,0 0,-4z M132,180l4,0 0,4 -4,0 0,-4z M140,180l4,0 0,4 -4,0 0,-4z M144,180l4,0 0,4 -4,0 0,-4z M148,180l4,0 0,4 -4,0 0,-4z M152,180l4,0 0,4 -4,0 0,-4z M160,180l4,0 0,4 -4,0 0,-4z M168,180l4,0 0,4 -4,0 0,-4z M180,180l4,0 0,4 -4,0 0,-4z " stroke="transparent" fill="black"/></svg>
<p><bdi dir="ltr"><code>otpauth://totp/otp-demo:ada?secret=ICJER66543CXOTEAFUAJFX4VGMTBFEGW&amp;issuer=otp-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>ICJER66543CXOTEAFUAJFX4VGMTBFEGW</code></bdi></p>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=configure-totp">
  <input type="hidden" name="auth_session_id" value="01a1e3f4-c4ba-7e55-ae25-4879f0b8fdd4">
  <input type="hidden" name="secret" value="ICJER66543CXOTEAFUAJFX4VGMTBFEGW">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <button type="submit">Confirm</button>
</form>
</main>
</body>
</html>
```

(the QR image is a 28 KB inline `<svg>`, elided here; it encodes the same
`otpauth://` URI printed underneath it, so an app with a camera and an app
without reach the same secret.)

The secret travels in a hidden field and **nothing is stored yet**. A credential
written before its first correct code would lock the account out of its own
second factor if the app never actually scanned it, so the credential is created
by the submission that proves a code, not by the page that offers a secret. An
abandoned enrolment leaves no row behind at all. The submission that proves a
code also writes the one `credential` audit row, `otp.enrolled`, naming the
subject, and queues a notice to the subject's verified address in the same transaction; its `detail.notice` says `sent`,
`skipped_unverified` or `skipped_none`. A wrong code writes none and mails nothing.

## Confirming the secret enrols it, and is the login's second factor

This run generated its codes with the algorithm's own implementation rather
than a phone:

```bash
CODE=$(node --input-type=module -e "
import { totpCode, totpCounter } from '/Users/wep/WebstormProjects/odudu/packages/crypto/src/service/totp.ts';
console.log(totpCode('$SECRET', totpCounter(new Date())));
")
echo "$CODE"
```

```
094209
```

```bash
curl -sS -i -X POST \
  'http://localhost:3000/tenants/otp-demo/login-actions/required-action?action=configure-totp' \
  --data-urlencode "auth_session_id=$AUTH" \
  --data-urlencode "secret=$SECRET" \
  --data-urlencode "code=$CODE"
```

```
HTTP/1.1 200 OK
x-request-id: 01a1e3f4-c56f-7d61-9f2f-5b505380a277
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 2019
Date: Mon, 16 Nov 2026 10:43:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Save your recovery codes</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Save your recovery codes</h1>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
<ol>
  <li><bdi dir="ltr"><code>P59WP-Q7TH6</code></bdi></li>
  <li><bdi dir="ltr"><code>3HD8N-91PSW</code></bdi></li>
  <li><bdi dir="ltr"><code>F2JBD-2DEA3</code></bdi></li>
  <li><bdi dir="ltr"><code>GG809-N7PDM</code></bdi></li>
  <li><bdi dir="ltr"><code>9CP94-6K2GX</code></bdi></li>
  <li><bdi dir="ltr"><code>HKZYT-F4T3Z</code></bdi></li>
  <li><bdi dir="ltr"><code>7GG1E-CKYVH</code></bdi></li>
  <li><bdi dir="ltr"><code>2PHG0-F5JH8</code></bdi></li>
  <li><bdi dir="ltr"><code>HYGV2-X36M2</code></bdi></li>
  <li><bdi dir="ltr"><code>PCD2P-3ZVE6</code></bdi></li>
</ol>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a1e3f4-c4ba-7e55-ae25-4879f0b8fdd4">
  <button type="submit">I have saved these codes</button>
</form>
</main>
</body>
</html>
```

The parked request survives the detour — same `auth_session_id` — and it
does not go back to the login form. The code that proved the authenticator
is a one-time password verified in this authentication session, so it is
recorded as the session's `otp` factor: the flow, re-read for ada now that
she holds a TOTP credential, asks for a password and a code, and both are
already satisfied here. Nothing is asked twice, and nothing waits for the
next 30-second step.

What the login still owes is the recovery path the enrolment created, and
that page is [Recovery codes](./recovery-codes.md), below — the ten codes above
are the set it prints. The page's policy names `http://localhost:8080`
beside `'self'` in `form-action`: its form's answer is the `302` to this
request's client, and a browser holds that redirect to the directive too
([ADR 0018](https://github.com/wizzywit/odudu/blob/main/docs/adr/0018-framing-defence-on-rendered-pages.md)'s second
amendment). Acknowledging it finishes the login:

```bash
curl -sS -i -X POST \
  'http://localhost:3000/tenants/otp-demo/login-actions/required-action?action=generate-recovery-codes' \
  --data-urlencode "auth_session_id=$AUTH" | tee redirect.txt
AUTHCODE=$(sed -n 's/^location:.*code=\([^&]*\)&.*/\1/Ip' redirect.txt | tr -d '\r')
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3f4-c60d-70f2-bb1c-7683e491f140
set-cookie: otp-demo-session=01a1e3f4-c623-790b-b2fd-10de948abab9:QEw6Ei5bKQ-SPft9iYyX9iyM7tkhyygXT_nhKCf70hQ; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: otp-demo-device=o6o-730xx2No6cWx1PGjGQ; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=kd1DF9eTqZh5x-CwnJGO3uzWDEnO6GXVxqivJdUb93I&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fotp-demo
content-length: 0
Date: Mon, 16 Nov 2026 10:43:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

One password and one code, and the browser is at the client with a code and
a session cookie of the form `<session id>:<secret>`.

## What two factors do to the ID token

```bash
curl -sS -X POST http://localhost:3000/tenants/otp-demo/protocol/openid-connect/token \
  -d grant_type=authorization_code \
  -d code=$AUTHCODE \
  -d client_id=otp-spa \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

The ID token's payload (decoded; `id_token` itself is the usual three
base64url segments):

```json
{
  "sub": "01a1d098-1baa-7cab-a67c-415d7af7ceb1",
  "iss": "http://localhost:3094/tenants/otp-demo",
  "aud": "otp-spa",
  "iat": 1794500993,
  "exp": 1794501293,
  "sid": "01a1d098-213a-7e18-82bc-53dc14a09815",
  "amr": ["otp", "pwd"],
  "acr": "2"
}
```

`amr` names both factors, in RFC 8176's registry spellings rather than this
server's internal authenticator names, and `acr` is `"2"` — a statement
about this login, recorded on the session when it was established, not
re-derived at issuance from what the subject happens to have enrolled by
then. The enrolment's code is the `otp` in it.

## The next login answers the password with a code form

A fresh attempt, parked by the same `/authorize` as above, for a new
`auth_session_id`:

```bash
AUTH=$(curl -sS 'http://localhost:3000/tenants/otp-demo/protocol/openid-connect/auth?response_type=code&client_id=otp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')
curl -sS -X POST http://localhost:3000/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Enter your authentication code</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Enter your authentication code</h1>
<p class="context">to continue to <bdi>otp-spa</bdi></p>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<form method="post" action="/tenants/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a1e3f4-c660-78f6-864c-0ddb417d7243">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Verify</button>
</form>
</main>
</body>
</html>
```

The second field is the way back in for somebody whose authenticator is
gone — [Recovery codes](./recovery-codes.md) below. It is beside the app's code
rather than behind a page of its own, because anybody reaching for it has
already lost what the first field asks for.

There is no username field on it. Which account the code is checked against
comes from the authentication session, which the password step bound to
ada; a code says which secret produced it, never who is signing in, so a
form that named the account would let a second factor answer for somebody
who never passed the first one.

Submitting the code that confirmed the enrolment does **not** work — it answers
with the same form again, saying so:

```bash
curl -sS -X POST http://localhost:3000/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH" \
  --data-urlencode "code=$CODE"
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Enter your authentication code</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Enter your authentication code</h1>
<p class="context">to continue to <bdi>otp-spa</bdi></p>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">That code did not work. Check it and try again.</li>
</ul>
</div>
<form method="post" action="/tenants/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a1e3f4-c660-78f6-864c-0ddb417d7243">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" aria-invalid="true" aria-describedby="form-error-0" autofocus></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Verify</button>
</form>
</main>
</body>
</html>
```

The message is the one a wrong code gets, whether the code was replayed,
mistyped or never valid; the code field is the one that takes focus, and the
recovery field beside it does not.

RFC 6238 §5.2: a verifier must not accept an OTP twice. The credential
stores the time step of the last code it accepted, and the enrolment's own
code spent that step when it created the credential. A code from the next
step is accepted, and with nothing owed any more it finishes the login:

```bash
curl -sS -i -X POST http://localhost:3000/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH" \
  --data-urlencode "code=$(node --input-type=module -e "
import { totpCode, totpCounter } from '/Users/wep/WebstormProjects/odudu/packages/crypto/src/service/totp.ts';
console.log(totpCode('$SECRET', totpCounter(new Date(Date.now() + 30000))));
")"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1e3f4-c706-7c85-bf10-4569d9725353
set-cookie: otp-demo-session=01a1e3f4-c71d-76b0-941f-0822a8def05f:-f8G5tXaBaAtDsEQVtqsBDZ2qXHOqb5PuDKuui_qN-Q; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: otp-demo-device=p95tKDJW6tKckHd6qRHKZA; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=VHr69EC77hDGOoGl-livbfpGPLox1Te-rpd8Mt3hjDs&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fotp-demo
content-length: 0
Date: Mon, 16 Nov 2026 10:43:52 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## A policy that changes after somebody enrolled

A tenant's `totp_algorithm`, `totp_digits` and `totp_period` say what the next authenticator app is made with: `SHA1`, 6
digits and 30 seconds unless the tenant changed them. The credential keeps the three it was made under, in its row beside
the secret, and every later code is checked by them, so a change of policy strands nobody and applies to the next
enrolment only. A step of the sign-in flow can name its own `algorithm`, `digits` and `period`; a person enrolling during a sign-in on that flow gets those, and a key the step leaves out takes the tenant's value ([the sign-in flow page](../../../admin-console/sign-in-flow.mdx#authenticator-settings-on-a-step)). On a stack of its own on `http://localhost:3000`, started on an empty volume, a tenant `policy-demo` that
requires a second factor, with `ada` (client `policy-spa`) and `bob` (client `bob-spa`):

```bash
odudu seed --tenant policy-demo --client policy-spa --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery
odudu seed --tenant policy-demo --client bob-spa --redirect-uri http://localhost:8080/callback \
  --user bob --password correct-horse-battery
odudu seed tenant --name policy-demo --set otp_required=true
```

```
{"created":true,"tenant":"policy-demo","tenantId":"01a1cfb0-7768-723d-82d9-27648132f160","clientId":"policy-spa","userSubjectId":"01a1cfb0-7849-775d-8710-7f6d44030e42"}
{"created":true,"tenant":"policy-demo","tenantId":"01a1cfb0-7768-723d-82d9-27648132f160","clientId":"bob-spa","userSubjectId":"01a1cfb0-7c09-7c4f-9e14-58241ecfc346"}
{"command":"tenant","created":false,"tenant":"policy-demo","tenantId":"01a1cfb0-7768-723d-82d9-27648132f160","settings":["otp_required"]}
```

`ada` signs in and is offered the enrolment page. These blocks show the lines of the page that matter (the QR image and the rest
of the markup are left out, so they are not the bytes on the wire), as the same `auth_session_id` flow above produces them:

```
<title>Set up your authenticator</title>
<p>Scan this with your authenticator app, or enter the key by hand.</p>
<p><bdi dir="ltr"><code>otpauth://totp/policy-demo:ada?secret=AJPEPRQ3ULN6QOU3WZHZKC7KR3UH42SK&amp;issuer=policy-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>AJPEPRQ3ULN6QOU3WZHZKC7KR3UH42SK</code></bdi></p>
  <input type="hidden" name="secret" value="AJPEPRQ3ULN6QOU3WZHZKC7KR3UH42SK">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
```

She confirms with the code her app shows, which arrives with her set of recovery codes (`10` of them). The
tenant then changes its parameters and the size of a set:

```bash
odudu seed tenant --name policy-demo --set totp_algorithm=SHA256 --set totp_digits=8 \
  --set totp_period=60 --set recovery_code_count=12
```

```
{"command":"tenant","created":false,"tenant":"policy-demo","tenantId":"01a1cfb0-7768-723d-82d9-27648132f160","settings":["totp_algorithm","totp_digits","totp_period","recovery_code_count"]}
```

`bob` signs in after the change. The page says what an app must support, and the address the QR code encodes carries the three
parameters. His confirmation, an 8-digit SHA256 code at a 60-second step, is accepted and shows a set of `12` codes:

```
<title>Set up your authenticator</title>
<p>Scan this with your authenticator app, or enter the key by hand.</p>
<p>This authenticator uses SHA256, 8 digits and a 60-second period. Your app must support all three, or use a different one.</p>
<p><bdi dir="ltr"><code>otpauth://totp/policy-demo:bob?secret=DSR5NIEILND4AM3WYXBGTUYIYJWKMVHS&amp;issuer=policy-demo&amp;algorithm=SHA256&amp;digits=8&amp;period=60</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>DSR5NIEILND4AM3WYXBGTUYIYJWKMVHS</code></bdi></p>
  <input type="hidden" name="secret" value="DSR5NIEILND4AM3WYXBGTUYIYJWKMVHS">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
```

Each credential holds what it was made under, read here as the database owner without the secret:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select u.username, c.secret_data - 'secret' as parameters from user_credentials c join users u on u.subject_id = c.subject_id where c.type = 'totp' and c.tenant_id = (select id from tenants where name = 'policy-demo') order by u.username"
```

```
 username |                                parameters
----------+--------------------------------------------------------------------------
 ada      | {"digits": 6, "period": 30, "lastStep": 59816193, "algorithm": "SHA1"}
 bob      | {"digits": 8, "period": 60, "lastStep": 29908096, "algorithm": "SHA256"}
(2 rows)
```

A minute later, `ada` signs in again. A code made the way the tenant now makes them (8 digits, SHA256, 60 seconds) is refused for her,
and the 6-digit SHA1 code her app shows is accepted: the next page is the one that asks her to save the set she was shown (she had not
acknowledged it), where a refusal would have shown the code form again. The refused answer's error line, then the accepted answer's
status and page title:

```
<li id="form-error-0">That code did not work. Check it and try again.</li>
```

```
HTTP/1.1 200 OK
<title>Save your recovery codes</title>
```

`bob` signs in with his 8-digit code the same way, and is accepted:

```
HTTP/1.1 200 OK
<title>Save your recovery codes</title>
```

The codes in these blocks were made with the `totpCode` function, given the algorithm, digits and period of the credential.
