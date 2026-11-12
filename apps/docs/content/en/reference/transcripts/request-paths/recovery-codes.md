---
title: 'Recovery codes'
description: 'Enrolling a TOTP creates a way to be locked out: lose the phone and the password alone no longer signs anybody in.'
---

# Recovery codes

Enrolling a TOTP creates a way to be locked out: lose the phone and
the password alone no longer signs anybody in. So completing `configure-totp`
adds the `generate-recovery-codes` required action to a subject who holds no
codes already, and that is the page the walkthrough above landed on.
Completing `configure-passkey` does not: a recovery code is redeemed only at
the TOTP code step, which a passkey skips, so a set issued for one could never
be used. A subject who _does_ already hold codes is not
asked again: a new factor does not invalidate a list they have saved, and
re-issuing would silently retire the copy on their paper.

Two more moments owe it, and one removes it. A sign-in that completes for a
subject who holds a second factor and no unspent code owes the action once,
so a set revoked without a new one asked for does not leave them with no way
back. And removing the **last TOTP** through the admin API deletes
the whole set with it, spent rows included, and an owed set with it: a code
only stands in for a TOTP code, and a set that outlived it would work again
after a re-enrolment. A passkey is no TOTP, so it neither owes a set nor keeps
one alive. A subject with no TOTP is never accepted a recovery code, in a
tenant that requires a second factor or not. The
admin side, with its transcripts, is
[`DELETE /subjects/:id/recovery-codes`](../admin-paths/delete-subjectsidrecovery-codes.md).
Issuing takes the subject's row lock, the one a removal holds, and is refused
while no TOTP is held: a set never outlives the last TOTP, even for a person
regenerating at the instant it is removed. The gate that reads what a subject
owes drops an owed set from somebody with no TOTP, so a correct sign-in goes on
instead of meeting a page that cannot be shown; the one page door that can still
meet the race continues the parked login the same way.

Every set issued writes one `credential` audit row,
`recovery_codes.issued`, in the transaction that stores the hashes — the
forced first set included, and again for each set issued in its place. A
replacement the hourly bound refuses writes `recovery_codes.refused` instead.
Neither row carries a code.

Every command and response below continues the same stack, the same
`otp-demo` tenant and, to begin with, the same `auth_session_id`.

## The one time the codes are shown

