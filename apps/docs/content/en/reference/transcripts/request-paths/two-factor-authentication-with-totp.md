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

On a stack of its own, on `http://localhost:3094`, started on an empty volume,
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
{"created":true,"tenant":"otp-demo","tenantId":"01a137d3-…","clientId":"otp-spa","userSubjectId":"01a137d3-…"}
{"command":"tenant","created":false,"tenant":"otp-demo","tenantId":"01a137d3-93e5-7a35-b789-277980331f13","settings":["otp_required"]}
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
curl -sS 'http://localhost:3094/tenants/otp-demo/protocol/openid-connect/auth?response_type=code&client_id=otp-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

The `auth_session_id` in that form — `01a137d3-98b1-7904-aeda-9a6709b81b53`
in this run — is what every request below carries. Posting the correct
password answers 200 with an enrolment page rather than 302 with a code:
the password was accepted, and the pending action is what stops the login
from completing (no `set-cookie`, no `code`).

```bash
curl -sS -X POST http://localhost:3094/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d3-98b1-7904-aeda-9a6709b81b53' \
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
<svg …>…</svg>
<p><bdi dir="ltr"><code>otpauth://totp/otp-demo:ada?secret=BYIQDMIGLQSMNOGKTZMVAGWBLWEOE7ZY&amp;issuer=otp-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>BYIQDMIGLQSMNOGKTZMVAGWBLWEOE7ZY</code></bdi></p>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=configure-totp">
  <input type="hidden" name="auth_session_id" value="01a137d3-98b1-7904-aeda-9a6709b81b53">
  <input type="hidden" name="secret" value="BYIQDMIGLQSMNOGKTZMVAGWBLWEOE7ZY">
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
node --input-type=module -e "
import { totpCode, totpCounter } from './packages/crypto/src/service/totp.ts';
console.log(totpCode('BYIQDMIGLQSMNOGKTZMVAGWBLWEOE7ZY', totpCounter(new Date())));
"
```

```
474168
```

```bash
curl -sS -i -X POST \
  'http://localhost:3094/tenants/otp-demo/login-actions/required-action?action=configure-totp' \
  --data-urlencode 'auth_session_id=01a137d3-98b1-7904-aeda-9a6709b81b53' \
  --data-urlencode 'secret=BYIQDMIGLQSMNOGKTZMVAGWBLWEOE7ZY' \
  --data-urlencode 'code=474168'
```

```
HTTP/1.1 200 OK
x-request-id: 01a137d3-99f5-7c70-ba82-a75606f1c447
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 2019
Date: Wed, 14 Oct 2026 00:32:57 GMT
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
  <li><bdi dir="ltr"><code>TKBYN-J8QGH</code></bdi></li>
  <li><bdi dir="ltr"><code>NMFNF-273QV</code></bdi></li>
  <li><bdi dir="ltr"><code>WMTKH-5WFJ9</code></bdi></li>
  <li><bdi dir="ltr"><code>AWXJH-9Q43E</code></bdi></li>
  <li><bdi dir="ltr"><code>NTPYA-9GJNJ</code></bdi></li>
  <li><bdi dir="ltr"><code>NS5BM-Z503B</code></bdi></li>
  <li><bdi dir="ltr"><code>40HQS-ZTRXC</code></bdi></li>
  <li><bdi dir="ltr"><code>STXZG-CGAQF</code></bdi></li>
  <li><bdi dir="ltr"><code>TFF63-YK29X</code></bdi></li>
  <li><bdi dir="ltr"><code>TGGRZ-1EF3V</code></bdi></li>
</ol>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a137d3-98b1-7904-aeda-9a6709b81b53">
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
  'http://localhost:3094/tenants/otp-demo/login-actions/required-action?action=generate-recovery-codes' \
  --data-urlencode 'auth_session_id=01a137d3-98b1-7904-aeda-9a6709b81b53'
```

```
HTTP/1.1 302 Found
x-request-id: 01a137d3-9aef-775e-a7a6-a250bd854b55
set-cookie: otp-demo-session=01a137d3-9b25-7358-b71d-b4293a769a47:57eh4x7sl2aNGrjf91JFD2mnXWmy-ktG6t0dz5uTDfA; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=TS_QW6o-8Y1kzRj1_rRh2hQ4FbtDaLhFaz9tBf5F6sw&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fotp-demo
content-length: 0
Date: Wed, 14 Oct 2026 00:32:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

One password and one code, and the browser is at the client with a code and
a session cookie of the form `<session id>:<secret>`.

## What two factors do to the ID token

```bash
curl -sS -X POST http://localhost:3094/tenants/otp-demo/protocol/openid-connect/token \
  -d grant_type=authorization_code \
  -d code=TS_QW6o-8Y1kzRj1_rRh2hQ4FbtDaLhFaz9tBf5F6sw \
  -d client_id=otp-spa \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
```

The ID token's payload (decoded; `id_token` itself is the usual three
base64url segments):

```json
{
  "sub": "01a137d3-946e-727f-91c9-3c754e9981c3",
  "iss": "http://localhost:3094/tenants/otp-demo",
  "aud": "otp-spa",
  "iat": 1791937977,
  "exp": 1791938277,
  "sid": "01a137d3-9b25-7358-b71d-b4293a769a47",
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
`auth_session_id`, `01a137d3-9bc1-7987-8c23-f806ce89510f`:

```bash
curl -sS -X POST http://localhost:3094/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d3-9bc1-7987-8c23-f806ce89510f' \
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
  <input type="hidden" name="auth_session_id" value="01a137d3-9bc1-7987-8c23-f806ce89510f">
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
with the same form again, saying so. (This one is from a run on `http://localhost:3195`, against `otp2-demo`, a
tenant seeded the way `otp-demo` is, where the enrolment's code was `483676`.
The two recovery code refusals below are from the same stack.)

```bash
curl -sS -X POST http://localhost:3195/tenants/otp2-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a16368-8465-73e2-abe3-fda7b84b4ef9' \
  --data-urlencode 'code=483676'
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
<p class="tenant"><bdi>otp2-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">That code did not work. Check it and try again.</li>
</ul>
</div>
<form method="post" action="/tenants/otp2-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a16368-8465-73e2-abe3-fda7b84b4ef9">
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
curl -sS -i -X POST http://localhost:3094/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d3-9bc1-7987-8c23-f806ce89510f' \
  --data-urlencode 'code=164806'
```

```
HTTP/1.1 302 Found
x-request-id: 01a137d3-9cf6-70e7-9bec-7754f5fb6e3d
set-cookie: otp-demo-session=01a137d3-9d0a-760c-aa16-a26add0afde0:zTqnr3XE8dypwf4XLpxGBiuJ2OHjtAiWDmJs-tLj3Wk; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=REWfO6a8FMPFBqjUJBmd7EFLtUciTh0GfCLSyFWNwl4&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fotp-demo
content-length: 0
Date: Wed, 14 Oct 2026 00:32:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```
