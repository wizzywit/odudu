---
title: "A subject's consents: list and revoke"
description: 'The read requires view-users, the delete manage-users.'
---

# A subject's consents: list and revoke

> **Not replayed after the device cookie.** A response on this page that ends a sign-in now also carries a `set-cookie` for `<tenant>-device`, which the blocks below do not show, because this page was captured before that cookie existed and has not been run again. [A session's device](../request-paths/the-me-api.md#a-sessions-device) is a live capture of the cookie.

This page covers `GET /subjects/:id/consents` and `DELETE /subjects/:id/consents/:clientId`.

The read requires `view-users`, the delete `manage-users`. A consent is what the
consent screen records when a `consent_required` client asks and a subject
allows — paged by keyset on the client's own `client_id`, as every other
collection is (`limit` up to 200, `link` and `next` as `GET /subjects` carries
them), because the number of clients a subject has consented to is not bounded
by anything the subject does. Each entry names the client by both ids:
`client_id` is its row id, what `:clientId` on the delete names, and
`client_key` its own OAuth `client_id` string, the one an operator actually
recognises. `scope_names` is every scope currently granted, and `granted_at` is
when the grant, as it now reads, was last written — the consent screen replaces
the whole granted set on every submission, so this is never older than the most
recent consent decision. `DELETE` withdraws the grant outright: the row and
every scope under it are gone, `consent_scopes` cascading on `consents.id`, and
the next `/authorize` that reaches this client finds nothing recorded and asks
again. An unknown subject on the read, or a subject with no consent to that
client on the delete, answers `404`.

**Revoking a consent also revokes every token issued under it, live or
offline.** An `offline_access` family rotates indefinitely — bounded only by its
own TTL per rotation, never by the consent it was first granted under
(`refresh-rotation.ts`'s own comment on `grant.sessionId === null`) — so leaving
it alone would mean a subject who revoked access is still impersonated by
whatever refresh token that client already holds. This route revokes the grant
in the same transaction it deletes the consent: the next refresh answers
`invalid_grant`, and an outstanding access token introspects `active: false`,
immediately, not at its own expiry.
`tokenGrantRepository.revokeForSubjectClient` is the same idempotent
`coalesce(revoked_at, …)` write `revokeForSession` already makes for a session's
own grants (`token_grants_by_subject` serves its lookup). Demonstrated below.

In a tenant `consents-demo2` made for this section, on a confidential client
`consents-demo-app2` created with `consent_required` true and a subject `grace`
seeded with a real password (`odudu seed user`, so no `update-password` detour
is needed first). `/authorize`, asking for `offline_access` too, followed by
logging in:

```bash
AUTH_SESSION_ID=$(curl -sS \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/auth?response_type=code&client_id=consents-demo-app2&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid%20offline_access&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)

curl -sS \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode "username=grace" \
  --data-urlencode "password=correct horse battery staple" \
  'http://localhost:3000/tenants/consents-demo2/login-actions/authenticate' \
  | grep '<form'
```

The consent screen, `openid` shown as already implied and `offline_access`
the one box the subject can grant:

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Allow access?</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1><bdi>consents-demo-app2</bdi> is asking for access</h1>
<p class="tenant"><bdi>consents-demo2</bdi></p>
</header>
<form method="post" action="/tenants/consents-demo2/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a0e558-b0a9-763b-84f8-f348efaacd53">
  <ul>
  <li><bdi>openid</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="offline_access"> <bdi>offline_access</bdi> — grants ongoing access, even while you are not present</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
</main>
</body>
</html>
```

Allowing both scopes, then redeeming the code for an access and refresh
token:

```bash
curl -sS -D - -c jar -b jar \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode "decision=allow" \
  --data-urlencode "scope=offline_access" \
  'http://localhost:3000/tenants/consents-demo2/login-actions/consent'

curl -sS -X POST \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=SInvyBACjbt6xBEec6hT1Way6Fpm4tj_6SEyiZr3dEM" \
  --data-urlencode "redirect_uri=https://app.example/callback" \
  --data-urlencode "code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk" \
  -u "consents-demo-app2:PaTErX2vTk6H_-eAP-1xOIh2BHMOp6dPekxmkisf-gg" \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/token'
```

```
HTTP/1.1 302 Found
x-request-id: 01a0e558-ce27-7849-80eb-a2d2dcf6a18a
set-cookie: consents-demo2-session=01a0e558-ce34-74a4-a8ac-7da0e3702e69:7pi1cgx3w7uKV4Afg2Aq_3M4snQunDoUOl7OmUaLNvc; HttpOnly; SameSite=Lax; Path=/
set-cookie: consents-demo2-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/consents-demo2/; Max-Age=0
location: https://app.example/callback?code=SInvyBACjbt6xBEec6hT1Way6Fpm4tj_6SEyiZr3dEM&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fconsents-demo2
content-length: 0
Date: Mon, 28 Sep 2026 00:09:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"access_token":"eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTBlMmM4LTI1MzQtNzNmZC05ZGY4LThiZTllNmQxODVkNiIsInR5cCI6ImF0K2p3dCJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiIsInN1YiI6IjAxYTBlMmM4LTRkNDctN2E4NC1iOTQ3LTVlZjFiOTZhN2M2ZSIsImF1ZCI6WyJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiJdLCJjbGllbnRfaWQiOiJjb25zZW50cy1kZW1vLWFwcDIiLCJzY29wZSI6Im9wZW5pZCBvZmZsaW5lX2FjY2VzcyIsImlhdCI6MTc5MDU1NDE5NywiZXhwIjoxNzkwNTU0NDk3LCJqdGkiOiIwMWEwZTU1OC1jZTZmLTczM2UtOWExYy0zNTkzYmE0MjVkM2YiLCJncmFudF9pZCI6IjAxYTBlNTU4LWNlNmYtNzMzZS05YTFjLTM1OTI3M2ZhMzNlOCJ9.SG-i141R0VlhhniXUdotW7d5S_lcEp_4DMsqjP6fnNA_njayv3T_Va1lTFpEHpfy40kvflSXqSNh6RjfQ1-ZlA","id_token":"eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTBlMmM4LTI1MzQtNzNmZC05ZGY4LThiZTllNmQxODVkNiJ9.eyJzdWIiOiIwMWEwZTJjOC00ZDQ3LTdhODQtYjk0Ny01ZWYxYjk2YTdjNmUiLCJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiIsImF1ZCI6ImNvbnNlbnRzLWRlbW8tYXBwMiIsImlhdCI6MTc5MDU1NDE5NywiZXhwIjoxNzkwNTU0NDk3fQ.ZMBPf8vMkVTBEoARSrjDmzaSu9cD8LWzySTs1sLPpeOoUce8Ox823BPia5FE-TuNfKvSC1U56Nic1VvZapFZvg","refresh_token":"D0_gfIdY5BVJ0_BebFj_wBD_Ze55TFnmc9pBbn1f_l8","token_type":"Bearer","expires_in":300,"scope":"openid offline_access"}
```

`GET /subjects/:id/consents` shows what was granted — `openid` is implied,
never ticked, and appears here anyway:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents
```

```
{"items":[{"client_id":"01a0e2c8-35b0-7767-a5ee-d2b6f29258e2","client_key":"consents-demo-app2","scope_names":["openid","offline_access"],"granted_at":"2026-09-28T00:09:57.550Z"}]}
```

Revoking it:

```bash
curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents/01a0e2c8-35b0-7767-a5ee-d2b6f29258e2
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0e558-e849-7fb9-b904-65507dbb75a1
cache-control: no-store
Date: Mon, 28 Sep 2026 00:10:04 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The refresh token minted before the revoke now answers `invalid_grant` —
the revoke reached it, not only the consent:

```bash
curl -sS -D - -X POST \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=D0_gfIdY5BVJ0_BebFj_wBD_Ze55TFnmc9pBbn1f_l8" \
  -u "consents-demo-app2:PaTErX2vTk6H_-eAP-1xOIh2BHMOp6dPekxmkisf-gg" \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/token'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a0e559-025e-7e11-9dc2-daccca70dae4
vary: Origin
cache-control: no-store
pragma: no-cache
content-type: application/json; charset=utf-8
content-length: 79
Date: Mon, 28 Sep 2026 00:10:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"error":"invalid_grant","error_description":"The code or token is not valid."}
```

The access token minted alongside it introspects inactive, ahead of its own
`exp`:

```bash
curl -sS -X POST \
  --data-urlencode "token=eyJhbGciOiJFUzI1NiIsImtpZCI6IjAxYTBlMmM4LTI1MzQtNzNmZC05ZGY4LThiZTllNmQxODVkNiIsInR5cCI6ImF0K2p3dCJ9.eyJpc3MiOiJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiIsInN1YiI6IjAxYTBlMmM4LTRkNDctN2E4NC1iOTQ3LTVlZjFiOTZhN2M2ZSIsImF1ZCI6WyJodHRwOi8vbG9jYWxob3N0OjMwMDAvdGVuYW50cy9jb25zZW50cy1kZW1vMiJdLCJjbGllbnRfaWQiOiJjb25zZW50cy1kZW1vLWFwcDIiLCJzY29wZSI6Im9wZW5pZCBvZmZsaW5lX2FjY2VzcyIsImlhdCI6MTc5MDU1NDE5NywiZXhwIjoxNzkwNTU0NDk3LCJqdGkiOiIwMWEwZTU1OC1jZTZmLTczM2UtOWExYy0zNTkzYmE0MjVkM2YiLCJncmFudF9pZCI6IjAxYTBlNTU4LWNlNmYtNzMzZS05YTFjLTM1OTI3M2ZhMzNlOCJ9.SG-i141R0VlhhniXUdotW7d5S_lcEp_4DMsqjP6fnNA_njayv3T_Va1lTFpEHpfy40kvflSXqSNh6RjfQ1-ZlA" \
  -u "consents-demo-app2:PaTErX2vTk6H_-eAP-1xOIh2BHMOp6dPekxmkisf-gg" \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/token/introspect'