The page is the response to the enrolment's own submission, printed in full
under [Confirming the secret enrols it](./two-factor-authentication-with-totp.md#confirming-the-secret-enrols-it-and-is-the-logins-second-factor)
above.

Ten characters each from Crockford's 32-character base32 alphabet, printed
as two groups of five: 32^10, which is 2^50 per code. The alphabet's
excluded letters — `I`, `L` and `O` — are the ones a reader confuses with
`1` and `0`, and a code typed with them is folded onto the digits rather
than refused (the replay below does exactly that).

**The page is not re-renderable, and that is the whole security property.**
What the database holds is one credential row per code, carrying an Argon2id
hash with the same parameters as a password — nothing anywhere holds the
plaintext, so no later page and no administrator can print these again:

```bash
docker compose -p odudu-17a -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT type, left(secret_data->>'hash', 30) AS hash_prefix,
          secret_data->>'usedAt' AS used_at
     FROM user_credentials WHERE type = 'recovery-code' LIMIT 3;"
```

```
     type      |          hash_prefix           | used_at
---------------+--------------------------------+---------
 recovery-code | $argon2id$v=19$m=19456,t=2,p=1 |
 recovery-code | $argon2id$v=19$m=19456,t=2,p=1 |
 recovery-code | $argon2id$v=19$m=19456,t=2,p=1 |
(3 rows)
```

Reloading the page is therefore not a way to see them twice: the render is a
`POST` result, and a reload while the action is still owed issues a
_different_ ten and retires the set it just displayed: a sign-in that cannot
finish without a set is never refused one. A person who asks for a set on their
own, while one with codes left to spend was issued less than an hour ago, is
refused with a page that says how many minutes to wait, and the set they hold
stays. After the hour, or once every code is spent, a repeat issues a
_different_ ten.

The bound keeps the voluntary path cheap. Each set is ten Argon2id hashes (about
40 ms, run together), a delete and ten inserts, and the lockout does not reach
it, because that counts failures and this path needs a password that works; the
owed path is limited by the sign-in itself, which acknowledging the page ends. The
hour is counted from `subjects.recovery_codes_issued_at`, claimed by one
conditional `UPDATE` under the subject's row lock, so two requests at once
cannot both pass. A refusal costs that lock, a read and one audit insert, and no hash. Re-serving
the same set instead would cost less and be worse: a second render of a live
secret is the one thing this page must not do. The refusal itself is shown, run
live, in [Replacing the recovery codes](./sending-a-person-to-change-a-credential.md#replacing-the-recovery-codes).

The acknowledgement carries no code back — only the session id. It says the
page was read, and it is what completes the action. With nothing else owed,
it is also what finishes the login: its response is the `302` shown at the
end of [Confirming the secret](./two-factor-authentication-with-totp.md#confirming-the-secret-enrols-it-and-is-the-logins-second-factor).

## Signing in with one, in place of the second factor

A fresh attempt, and this time the authenticator is gone. The request is
parked and the password form rendered exactly as
[Path A](./path-a-authorization-code-with-pkce.md) shows, for a new
`auth_session_id`, `01a137d3-9df0-76d0-b626-fe71c6edce91`. The password step runs as always, and answers
with the code form — the same two fields, because nothing about this
submission says the authenticator is gone:

```bash
curl -sS -X POST http://localhost:3094/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d3-9df0-76d0-b626-fe71c6edce91' \
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
  <input type="hidden" name="auth_session_id" value="01a137d3-9df0-76d0-b626-fe71c6edce91">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Verify</button>
</form>
</main>
</body>
</html>
```

The second field is what gets filled:

```bash
curl -sS -i -X POST http://localhost:3094/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d3-9df0-76d0-b626-fe71c6edce91' \
  --data-urlencode 'recovery_code=TKBYN-J8QGH'
```

```
HTTP/1.1 302 Found
x-request-id: 01a137d3-9ea5-72a6-b4d1-3d451af1a220
set-cookie: otp-demo-session=01a137d3-9ee4-774c-a1f0-7b51a53740c3:j1qO2TJFYsDsCP29koTcK5BgwzgDtSYtdpuBiFsEXD4; HttpOnly; SameSite=Lax; Path=/
set-cookie: otp-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/otp-demo/; Max-Age=0
location: http://localhost:8080/callback?code=5I3UGs_lZLJ8IzO16HHeB478eel2UUMkRKTQ7rbbDQs&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Fotp-demo
content-length: 0
Date: Wed, 14 Oct 2026 00:32:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The same success a password-and-code login gets: a session cookie and a code
on the redirect. No code from the app was ever submitted, and the login was
not asked for one — the OTP step stands down for the rest of an attempt that
presented a recovery code, since somebody who reached for the list cannot
then produce a code from the authenticator they lost.

The ID token says less about this login than the two-factor one above:

```json
{
  "sub": "01a137d3-946e-727f-91c9-3c754e9981c3",
  "iss": "http://localhost:3094/tenants/otp-demo",
  "aud": "otp-spa",
  "iat": 1791937978,
  "exp": 1791938278,
  "sid": "01a137d3-9ee4-774c-a1f0-7b51a53740c3",
  "amr": ["pwd"],
  "acr": "2"
}
```

`acr` is `"2"` — two factors ran — and `amr` names only one of them.
Deliberately: RFC 8176's registry has no value that describes a pre-generated
code off a printed list, and reporting it as `otp` would mislead a relying party
that reads that value as a live generator. The reading note in [the OIDC Core
note](https://github.com/wizzywit/odudu/blob/main/docs/protocols/oidc-core.md)
has the full argument, including why an omission is recoverable where a
mislabelling is not.

## The same code again is refused _as_ a used code

A third attempt, opened the same way as the one above — a `/authorize` that
parks the request, then the password, which answers 200 with the code form:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST \
  http://localhost:3000/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a16368-3f9d-7fc3-9628-30596ef3a88e' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
200
```

Then the code that already signed somebody in — typed in lower case with a
space where the hyphen was:

```bash
curl -sS -X POST http://localhost:3195/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a16368-3f9d-7fc3-9628-30596ef3a88e' \
  --data-urlencode 'recovery_code=zqm0z 2nqqk'
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
<li id="form-error-0">You have already used that recovery code. Try another one from your list.</li>
</ul>
</div>
<form method="post" action="/tenants/otp-demo/login-actions/authenticate">
  <input type="hidden" name="auth_session_id" value="01a16368-3f9d-7fc3-9628-30596ef3a88e">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off" aria-invalid="true" aria-describedby="form-error-0" autofocus></label>
  <button type="submit">Verify</button>
</form>
</main>
</body>
</html>
```

Two things in one response. The code was typed in lower case with a space
where the hyphen was, and it was still recognised as the same code —
normalisation folds case, drops anything outside the alphabet, and maps the
confusable letters onto digits. And the refusal _says_ the code is spent,
which a wrong code does not:

```bash
curl -sS -X POST http://localhost:3195/tenants/otp-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a16368-3f9d-7fc3-9628-30596ef3a88e' \
  --data-urlencode 'recovery_code=ZZZZZ-ZZZZZ'
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
  <input type="hidden" name="auth_session_id" value="01a16368-3f9d-7fc3-9628-30596ef3a88e">
  <label>Code from your app <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code" aria-invalid="true" aria-describedby="form-error-0" autofocus></label>
  <label>Or a recovery code <input type="text" name="recovery_code" autocomplete="off"></label>
  <button type="submit">Verify</button>
</form>
</main>
</body>
</html>
```

The generic message, the one a wrong app code gets: which codes a list
holds is not something a wrong guess gets told. The distinction is safe in the other direction
because a recovery code is a _second_ factor — by the time one is presented
the attempt is already bound to a subject, so "you have used that one"
tells that subject about their own credential and nobody else anything at
all. It is also the difference between trying the next code and concluding
the whole list is worthless.

What makes the refusal possible is that the row survives its use, marked
rather than deleted:

```bash
docker compose -p odudu-17a -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT count(*) AS codes, count(secret_data->>'usedAt') AS spent
     FROM user_credentials WHERE type = 'recovery-code'
      AND tenant_id = (SELECT id FROM tenants WHERE name = 'otp-demo');"
```

```
 codes | spent
-------+-------
    10 |     1
(1 row)
```

Ten rows, one spent, nine still usable. Spending one is a single conditional
`UPDATE` — it sets `usedAt` only where no `usedAt` is set — so two
submissions racing the same code serialize on the row and exactly one of
them signs in; the other is refused, because a read-then-write pair is how
both would succeed.

## The last code, and the set that replaces it

A list that runs out is the lockout recovery codes exist to prevent, so spending
the last one owes `generate-recovery-codes` again — in the login that spent it,
not the next one. The section below runs in a tenant of its own, `rc8-demo`, on
the stack above, with `otp_required` on: ada enrolled through the same two pages
as above, acknowledged her ten, and then spent them one login at a time, each a
fresh `/authorize` and the password first. The numbers above belong to
`otp-demo` and are untouched by it.

The ninth code signs in the way every earlier one did, with one still
unspent behind it:

```bash
curl -sS -i -X POST http://localhost:3094/tenants/rc8-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d4-5cca-713b-903c-d3ce599a19c2' \
  --data-urlencode 'recovery_code=ZBA0Z-8N4XS'
```

```
HTTP/1.1 302 Found
x-request-id: 01a137d4-5d60-7709-a701-0194a352560d
set-cookie: rc8-demo-session=01a137d4-5e4e-7a32-826d-3d83b7545e54:-Z5iI7GF488P51f-1HRCTMKKXHGGsUyCG8mZF2ES0Ao; HttpOnly; SameSite=Lax; Path=/
set-cookie: rc8-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/rc8-demo/; Max-Age=0
location: http://localhost:8080/callback?code=4ClFExsSD-g_CG_ClPjfnaN3kBwgHoorQMiZiJELTvE&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Frc8-demo
content-length: 0
Date: Wed, 14 Oct 2026 00:33:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The tenth authenticates just as well, and does not redirect:

```bash
curl -sS -i -X POST http://localhost:3094/tenants/rc8-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a137d4-5f25-7dd5-b54e-f530dd226d0d' \
  --data-urlencode 'recovery_code=W7762-A4QFZ'
```

The codes themselves are elided here — the set shown above is the one this
document prints, and a test holds it to exactly one:

```
HTTP/1.1 200 OK
x-request-id: 01a137d4-5faf-7d4c-867b-86e075e0ac38
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self' http://localhost:8080; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 2107
Date: Wed, 14 Oct 2026 00:33:47 GMT
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
<p class="tenant"><bdi>rc8-demo</bdi></p>
</header>
<p>Each of these signs you in once, in place of your second factor, if you lose it. <strong>This is the only time they are shown.</strong> Print them or put them in a password manager before you continue — nobody, including an administrator, can show them to you again.</p>
<p>These replace the codes issued to this account before now, which no longer work.</p>
<ol>
  …ten of them…
</ol>
<form method="post" action="/tenants/rc8-demo/login-actions/required-action?action=generate-recovery-codes">
  <input type="hidden" name="auth_session_id" value="01a137d4-5f25-7dd5-b54e-f530dd226d0d">
  <button type="submit">I have saved these codes</button>
</form>
</main>
</body>
</html>
```

It is the same page the enrolment showed, carrying the extra line it renders
when it is replacing a set rather than issuing a first one. Acknowledging it
finishes the login, exactly as it did there:

```bash
curl -sS -i -X POST \
  'http://localhost:3094/tenants/rc8-demo/login-actions/required-action?action=generate-recovery-codes' \
  --data-urlencode 'auth_session_id=01a137d4-5f25-7dd5-b54e-f530dd226d0d'
```

```
HTTP/1.1 302 Found
x-request-id: 01a137d4-6212-702f-98e3-e260b931935c
set-cookie: rc8-demo-session=01a137d4-6228-72ef-acce-7825c414d1ce:s-AxqiUj8ccFNiWeaAltx-kfFz_ZHL4TTnKs6mn1xvk; HttpOnly; SameSite=Lax; Path=/
set-cookie: rc8-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/rc8-demo/; Max-Age=0
location: http://localhost:8080/callback?code=0X0v6AqfNZkZMfluApYongAIiQ1N0ovrRGryRx984X0&state=xyz&iss=http%3A%2F%2Flocalhost%3A3094%2Ftenants%2Frc8-demo
content-length: 0
Date: Wed, 14 Oct 2026 00:33:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

What the two responses did to the account, read after the ninth code and
again after the tenth:

```bash
docker compose -p odudu-17a -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT count(*) FILTER (WHERE secret_data->>'usedAt' IS NULL) AS unspent
     FROM user_credentials
    WHERE type = 'recovery-code'
      AND tenant_id = (SELECT id FROM tenants WHERE name = 'rc8-demo');"
```

```
 unspent
---------
       1
(1 row)
```

```
 unspent
---------
      10
(1 row)
```

After the ninth that is `1`, and the login redirected. After the tenth it is
`10` — the page had already issued the replacement set by the time the query
ran — and `user_required_actions` held `generate-recovery-codes` until the
acknowledgement cleared it.

The guard behind this counts **unspent** rows rather than rows, and that
distinction is the whole of it. Spent codes are kept so a replay can be
refused as spent, so a subject who has used all ten still holds ten: a guard
reading the row count finds them provided for and owes nothing, which is a
locked-out account with no page to show it. Keycloak re-presents its own
setup at the same moment, for the same reason.

A fresh set _before_ running out is asked for by an application, with the
`generate-recovery-codes` action ([Sending a person to change a credential](./sending-a-person-to-change-a-credential.md)),
and replaces the set only when the person confirms and the last was issued more
than an hour ago. A warning as the list gets short is not built yet, and
[the roadmap](../../../roadmap.md#next) places it.

## Where the step sits in the flow

```bash
docker compose -p odudu-17a -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT index, authenticator, requirement FROM authentication_executions e
     JOIN tenants r ON r.id = e.tenant_id WHERE r.name = 'otp-demo' ORDER BY index;"
```

```
 index | authenticator | requirement
-------+---------------+-------------
     0 | passkey       | alternative
     1 | password      | alternative
     2 | otp           | conditional
     3 | recovery-code | conditional
(4 rows)
```

Last, and conditional. It is applicable only to a submission that actually
carries a code, which is what keeps it out of the way of the OTP step it
substitutes for rather than competing with it — the same shape as the
passkey step, which is applicable only to a submission carrying an
assertion. A tenant provisioned before this step existed gets the row from
migration `0040_recovery_code_execution.sql`, appended so no tenant's
existing indexes shift.
