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
{"created":true,"tenant":"otp-demo","tenantId":"01a1d098-…","clientId":"otp-spa","userSubjectId":"01a1d098-…"}
{"command":"tenant","created":false,"tenant":"otp-demo","tenantId":"01a1d098-1a57-783a-a0c2-fd26b14da41e","settings":["otp_required"]}
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
  --data-urlencode 'auth_session_id=01a1d098-1efe-7c74-8e35-4a18df3bd375' \
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
<p><bdi dir="ltr"><code>otpauth://totp/otp-demo:ada?secret=RB6JLQATQG6K76IC45CZRAJFPXHD7PHN&amp;issuer=otp-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>RB6JLQATQG6K76IC45CZRAJFPXHD7PHN</code></bdi></p>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=configure-totp">
  <input type="hidden" name="auth_session_id" value="01a1d098-1efe-7c74-8e35-4a18df3bd375">
  <input type="hidden" name="secret" value="RB6JLQATQG6K76IC45CZRAJFPXHD7PHN">
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
console.log(totpCode('RB6JLQATQG6K76IC45CZRAJFPXHD7PHN', totpCounter(new Date())));
"
```

```
148889
```

```bash
curl -sS -i -X POST \
  'http://localhost:3094/tenants/otp-demo/login-actions/required-action?action=configure-totp' \
  --data-urlencode 'auth_session_id=01a1d098-1efe-7c74-8e35-4a18df3bd375' \
  --data-urlencode 'secret=RB6JLQATQG6K76IC45CZRAJFPXHD7PHN' \
  --data-urlencode 'code=148889'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1d098-201c-7251-91d6-74f7d954353a
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 2019
Date: Thu, 12 Nov 2026 16:29:53 GMT
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
  <li><bdi dir="ltr"><code>GTHNV-QXZB8</code></bdi></li>
  <li><bdi dir="ltr"><code>5CPB8-K6X9K</code></bdi></li>
  <li><bdi dir="ltr"><code>7162B-HBZYV</code></bdi></li>
  <li><bdi dir="ltr"><code>88CQ3-FBA79</code></bdi></li>
  <li><bdi dir="ltr"><code>EDFSM-8Z98Z</code></bdi></li>
  <li><bdi dir="ltr"><code>2Z3RE-H9QWS</code></bdi></li>
  <li><bdi dir="ltr"><code>0FJP7-3W7Y4</code></bdi></li>
  <li><bdi dir="ltr"><code>ZGJ7K-0NX81</code></bdi></li>
  <li><bdi dir="ltr"><code>MQ74V-P2SKE</code></bdi></li>
  <li><bdi dir="ltr"><code>B52ST-MAZ4J</code></bdi></li>
</ol>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a1d098-1efe-7c74-8e35-4a18df3bd375">
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
  --data-urlencode 'auth_session_id=01a1d098-1efe-7c74-8e35-4a18df3bd375'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d098-210f-71a7-8143-a8051bc80855
set-cookie: otp-demo-session=01a1d098-213a-7e18-82bc-53dc14a09815:vGA-knCVRSm7imfqP3ot_b1lR7ir4gSQbEhPBs6T-yA; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: otp-demo-device=RbaWYjhccVb_DxjOIzNmZg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=kHdSfB3eRa_LFJ4gu0OU3-i22EVN0xNXt46Rg8HHqEY&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fotp-demo
content-length: 0
Date: Thu, 12 Nov 2026 16:29:53 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

One password and one code, and the browser is at the client with a code and
a session cookie of the form `<session id>:<secret>`.

## What two factors do to the ID token

```bash
curl -sS -X POST http://localhost:3094/tenants/otp-demo/protocol/openid-connect/token \
  -d grant_type=authorization_code \
  -d code=kHdSfB3eRa_LFJ4gu0OU3-i22EVN0xNXt46Rg8HHqEY \
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
`auth_session_id`, `01a137d3-9bc1-7987-8c23-f806ce89510f`:

```bash
curl -sS -X POST http://localhost:3094/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d098-219a-7cc0-94b1-f1bf067ce541' \
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
  <input type="hidden" name="auth_session_id" value="01a1d098-219a-7cc0-94b1-f1bf067ce541">
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
  --data-urlencode 'auth_session_id=01a1d098-219a-7cc0-94b1-f1bf067ce541' \
  --data-urlencode 'code=581754'
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d098-4184-782a-b62a-380d83726297
set-cookie: otp-demo-session=01a1d098-41b1-7dfd-ac35-672382c164a4:WlwJIHfZYwiPYV4bsTjybWnbtz3dnxht8mf0PKAw0pU; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: otp-demo-device=1RZiZ8CPBzcKpBH96TOpYg; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=6Pq4aM7M6qQ-azHy61jVs41FHk2P2rT2cae1l9SQ2xM&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fotp-demo
content-length: 0
Date: Thu, 12 Nov 2026 16:30:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## A policy that changes after somebody enrolled

A tenant's `totp_algorithm`, `totp_digits` and `totp_period` say what the next authenticator app is made with: `SHA1`, 6
digits and 30 seconds unless the tenant changed them. The credential keeps the three it was made under, in its row beside
the secret, and every later code is checked by them, so a change of policy strands nobody and applies to the next
enrolment only. On a stack of its own on `http://localhost:3000`, started on an empty volume, a tenant `policy-demo` that
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
