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

On a stack of its own, started on an empty volume (each block names its port), this
section, down to the one on a policy that changes, and the `otp-demo` half of
[Recovery codes](./recovery-codes.md) were run front to back against it. The policy
section and the `rc8-demo` half of that page are earlier captures and say so. The HTML bodies are the
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
{"created":true,"tenant":"otp-demo","tenantId":"01a1e44b-50d0-765b-8219-009a158c88b6","clientId":"otp-spa","userSubjectId":"01a1e44b-5161-776d-85e0-085b59517e04"}
{"command":"tenant","created":false,"tenant":"otp-demo","tenantId":"01a1e44b-50d0-765b-8219-009a158c88b6","settings":["otp_required"]}
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
<p class="brand"><svg …>…</svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Set up your authenticator</h1>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<p>Scan this with your authenticator app, or enter the key by hand.</p>
<svg …>…</svg>
<p><bdi dir="ltr"><code>otpauth://totp/otp-demo:ada?secret=MHCZ3NPJNKOMIK75KLGKRDA2TAAQLKGF&amp;issuer=otp-demo&amp;algorithm=SHA1&amp;digits=6&amp;period=30</code></bdi></p>
<p>Key: <bdi dir="ltr"><code>MHCZ3NPJNKOMIK75KLGKRDA2TAAQLKGF</code></bdi></p>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=configure-totp">
  <input type="hidden" name="auth_session_id" value="01a1e44b-536c-7d43-a75c-ff803e1ff592">
  <input type="hidden" name="secret" value="MHCZ3NPJNKOMIK75KLGKRDA2TAAQLKGF">
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
816508
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
x-request-id: 01a1e44b-5423-70b9-8e70-5b0714696668
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 2019
Date: Mon, 16 Nov 2026 12:18:24 GMT
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
<p class="brand"><svg …>…</svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Save your recovery codes</h1>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
<ol>
  <li><bdi dir="ltr"><code>B0BQH-BJWYR</code></bdi></li>
  <li><bdi dir="ltr"><code>HE4RP-V13RV</code></bdi></li>
  <li><bdi dir="ltr"><code>A3FMF-7DQFC</code></bdi></li>
  <li><bdi dir="ltr"><code>H4E1A-ERA6Q</code></bdi></li>
  <li><bdi dir="ltr"><code>EDE4Z-3T2FA</code></bdi></li>
  <li><bdi dir="ltr"><code>WMD0S-8CHR3</code></bdi></li>
  <li><bdi dir="ltr"><code>5JCWJ-84CBC</code></bdi></li>
  <li><bdi dir="ltr"><code>BDYW9-ATHZP</code></bdi></li>
  <li><bdi dir="ltr"><code>7XAD4-ZNFQ7</code></bdi></li>
  <li><bdi dir="ltr"><code>7XN5C-9VTVF</code></bdi></li>
</ol>
<form method="post" action="/tenants/otp-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a1e44b-536c-7d43-a75c-ff803e1ff592">
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
x-request-id: 01a1e44b-54c6-7998-a73f-8255fc66ba34
set-cookie: otp-demo-session=01a1e44b-54e5-7385-87d8-b87ac5ebbf7b:-Ijyxqk5fqZP4iZHLbGHUbsykb7Jjhxs86ZXXttdENg; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: otp-demo-device=XJtt_iJCYOMEvOZf5naRXQ; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=w7deQ5VTkKjK6UdK91aXePjUfVOaMm_jPHaz-04reTs&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fotp-demo
content-length: 0
Date: Mon, 16 Nov 2026 12:18:24 GMT
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
  -d code_verifier=dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk \
  | jq -r .id_token | cut -d. -f2 \
  | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" \
  | jq '{sub,iss,aud,iat,exp,sid,amr,acr}'
```

The ID token's payload, decoded by the command (`id_token` itself is the usual three
base64url segments):

```
{
  "sub": "01a1e44b-5161-776d-85e0-085b59517e04",
  "iss": "http://localhost:3000/tenants/otp-demo",
  "aud": "otp-spa",
  "iat": 1794831504,
  "exp": 1794831804,
  "sid": "01a1e44b-54e5-7385-87d8-b87ac5ebbf7b",
  "amr": [
    "otp",
    "pwd"
  ],
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
<p class="brand"><svg …>…</svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Enter your authentication code</h1>
<p class="context">to continue to <bdi>otp-spa</bdi></p>
<p class="tenant"><bdi>otp-demo</bdi></p>
</header>
<form method="post" action="/tenants/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a1e44b-5537-7dea-a516-d28c92cc4d5c">
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
<p class="brand"><svg …>…</svg><span class="wordmark">odudu</span></p>
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
  <input type="hidden" name="auth_session_id" value="01a1e44b-5537-7dea-a516-d28c92cc4d5c">
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
x-request-id: 01a1e44b-55e5-72d4-8649-01ccac0f7461
set-cookie: otp-demo-session=01a1e44b-55fc-7e11-92d3-f81be48988aa:TF19vY5ObCqgJ_lG56QuwqhY2vUpOfeLJPHzpwp_q9U; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: otp-demo-device=yI3vtNI6natXxNuIzj-w4g; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=KocCFb1Rpb5WfrIBr3MXURXn3ja-QnE6iC476af-DPI&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fotp-demo
content-length: 0
Date: Mon, 16 Nov 2026 12:18:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## A policy that changes after somebody enrolled

**This section is an earlier capture, not part of the run above.** It was run on 2026-11-13 on a stack of its own, as its
commands name, by a script the page does not show: the enrolments and sign-ins whose pages are quoted below were driven by
that script, and only the commands shown are the ones that ran.

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