```

```
{"active":false}
```

A fresh login for the same client, after the revoke, stops at the consent
screen again rather than redirecting straight to a code:

```bash
AUTH_SESSION_ID=$(curl -sS \
  'http://localhost:3000/tenants/consents-demo2/protocol/openid-connect/auth?response_type=code&client_id=consents-demo-app2&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid%20offline_access&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256' \
  | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)

curl -sS \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode "username=grace" \
  --data-urlencode "password=correct horse battery staple" \
  'http://localhost:3000/tenants/consents-demo2/login-actions/authenticate' \
  | grep '<form'
```

```
<form method="post" action="/tenants/consents-demo2/login-actions/consent">
```

The same read again — the list is empty — and a repeat of the delete
answers `404`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents

curl -sS -D - -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/01a0e2c8-4d47-7a84-b947-5ef1b96a7c6e/consents/01a0e2c8-35b0-7767-a5ee-d2b6f29258e2
```

```
{"items":[]}
HTTP/1.1 404 Not Found
x-request-id: 01a0e559-3dc0-7ac8-8559-3cd7fe3a816f
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 105
Date: Mon, 28 Sep 2026 00:10:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"instance":"01a0e559-3dc0-7ac8-8559-3cd7fe3a816f"}
```

An unknown subject on the read answers `404`:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/consents-demo2/subjects/0199aa00-0000-7000-8000-0000000000ff/consents
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a0e559-3dd9-7b6f-8091-e483704fa066
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 164
Date: Mon, 28 Sep 2026 00:10:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"no subject 0199aa00-0000-7000-8000-0000000000ff","instance":"01a0e559-3dd9-7b6f-8091-e483704fa066"}
```

## Paging a subject's consents

In `perf-demo` (a subject `grace` and four clients `alpha-app` to `delta-app`,
one consent each, written with `insert into consents` because the consent screen
records one per sign-in), the first two:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/subjects/$G/consents?limit=2"
```

```
HTTP/1.1 200 OK
x-request-id: 01a10f7d-ffee-775b-ab8d-3eff39fd45e8
cache-control: no-store
link: </admin/tenants/perf-demo/subjects/01a10f7d-bb83-7e78-ab4a-84756ef68b49/consents?limit=2&cursor=eyJhZnRlciI6ImJldGEtYXBwIiwiY29sbGVjdGlvbiI6ImNvbnNlbnRzIiwidGVuYW50SWQiOiIwMWExMGY3ZC1iYjBhLTdjYTctYjRhNS0xZjE3MzYwOWJmZjUiLCJmaWx0ZXJzIjoiMnl5WFJXMExValpHa2tfZ0dvR3Rlay04Qm0yeUZ6Mk9JZm9ZSE1MUUVVdyJ9.8a7ijDgE6fTMcaoWF-jKtQYjWaIOU58H3jE-WAI4mDc>; rel="next"
content-type: application/json; charset=utf-8
content-length: 550
Date: Tue, 27 Oct 2026 01:29:05 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"client_id":"01a10f7d-edbc-792a-b693-f9abee8b7a7e","client_key":"alpha-app","scope_names":["openid"],"granted_at":"2026-10-06T04:34:33.829Z"},{"client_id":"01a10f7d-edff-7361-b906-289b7b5f7ef3","client_key":"beta-app","scope_names":["openid"],"granted_at":"2026-10-06T04:34:33.829Z"}],"next":"eyJhZnRlciI6ImJldGEtYXBwIiwiY29sbGVjdGlvbiI6ImNvbnNlbnRzIiwidGVuYW50SWQiOiIwMWExMGY3ZC1iYjBhLTdjYTctYjRhNS0xZjE3MzYwOWJmZjUiLCJmaWx0ZXJzIjoiMnl5WFJXMExValpHa2tfZ0dvR3Rlay04Qm0yeUZ6Mk9JZm9ZSE1MUUVVdyJ9.8a7ijDgE6fTMcaoWF-jKtQYjWaIOU58H3jE-WAI4mDc"}
```
