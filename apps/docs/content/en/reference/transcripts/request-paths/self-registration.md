---
title: 'Self-registration'
description: 'GET/POST /tenants/{tenant}/login-actions/registration is the first way a user reaches a tenant without an administrator seeding them in.'
---

# Self-registration

`GET`/`POST /tenants/{tenant}/login-actions/registration` is the first way a
user reaches a tenant without an administrator seeding them in. It answers
only when the tenant's `registration_allowed` is on — off by default, like
`verify_email` and `reset_password_allowed` — so a tenant serves nothing at
all here until an operator turns it on:

```bash
odudu seed \
  --tenant register-demo --client register-spa \
  --redirect-uri http://localhost:8080/callback
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://localhost:3199/tenants/register-demo/login-actions/registration
```

```
{"created":true,"tenant":"register-demo","tenantId":"01a1689b-f86e-7c85-94f5-3c20a4061c70","clientId":"register-spa"}
404
```

Both settings this flow needs are tenant settings, so one `seed tenant --set`
turns them on — repeatable, and applied in one statement:

```bash
odudu seed tenant --name register-demo \
  --set registration_allowed=true --set verify_email=true \
  --set reset_password_allowed=true
```

```
{"command":"tenant","created":false,"tenant":"register-demo","tenantId":"01a1689b-f86e-7c85-94f5-3c20a4061c70","settings":["registration_allowed","verify_email","reset_password_allowed"]}
```

With both on, posting the form creates nothing. It keeps the request and sends
a mail whose link creates the account, so neither the address nor the username
is settled until somebody has proved the address:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Check your email</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Check your email</h1>
<p>If this address can be registered, we sent a link to finish.</p>
</main>
</body>
</html>
```

No subject, `users` row or credential exists yet. The request is one row of
`pending_registrations`: the username, the address, the Argon2id hash of the
password made on the spot, and when it expires. A second request for the same
address, in any case, replaces the row. The mail goes out only after that row
commits, the same ordering [Address verification](./path-a-as-a-confidential-client.md#address-verification)
establishes. With `ODUDU_SMTP_HOST` unset, the link lands in the container's
log instead of an inbox, here on port `3199`, where the stack of this section
and the next ran. Its key starts `reg_`, which is how the link route knows to
look in that table:

```json
{
  "level": 30,
  "to": "ada@example.com",
  "subject": "Finish creating your register-demo account",
  "text": "Someone asked to create a ⁨register-demo⁩ account with this address. If it was you, open this link to finish:\n\nhttp://localhost:3199/tenants/register-demo/login-actions/action-token?key=reg_7tTl9TBz9EYIAfzls6RkB6E8FwJq_L9KXqGovQD6v9I\n\nIf you did not request this, you can ignore this message.\n\n--\nYou received this because this email address was used to start an account at ⁨register-demo⁩.\n© 2026 Odudu · Powered by odudu",
  "htmlBytes": 5922,
  "msg": "captured email — no SMTP host configured"
}
```

The mail says someone asked, names no username, and its link opens a page that shows the
account name and one button. When that button is pressed, one transaction takes the row, locks the
address, looks for the username and
the address among the accounts that exist then, and creates the subject, the
`users` row (with the address already verified), the password credential and the
tenant's default roles and groups, those `PUT /admin/tenants/{tenant}/roles/{id}/default`
and `PUT /admin/tenants/{tenant}/groups/{id}/default` mark, none of which may
reach an admin capability ([the admin paths](../admin-paths/index.md)).

A username holding a bidirectional control character, one that would reorder the
text around it wherever it is shown (U+202A to U+202E or U+2066 to U+2069), is
refused on its own sentence and nothing is created, the form's other fields
being as valid as they were. It is refused rather than stripped, because
stripping would let two different usernames collide. On port `3197`, posting
`ada` followed by U+202E:

```bash
curl -sS -D - -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode "username=$(printf 'ada\xe2\x80\xae')" \
  --data-urlencode 'email=grace@example.com' \
  --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1689c-36bd-735f-9bb5-141b7de323b6
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'nonce-3mMB5AkENsBkpnEpO7sOAg=='
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 4163
Date: Fri, 23 Oct 2026 11:53:50 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Create account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Create account</h1>
<p class="tenant"><bdi>register-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">That username contains a character that changes the direction of text, which is not allowed.</li>
</ul>
</div>
<form method="post" action="/tenants/register-demo/login-actions/registration">
  <label>Username <input type="text" name="username" autocomplete="username" aria-invalid="true" aria-describedby="form-error-0" autofocus></label>
  <label>Email <input type="email" name="email" autocomplete="email" value="grace@example.com"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="3mMB5AkENsBkpnEpO7sOAg==">(function () {
  var box = document.getElementById('password-rules');
  var field = document.getElementById('password');
  if (!box || !field) return;
  var rows = Array.from(box.querySelectorAll('li[data-rule]'));
  var min = Number(box.getAttribute('data-min'));
  var tests = {
    length: function (v) { return Array.from(v.normalize('NFC')).length >= min; },
    digit: function (v) { return /\d/u.test(v); },
    uppercase: function (v) { return /[A-Z]/u.test(v); },
    lowercase: function (v) { return /[a-z]/u.test(v); },
    special: function (v) { return /[^A-Za-z0-9]/u.test(v); }
  };
  var status = box.querySelector('[role=status]');
  var timer;
  function check() {
    return rows.filter(function (row) {
      var ok = tests[row.getAttribute('data-rule')](field.value);
      row.setAttribute('data-met', String(ok));
      return ok;
    }).length;
  }
  field.addEventListener('input', function () {
    var met = check();
    clearTimeout(timer);
    timer = setTimeout(function () {
      status.textContent = box.getAttribute('data-summary').replace('{met}', met).replace('{total}', rows.length);
    }, 800);
  });
  check();
  var toggle = box.querySelector('button');
  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();</script>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
  <script nonce="3mMB5AkENsBkpnEpO7sOAg==">(function () {
  var first = document.getElementById('password');
  var again = document.getElementById('password-confirm');
  var toggle = document.querySelector('#password-rules button');
  if (!first || !again || !toggle) return;
  toggle.addEventListener('click', function () { again.type = first.type; });
})();</script>
  <button type="submit">Create account</button>
</form>
</main>
</body>
</html>
```

The same refusal holds for every other door: the admin API's field error carries
the code `bidi_control_refused` ([POST /subjects](../admin-paths/post-subjects.md)),
and `odudu seed` prints one line, `error: username must not contain
bidirectional control characters (U+202A to U+202E, U+2066 to U+2069)`, and exits
with status 1, naming the field it refused. Arabic and Hebrew usernames, with or without LRM and
RLM, are accepted: `odudu seed user --username مستخدم` created the account on
the same stack.

That link's host, `localhost:3199`, comes from `ODUDU_PUBLIC_BASE_URL`
(`compose.yaml` sets it to match the port published above) — never from the
request that reached the registration endpoint. A request's `Host` header
is client-controlled, and building a mailed link from it would let an
attacker who registers someone else's address choose where that link
points, capture the key when the victim (or a spam filter, or a link
preview) follows it, and create an account they hold the password to under an
address they do not control. Posting the same form with a forged `Host` proves the header is ignored:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  -H 'Host: evil.example' \
  --data-urlencode 'username=grace' \
  --data-urlencode 'email=grace@example.com' \
  --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery'
```

```json
{
  "level": 30,
  "to": "grace@example.com",
  "subject": "Finish creating your register-demo account",
  "text": "Someone asked to create a ⁨register-demo⁩ account with this address. If it was you, open this link to finish:\n\nhttp://localhost:3199/tenants/register-demo/login-actions/action-token?key=reg_isuotp3jAbBnTNrccBXIEVLTPTez_ta6wxY9vjIKvDA\n\nIf you did not request this, you can ignore this message.\n\n--\nYou received this because this email address was used to start an account at ⁨register-demo⁩.\n© 2026 Odudu · Powered by odudu",
  "htmlBytes": 5922,
  "msg": "captured email — no SMTP host configured"
}
```

Still `localhost:3199`, never `evil.example`. When `ODUDU_PUBLIC_BASE_URL`
is unset and a tenant's `verify_email` is on, registration refuses outright
(500, logged as a misconfiguration) rather than falling back to the
request in any way.

**This is the property the whole account-lifecycle build exists for**: nobody
signs in with an address nobody has proved, and the assertion is that no code is
issued, not that a page says something. Before the link is opened there is no
account to sign in to. Requesting `/authorize` and submitting the login form with
the password just set answers the refusal any unknown account gets, 200 and not
the usual 302 (only the status line and the alert's words are kept here, with `grep` and `sed`):

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3199/tenants/register-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3199/tenants/register-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  | grep -E '^(HTTP|location|set-cookie)|Sign-in failed' | sed 's/<[^>]*>//g'
```

```
HTTP/1.1 200 OK
Sign-in failed. Check your details and try again.
```

No `location` and no `set-cookie` header are on that response — nothing was
established and nothing was issued, which is the part a passing status code
alone could not prove. The page that says "Can't sign in yet" is for an account
that exists with an address nobody has proved, which only an administrator's
`odudu seed user --email` (or the admin API) makes now. Here `bob`:

```bash
odudu seed user --tenant register-demo --username bob \
  --password correct-horse-battery --email bob@example.com
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3199/tenants/register-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3199/tenants/register-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=bob' \
  --data-urlencode 'password=correct-horse-battery' \
  | grep -E '^HTTP|<h1>|<p>We sent'
```

```
{"command":"user","tenant":"register-demo","tenantId":"01a1689b-f86e-7c85-94f5-3c20a4061c70","username":"bob","userSubjectId":"01a1689c-74b3-75af-81c6-db3c37a920e3"}
HTTP/1.1 200 OK
<h1>Can&#39;t sign in yet</h1>
<p>We sent you a link to verify your email address. Open it, then sign in again.</p>
```

Opening `ada`'s mailed link asks and does nothing else: a mail scanner or a link preview
opens a link before the person does, so the page shows one button, and the account is made
only when the button posts the key back. Opened twice, as a scanner might, the page is the
same and no account exists; the headers on it are `no-store` and `no-referrer`:

```bash
KEY=reg_7tTl9TBz9EYIAfzls6RkB6E8FwJq_L9KXqGovQD6v9I
for i in 1 2; do
  curl -sS "http://localhost:3199/tenants/register-demo/login-actions/action-token?key=$KEY" \
    | grep -E '<h1>|<p>Press|<button|name="key"' | sed 's/value="[^"]*"/value="…"/'
  echo ---
done
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select count(*) from users u join tenants t on t.id = u.tenant_id where t.name = 'register-demo' and u.username = 'ada';"
curl -sS -i "http://localhost:3199/tenants/register-demo/login-actions/action-token?key=$KEY" \
  | grep -iE '^(HTTP|cache-control|referrer-policy)'
```

```
<h1>Confirm your email address</h1>
<p>Press the button to confirm this address.</p>
  <input type="hidden" name="key" value="…">
  <button type="submit">Confirm my email</button>
---
<h1>Confirm your email address</h1>
<p>Press the button to confirm this address.</p>
  <input type="hidden" name="key" value="…">
  <button type="submit">Confirm my email</button>
---
0
HTTP/1.1 200 OK
referrer-policy: no-referrer
cache-control: no-store
```

Pressing the button posts the key, and that creates the account. A second press, like any
link nothing holds, is refused, and the tenant holds the one account:

```bash
for i in 1 2; do
  curl -sS -o /dev/null -w '%{http_code}\n' \
    -X POST http://localhost:3199/tenants/register-demo/login-actions/action-token \
    --data-urlencode "key=$KEY"
done
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select count(*) from users u join tenants t on t.id = u.tenant_id where t.name = 'register-demo' and u.username = 'ada';"
```

```
200
400
1
```

The same login now completes:

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3199/tenants/register-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3199/tenants/register-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' \
  | grep -E '^(HTTP|location|set-cookie: register-demo-session=)'
```

```
HTTP/1.1 302 Found
set-cookie: register-demo-session=01a1689c-7714-7a5f-9476-b7d2a710bdce:gGoPOZftpOLwWQfgwiR2fpiuIYyqMlqhOr0wdog72bo; HttpOnly; SameSite=Lax; Path=/
location: http://localhost:8080/callback?code=Rms1uLhiL9BBljedtwid8wz5Fy0FWeFu7gKUJY_I8bE&state=xyz123&iss=http%3A%2F%2Flocalhost%3A3199%2Ftenants%2Fregister-demo
```

(The session cookie is shortened to the start of its id; it is `<session id>:<secret>`.)

`users.email` is unique per tenant, not globally — `email` alone would be a
tenancy bug — and matched without regard to case, so `ADA@example.com` is `ada`'s
address too. What the form says about a taken address depends on `verify_email`.
With it on, the form must not tell a stranger who has registered, so a held
address is answered exactly as a free one is, and its holder is told by mail
instead. `ada` now has an account; `carol` tries her address:

```bash
curl -sS -D - \
  -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  -H 'x-request-id: register-demo-taken' \
  --data-urlencode 'username=carol' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=another-password-1' --data-urlencode 'password_confirm=another-password-1'
```

```
HTTP/1.1 201 Created
x-request-id: register-demo-taken
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 872
Date: Fri, 23 Oct 2026 11:54:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Check your email</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Check your email</h1>
<p>If this address can be registered, we sent a link to finish.</p>
</main>
</body>
</html>
```

The page is the one a free address gets: `201`, "Check your email" and a line
that does not say whether the address was free. Nothing was kept for `carol` and no account was made. To
show the two answers are the same bytes, a free address and `ada`'s are each
registered, under two usernames, and the two bodies compared:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=hedy' \
  --data-urlencode 'email=hedy@example.com' \
  --data-urlencode 'password=another-password-1' --data-urlencode 'password_confirm=another-password-1' > free.html
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=dora' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=another-password-1' --data-urlencode 'password_confirm=another-password-1' > taken.html
cmp free.html taken.html && echo identical
```

```
identical
```

A username is the one thing the form still names, because it is not a secret
and the person has to choose another. It does not give the address away, since a
registration holds no username until its link is opened: asking for the same
username twice, first with a held address and then with a free one, is answered
as it is for two free ones. `bob`, made by an administrator above, holds
`bob@example.com`:

```bash
for pair in 'probe1 bob@example.com' 'probe1 other1@example.com' \
            'probe2 free2@example.com' 'probe2 other2@example.com'; do
  set -- $pair
  curl -sS -o /dev/null -w "$1 $2: %{http_code}\n" \
    -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
    --data-urlencode "username=$1" --data-urlencode "email=$2" \
    --data-urlencode 'password=another-password-1' --data-urlencode 'password_confirm=another-password-1'
done
```

```
probe1 bob@example.com: 201
probe1 other1@example.com: 201
probe2 free2@example.com: 201
probe2 other2@example.com: 201
```

The difference is in the inbox. `ada` has a mail for each of the two attempts on her
address, `bob` one, and each free address a verification link. An attempt's mail
names no username and carries no key; its link only opens the password reset page.
Each request queued exactly one mail, whichever kind of address it named:

```bash
docker compose logs --no-log-prefix odudu | grep 'captured email' \
  | jq -s 'map(select(.subject | startswith("You already have")))[0]
           | {level, to, subject, text, htmlBytes, msg}'
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select o.to_address, o.subject
     from email_outbox o join tenants t on t.id = o.tenant_id
    where t.name = 'register-demo' order by o.created_at;"
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select p.username, p.email
     from pending_registrations p join tenants t on t.id = p.tenant_id
    where t.name = 'register-demo' order by p.username;"
```

```json
{
  "level": 30,
  "to": "ada@example.com",
  "subject": "You already have a register-demo account",
  "text": "Someone tried to create a ⁨register-demo⁩ account with this email address. You already have one.\n\nIf it was you, sign in. If you forgot your password, reset it.\n\nhttp://localhost:3199/tenants/register-demo/login-actions/reset-password\n\nIf you did not request this, you can ignore this message.\n\n--\nYou received this because this email address was used to register at ⁨register-demo⁩.\n© 2026 Odudu · Powered by odudu",
  "htmlBytes": 6039,
  "msg": "captured email — no SMTP host configured"
}
```

```
ada@example.com|Finish creating your register-demo account
grace@example.com|Finish creating your register-demo account
ada@example.com|You already have a register-demo account
hedy@example.com|Finish creating your register-demo account
ada@example.com|You already have a register-demo account
bob@example.com|You already have a register-demo account
other1@example.com|Finish creating your register-demo account
free2@example.com|Finish creating your register-demo account
other2@example.com|Finish creating your register-demo account
```

```
grace|grace@example.com
hedy|hedy@example.com
probe1|other1@example.com
probe2|free2@example.com
probe2|other2@example.com
```

`probe2` appears twice because nothing holds a username until a link is opened;
whichever link is opened first gets it, and the other is told the name is gone.
A request for an address that already has a request waiting replaces it, which is why
`grace` and `hedy` have one row each. Mail to one address is limited to three an
hour per tenant, whoever asks: past that the request is answered the same and the
mail is not queued.

With `verify_email` off nothing can be mailed, so the form cannot stay silent
and says the address is registered, however it is spelled. On a tenant with only
`registration_allowed` on, where `ada` registered first and the account exists at
once, `carol` is refused in place:

```bash
odudu seed \
  --tenant reg-open --client reg-spa \
  --redirect-uri http://localhost:8080/callback
odudu seed tenant --name reg-open --set registration_allowed=true
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3199/tenants/reg-open/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery'
curl -sS -X POST http://localhost:3199/tenants/reg-open/login-actions/registration \
  --data-urlencode 'username=carol' \
  --data-urlencode 'email=ADA@example.com' \
  --data-urlencode 'password=another-password-1' --data-urlencode 'password_confirm=another-password-1' \
  | grep -A3 'role="alert"'
```

```
{"created":true,"tenant":"reg-open","tenantId":"01a1689c-b5d2-7d92-9f30-a7a2e50f20a2","clientId":"reg-spa"}
{"command":"tenant","created":false,"tenant":"reg-open","tenantId":"01a1689c-b5d2-7d92-9f30-a7a2e50f20a2","settings":["registration_allowed"]}
201
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">That email address is already registered.</li>
</ul>
```

(400; the same address remains free to register again in a different tenant,
since the uniqueness constraint is `(tenant_id, email)`, not `email` alone.) A
duplicate **username** and a malformed address are both refused the same way —
400, with a message naming which — rather than an unhandled error.

Every tenant also carries a password policy, and registration is one of its
writers. The default policy asks for 15 characters, so a short
password is refused with every violation the candidate has, not just the
first:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=short' --data-urlencode 'password_confirm=short'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Create account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Create account</h1>
<p class="tenant"><bdi>register-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must be at least 15 characters long.</li>
</ul>
</div>
<form method="post" action="/tenants/register-demo/login-actions/registration">
  <label>Username <input type="text" name="username" autocomplete="username" value="ada"></label>
  <label>Email <input type="email" name="email" autocomplete="email" value="ada@example.com"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="yVMBBA17RK7Yct82vDbBog==">(function () {
  var box = document.getElementById('password-rules');
  var field = document.getElementById('password');
  if (!box || !field) return;
  var rows = Array.from(box.querySelectorAll('li[data-rule]'));
  var min = Number(box.getAttribute('data-min'));
  var tests = {
    length: function (v) { return Array.from(v.normalize('NFC')).length >= min; },
    digit: function (v) { return /\d/u.test(v); },
    uppercase: function (v) { return /[A-Z]/u.test(v); },
    lowercase: function (v) { return /[a-z]/u.test(v); },
    special: function (v) { return /[^A-Za-z0-9]/u.test(v); }
  };
  var status = box.querySelector('[role=status]');
  var timer;
  function check() {
    return rows.filter(function (row) {
      var ok = tests[row.getAttribute('data-rule')](field.value);
      row.setAttribute('data-met', String(ok));
      return ok;
    }).length;
  }
  field.addEventListener('input', function () {
    var met = check();
    clearTimeout(timer);
    timer = setTimeout(function () {
      status.textContent = box.getAttribute('data-summary').replace('{met}', met).replace('{total}', rows.length);
    }, 800);
  });
  check();
  var toggle = box.querySelector('button');
  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();</script>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
  <script nonce="yVMBBA17RK7Yct82vDbBog==">(function () {
  var first = document.getElementById('password');
  var again = document.getElementById('password-confirm');
  var toggle = document.querySelector('#password-rules button');
  if (!first || !again || !toggle) return;
  toggle.addEventListener('click', function () { again.type = first.type; });
})();</script>
  <button type="submit">Create account</button>
</form>
</main>
</body>
</html>
```

With `password_require_digit` and `password_require_uppercase` also turned
on for the tenant — `odudu seed tenant --name register-demo --set
password_require_digit=true --set password_require_uppercase=true` — the
same short password now lists all three:

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Create account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Create account</h1>
<p class="tenant"><bdi>register-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must be at least 15 characters long.</li>
<li id="form-error-1">Password must contain a digit.</li>
<li id="form-error-2">Password must contain an uppercase letter.</li>
</ul>
</div>
<form method="post" action="/tenants/register-demo/login-actions/registration">
  <label>Username <input type="text" name="username" autocomplete="username" value="ada"></label>
  <label>Email <input type="email" name="email" autocomplete="email" value="ada@example.com"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 form-error-1 form-error-2 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li data-rule="digit">A digit</li>
      <li data-rule="uppercase">An uppercase letter</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="A0uANVDhJVdTXsvEgfmw3Q==">(function () {
  var box = document.getElementById('password-rules');
  var field = document.getElementById('password');
  if (!box || !field) return;
  var rows = Array.from(box.querySelectorAll('li[data-rule]'));
  var min = Number(box.getAttribute('data-min'));
  var tests = {
    length: function (v) { return Array.from(v.normalize('NFC')).length >= min; },
    digit: function (v) { return /\d/u.test(v); },
    uppercase: function (v) { return /[A-Z]/u.test(v); },
    lowercase: function (v) { return /[a-z]/u.test(v); },
    special: function (v) { return /[^A-Za-z0-9]/u.test(v); }
  };
  var status = box.querySelector('[role=status]');
  var timer;
  function check() {
    return rows.filter(function (row) {
      var ok = tests[row.getAttribute('data-rule')](field.value);
      row.setAttribute('data-met', String(ok));
      return ok;
    }).length;
  }
  field.addEventListener('input', function () {
    var met = check();
    clearTimeout(timer);
    timer = setTimeout(function () {
      status.textContent = box.getAttribute('data-summary').replace('{met}', met).replace('{total}', rows.length);
    }, 800);
  });
  check();
  var toggle = box.querySelector('button');
  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();</script>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
  <script nonce="A0uANVDhJVdTXsvEgfmw3Q==">(function () {
  var first = document.getElementById('password');
  var again = document.getElementById('password-confirm');
  var toggle = document.querySelector('#password-rules button');
  if (!first || !again || !toggle) return;
  toggle.addEventListener('click', function () { again.type = first.type; });
})();</script>
  <button type="submit">Create account</button>
</form>
</main>
</body>
</html>
```

The two rules above are turned off again before the transcripts below —
`--set password_require_digit=false --set password_require_uppercase=false`
— since a policy left on adds "Password must contain a digit." to every
list that follows and obscures the rule each one is actually about.

`password_not_username` and `password_not_email` (both on by default)
refuse a password containing the account's own username, or the local part
of its email address, case-insensitively — matched independently, so a
password tripping both lists both:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=myADApassword2026' --data-urlencode 'password_confirm=myADApassword2026'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Create account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Create account</h1>
<p class="tenant"><bdi>register-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must not contain the username.</li>
<li id="form-error-1">Password must not contain the email address.</li>
</ul>
</div>
<form method="post" action="/tenants/register-demo/login-actions/registration">
  <label>Username <input type="text" name="username" autocomplete="username" value="ada"></label>
  <label>Email <input type="email" name="email" autocomplete="email" value="ada@example.com"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 form-error-1 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="QBjE8FZBZLIGB687yD1i5w==">(function () {
  var box = document.getElementById('password-rules');
  var field = document.getElementById('password');
  if (!box || !field) return;
  var rows = Array.from(box.querySelectorAll('li[data-rule]'));
  var min = Number(box.getAttribute('data-min'));
  var tests = {
    length: function (v) { return Array.from(v.normalize('NFC')).length >= min; },
    digit: function (v) { return /\d/u.test(v); },
    uppercase: function (v) { return /[A-Z]/u.test(v); },
    lowercase: function (v) { return /[a-z]/u.test(v); },
    special: function (v) { return /[^A-Za-z0-9]/u.test(v); }
  };
  var status = box.querySelector('[role=status]');
  var timer;
  function check() {
    return rows.filter(function (row) {
      var ok = tests[row.getAttribute('data-rule')](field.value);
      row.setAttribute('data-met', String(ok));
      return ok;
    }).length;
  }
  field.addEventListener('input', function () {
    var met = check();
    clearTimeout(timer);
    timer = setTimeout(function () {
      status.textContent = box.getAttribute('data-summary').replace('{met}', met).replace('{total}', rows.length);
    }, 800);
  });
  check();
  var toggle = box.querySelector('button');
  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();</script>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
  <script nonce="QBjE8FZBZLIGB687yD1i5w==">(function () {
  var first = document.getElementById('password');
  var again = document.getElementById('password-confirm');
  var toggle = document.querySelector('#password-rules button');
  if (!first || !again || !toggle) return;
  toggle.addEventListener('click', function () { again.type = first.type; });
})();</script>
  <button type="submit">Create account</button>
</form>
</main>
</body>
</html>
```

A username and an email local part that differ show each rule on its own —
here `carol`'s password contains no part of her own username, but does
contain the local part of the email address given for the account:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=carol' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=myADApassword2026' --data-urlencode 'password_confirm=myADApassword2026'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Create account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Create account</h1>
<p class="tenant"><bdi>register-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must not contain the email address.</li>
</ul>
</div>
<form method="post" action="/tenants/register-demo/login-actions/registration">
  <label>Username <input type="text" name="username" autocomplete="username" value="carol"></label>
  <label>Email <input type="email" name="email" autocomplete="email" value="ada@example.com"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="ggMQVdelEZquKdScQc3ZFQ==">(function () {
  var box = document.getElementById('password-rules');
  var field = document.getElementById('password');
  if (!box || !field) return;
  var rows = Array.from(box.querySelectorAll('li[data-rule]'));
  var min = Number(box.getAttribute('data-min'));
  var tests = {
    length: function (v) { return Array.from(v.normalize('NFC')).length >= min; },
    digit: function (v) { return /\d/u.test(v); },
    uppercase: function (v) { return /[A-Z]/u.test(v); },
    lowercase: function (v) { return /[a-z]/u.test(v); },
    special: function (v) { return /[^A-Za-z0-9]/u.test(v); }
  };
  var status = box.querySelector('[role=status]');
  var timer;
  function check() {
    return rows.filter(function (row) {
      var ok = tests[row.getAttribute('data-rule')](field.value);
      row.setAttribute('data-met', String(ok));
      return ok;
    }).length;
  }
  field.addEventListener('input', function () {
    var met = check();
    clearTimeout(timer);
    timer = setTimeout(function () {
      status.textContent = box.getAttribute('data-summary').replace('{met}', met).replace('{total}', rows.length);
    }, 800);
  });
  check();
  var toggle = box.querySelector('button');
  toggle.hidden = false;
  toggle.addEventListener('click', function () {
    var show = field.type === 'password';
    field.type = show ? 'text' : 'password';
    toggle.setAttribute('aria-pressed', String(show));
  });
})();</script>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
  <script nonce="ggMQVdelEZquKdScQc3ZFQ==">(function () {
  var first = document.getElementById('password');
  var again = document.getElementById('password-confirm');
  var toggle = document.querySelector('#password-rules button');
  if (!first || !again || !toggle) return;
  toggle.addEventListener('click', function () { again.type = first.type; });
})();</script>
  <button type="submit">Create account</button>
</form>
</main>
</body>
</html>
```

400 in every case above; no subject, user row or credential is created.

A tenant with `verify_email` off skips the mail and the gate above entirely:
the account created is usable at the next login, the same way a
seeded user always has been.

## The way there and back

The sign-in page offers the two pages a tenant serves, each only while its
setting is on: **Create an account** when `registration_allowed` is on and
**Forgot password?** when `reset_password_allowed` is. A tenant with neither
shows no link. Each link carries the request being signed in to, as a
`return_to` parameter holding that request's own `/authorize` path, so the page
it leads to can bring the person back to the same request. Never the
authentication session's id: that is the sign-in form's anti-forgery value and is
not put in an address. This run is on `http://localhost:3195`, with
`reset_password_allowed` turned on for `register-demo` as well:

```bash
curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3195/tenants/register-demo/protocol/openid-connect/auth' \
  | grep -A3 'class="links"'
```

```
<p class="links">
<a href="/tenants/register-demo/login-actions/reset-password?return_to=%2Ftenants%2Fregister-demo%2Fprotocol%2Fopenid-connect%2Fauth%3Fresponse_type%3Dcode%26client_id%3Dregister-spa%26redirect_uri%3Dhttp%253A%252F%252Flocalhost%253A8080%252Fcallback%26scope%3Dopenid%2Bemail%26code_challenge%3DE9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM%26code_challenge_method%3DS256%26state%3Dxyz123">Forgot password?</a>
<a href="/tenants/register-demo/login-actions/registration?return_to=%2Ftenants%2Fregister-demo%2Fprotocol%2Fopenid-connect%2Fauth%3Fresponse_type%3Dcode%26client_id%3Dregister-spa%26redirect_uri%3Dhttp%253A%252F%252Flocalhost%253A8080%252Fcallback%26scope%3Dopenid%2Bemail%26code_challenge%3DE9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM%26code_challenge_method%3DS256%26state%3Dxyz123">Create an account</a>
</p>
```

The registration page takes `return_to` only in that exact shape: this tenant's
own authorize path with a query. Anything else (another tenant, an absolute
address, a fragment, a control character) is dropped, and the page then shows no
way back. It links back with it, and keeps it in the form:

```bash
curl -sS 'http://localhost:3195/tenants/register-demo/login-actions/registration?return_to=%2Ftenants%2Fregister-demo%2Fprotocol%2Fopenid-connect%2Fauth%3Fresponse_type%3Dcode%26client_id%3Dregister-spa%26state%3Dxyz123' \
  | grep -E 'return_to|Back to sign in'
```

```
  <input type="hidden" name="return_to" value="/tenants/register-demo/protocol/openid-connect/auth?response_type=code&amp;client_id=register-spa&amp;state=xyz123">
<a href="/tenants/register-demo/protocol/openid-connect/auth?response_type=code&amp;client_id=register-spa&amp;state=xyz123">Back to sign in</a>
```

A refused submission comes back as the registration form itself, status `400`,
with the problem in one alert above it, the field it is about marked
(`aria-invalid`, `aria-describedby`) and focused (`autofocus`), the username and
email kept, the password never given back, and the way back still there:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/registration \
  --data-urlencode 'username=newcomer' \
  --data-urlencode 'email=newcomer@example.com' \
  --data-urlencode 'password=short' --data-urlencode 'password_confirm=short' \
  --data-urlencode 'return_to=/tenants/register-demo/protocol/openid-connect/auth?response_type=code&client_id=register-spa&state=xyz123' \
  | grep -E 'role="alert"|<li |<input|Back to sign in'
```

```
<div class="alert" role="alert" id="form-error">
<li id="form-error-0">Password must be at least 15 characters long.</li>
  <input type="hidden" name="return_to" value="/tenants/register-demo/protocol/openid-connect/auth?response_type=code&amp;client_id=register-spa&amp;state=xyz123">
  <label>Username <input type="text" name="username" autocomplete="username" value="newcomer"></label>
  <label>Email <input type="email" name="email" autocomplete="email" value="newcomer@example.com"></label>
  <label>Password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 password-rules-list" autofocus></label>
      <li data-rule="length">At least 15 characters</li>
  <label>Confirm password <input type="password" name="password_confirm" id="password-confirm" autocomplete="new-password" spellcheck="false" autocapitalize="off" autocorrect="off"></label>
<a href="/tenants/register-demo/protocol/openid-connect/auth?response_type=code&amp;client_id=register-spa&amp;state=xyz123">Back to sign in</a>
```

The pattern keeps only the lines that matter. A visit with no `return_to` shows
no `Back to sign in`, because there is then no request to go back to.

The mail a registration (or a reset request) queues carries nothing of the request. Its
link holds its key and no more: a mailbox, a relay's log and a mail client's history should
not keep the application's `state`, `nonce` or `claims`, and a link that restarted the request
without them would be refused by any application that checks its own, the console among them.
What brings the person back is the browser. The sign-in page sets a cookie naming the
request it parks, and the pending registration (or the token a reset made) records which
sign-in it came out of. This run is on `http://localhost:3199`, on the stack of the earlier
sections, where `register-demo` has `reset_password_allowed` on. The sign-in page, with a cookie jar:

```bash
curl -sS -c jar.txt -D headers.txt -o page.html --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  'http://localhost:3199/tenants/register-demo/protocol/openid-connect/auth'
grep -iE '^(HTTP|set-cookie)' headers.txt
grep -o 'name="auth_session_id" value="[^"]*"' page.html | head -1
```

```
HTTP/1.1 200 OK
set-cookie: odudu-sign-in=01a1689c-bc19-7a4e-a51a-af74d0516675.jZFDopOF34YULiszz0phagmTcK5Ld0pgtqvsCczlOQU; HttpOnly; SameSite=Lax; Path=/tenants/register-demo/; Max-Age=1800
name="auth_session_id" value="01a1689c-bc19-7a4e-a51a-af74d0516675"
```

The cookie is `<the parked session>.<a secret>`, `HttpOnly`, `SameSite=Lax`, scoped to the
tenant and as short-lived as the request (`login_ttl_seconds`). It signs nobody in and is
not read by the login form. Registering three accounts from that page, as the browser that
holds it, with the `return_to` the page's **Create an account** link carries, then reading
the links out of the queued mail:

```bash
RT='/tenants/register-demo/protocol/openid-connect/auth?response_type=code&client_id=register-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz123&nonce=abc123'
for u in mailed elsewhere lapsed; do
  curl -sS -o /dev/null -w "$u: %{http_code}\n" -b jar.txt -X POST \
    http://localhost:3199/tenants/register-demo/login-actions/registration \
    --data-urlencode "username=$u" --data-urlencode "email=$u@example.com" \
    --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery' --data-urlencode "return_to=$RT"
done
```

```
mailed: 201
elsewhere: 201
lapsed: 201
```

```bash
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select o.to_address, substring(o.body_text from 'https?://[^ \n]*action-token[^ \n]*')
     from email_outbox o join tenants t on t.id = o.tenant_id
    where t.name = 'register-demo' and o.to_address like any (array['mailed@%','elsewhere@%'])
    order by o.to_address;"
```

```
elsewhere@example.com|http://localhost:3199/tenants/register-demo/login-actions/action-token?key=reg_3Ybxc1CjMSEa_Ckq7rzNlZr8GaEcRzCy85t1vIm8qZo
mailed@example.com|http://localhost:3199/tenants/register-demo/login-actions/action-token?key=reg_2LVZdqpmn8dCMsP1ZXoQ_tm8geRrNCz0_5xKSkLyMqg
```

The links hold a key and nothing else. What the pending registrations hold, beside the
cookie's session above:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select p.username, p.authentication_session_id
     from pending_registrations p join tenants t on t.id = p.tenant_id
    where t.name = 'register-demo' and p.username in ('mailed','elsewhere')
    order by p.username;"
```

```
elsewhere|01a1689c-bc19-7a4e-a51a-af74d0516675
mailed|01a1689c-bc19-7a4e-a51a-af74d0516675
```

Pressing the button in a browser that holds no such cookie (here, `curl` with no jar), the page makes the
account and says it is ready, since a registration link works anywhere, and offers no way to sign in:

```bash
curl -sS -X POST http://localhost:3199/tenants/register-demo/login-actions/action-token \
  --data-urlencode 'key=reg_3Ybxc1CjMSEa_Ckq7rzNlZr8GaEcRzCy85t1vIm8qZo' \
  | grep -E '<h1>|<p>|<a '
```

```
<h1>Your account is ready</h1>
<p>Return to the application you were signing in to and sign in.</p>
```

Pressed in the browser that holds the sign-in, the same page links to the original request,
with its own `state` and `nonce`:

```bash
curl -sS -X POST -b jar.txt http://localhost:3199/tenants/register-demo/login-actions/action-token \
  --data-urlencode 'key=reg_2LVZdqpmn8dCMsP1ZXoQ_tm8geRrNCz0_5xKSkLyMqg' \
  | grep -E '<h1>|<p>|<a '
```

```
<h1>Your account is ready</h1>
<a href="/tenants/register-demo/protocol/openid-connect/auth?response_type=code&amp;client_id=register-spa&amp;redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&amp;scope=openid&amp;code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&amp;code_challenge_method=S256&amp;state=xyz123&amp;nonce=abc123">Continue to sign in</a>
```

The `&amp;` is the markup's escaping of `&`; the address is the request that was parked,
which `/authorize` validates again from scratch. Once the parked request has lapsed the
cookie names nothing, so the third link gets the text and no link, in the very browser that
started it. The session is ended with `update authentication_sessions set expires_at = now() -
interval '1 second'` for the id above, which is what `login_ttl_seconds` does without help:

```bash
curl -sS -X POST -b jar.txt http://localhost:3199/tenants/register-demo/login-actions/action-token \
  --data-urlencode 'key=reg_MsUAxfo7p-UvYV9INp3HfnhHw32hCkW_JS56lclmJx0' \
  | grep -E '<h1>|<p>|<a '
```

```
<h1>Your account is ready</h1>
<p>Return to the application you were signing in to and sign in.</p>
```

A link is gone once its button has been pressed, so opening one again reads like any link nothing holds
and names no sign-in. A mailed link given a `return_to` is not shown one: the page ignores whatever the address
asks for. An administrator's link (`/subjects/:id/actions-email`) is issued with no request
behind it and names no sign-in, so it offers none.

## Starting at the registration page

An application with a **Sign up** button sends the same request as for a sign-in with
`prompt=create` added (Initiating User Registration via OpenID Connect 1.0). `/authorize`
parks the request as it would for a sign-in and answers `303` to the registration page,
with the same `return_to` the **Create an account** link carries, and the same sign-in
cookie, so a mailed link can bring the person back. This run is on `http://localhost:3331`,
a fresh stack with `register-demo` seeded as above and `registration_allowed` on:

```bash
curl -sS -D - -o /dev/null --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=create' \
  'http://localhost:3331/tenants/register-demo/protocol/openid-connect/auth' \
  | grep -iE '^(HTTP|location|set-cookie)'
```

```
HTTP/1.1 303 See Other
set-cookie: odudu-sign-in=01a16990-78a9-7085-a2a8-bbaf1ec6130e.jonCj76UnfEjGF1KyFgF68szQhRj4emANpMttPGP6wI; HttpOnly; SameSite=Lax; Path=/tenants/register-demo/; Max-Age=1800
location: /tenants/register-demo/login-actions/registration?return_to=%2Ftenants%2Fregister-demo%2Fprotocol%2Fopenid-connect%2Fauth%3Fresponse_type%3Dcode%26client_id%3Dregister-spa%26redirect_uri%3Dhttp%253A%252F%252Flocalhost%253A8080%252Fcallback%26scope%3Dopenid%2Bemail%26code_challenge%3DE9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM%26code_challenge_method%3DS256%26state%3Dxyz123%26nonce%3Dabc123%26prompt%3Dlogin
```

The `return_to` is this request with `prompt=login` in place of `create`. After registering,
the person signs in with the new account rather than a session the browser already held. The
page it leads to is the one shown above, with the same
**Back to sign in** link. `create` goes alone; beside another value it is refused, as `none`
is, and a tenant with `registration_allowed` off refuses the value as one it does not
support. Both are reported at the application's own `redirect_uri`, with its `state`. The
second request goes to `closed-demo`, a tenant seeded with the same client and registration
left off:

```bash
odudu seed --tenant closed-demo --client register-spa \
  --redirect-uri http://localhost:8080/callback
curl -sS -o /dev/null -w '%{redirect_url}\n' --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=create login' \
  'http://localhost:3331/tenants/register-demo/protocol/openid-connect/auth'
curl -sS -o /dev/null -w '%{redirect_url}\n' --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=register-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'prompt=create' \
  'http://localhost:3331/tenants/closed-demo/protocol/openid-connect/auth'
```

```
{"created":true,"tenant":"closed-demo","tenantId":"01a16990-1f35-7695-8587-b0d1b494f402","clientId":"register-spa"}
http://localhost:8080/callback?error=invalid_request&error_description=prompt+is+not+valid&state=xyz123&iss=http%3A%2F%2Flocalhost%3A3331%2Ftenants%2Fregister-demo
http://localhost:8080/callback?error=invalid_request&error_description=prompt%3Dcreate+is+not+supported%3A+registration+is+off&state=xyz123&iss=http%3A%2F%2Flocalhost%3A3331%2Ftenants%2Fclosed-demo
```

The discovery document says which it will be, before any request is sent:

```bash
for t in register-demo closed-demo; do
  curl -sS "http://localhost:3331/tenants/$t/.well-known/openid-configuration" \
    | grep -o '"prompt_values_supported":\[[^]]*\]'
done
```

```
"prompt_values_supported":["none","login","consent","select_account","create"]
"prompt_values_supported":["none","login","consent","select_account"]
```

## What registration and verification leave in the audit log

Asking to register writes no audit row for a free address: nothing exists yet. An
account made by its link writes one `credential` row, `account.registered`, in the
transaction that creates it. A held address, with `verify_email` on, writes one row of
its own, `account.registration_duplicate`, `refused`: it names the account the attempt
ran into and nothing the caller typed. A spent link names nobody the caller has proved
anything about, and writes none. (`email.verified` is what an administrator's
verification link writes.) This ran on the same stack, against its own
tenant, `signup-audit`, created by the two seed commands below, so the accounts
and the mailed link are the only ones in play. Every request carries an
`x-request-id` starting `signup-audit-`, and the query below reads back
exactly those.

`ada` asks to register, the mailed link is opened and its button pressed, and then `carol`
asks for `ada`'s address. It is answered `201`, as a free address is. The key is read out of
the verification mail, the only one this tenant has queued:

```bash
odudu seed --tenant signup-audit --client signup-audit-spa \
  --redirect-uri http://localhost:8080/callback
odudu seed tenant --name signup-audit \
  --set registration_allowed=true --set verify_email=true \
  --set reset_password_allowed=true

curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3199/tenants/signup-audit/login-actions/registration \
  -H 'x-request-id: signup-audit-ada' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery'
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select substring(o.body_text from 'key=([A-Za-z0-9_-]+)')
     from email_outbox o join tenants t on t.id = o.tenant_id
    where t.name = 'signup-audit' and o.subject like 'Finish%';"
```

```
{"created":true,"tenant":"signup-audit","tenantId":"01a1689c-fbcc-7ac0-9a72-26369f12fc28","clientId":"signup-audit-spa"}
{"command":"tenant","created":false,"tenant":"signup-audit","tenantId":"01a1689c-fbcc-7ac0-9a72-26369f12fc28","settings":["registration_allowed","verify_email","reset_password_allowed"]}
201
reg__xSiPqrN7ZtAbYUiTdvTzGx-tDmcjrLa2H3I4MgyAA8
```

```bash
KEY=reg__xSiPqrN7ZtAbYUiTdvTzGx-tDmcjrLa2H3I4MgyAA8
curl -sS -o /dev/null -w '%{http_code}\n' -H 'x-request-id: signup-audit-visit' \
  "http://localhost:3199/tenants/signup-audit/login-actions/action-token?key=$KEY"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3199/tenants/signup-audit/login-actions/action-token \
  -H 'x-request-id: signup-audit-verify' --data-urlencode "key=$KEY"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3199/tenants/signup-audit/login-actions/registration \
  -H 'x-request-id: signup-audit-duplicate' \
  --data-urlencode 'username=carol' \
  --data-urlencode 'email=ada@example.com' \
  --data-urlencode 'password=correct-horse-battery' --data-urlencode 'password_confirm=correct-horse-battery'
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3199/tenants/signup-audit/login-actions/action-token \
  -H 'x-request-id: signup-audit-replay' --data-urlencode "key=$KEY"

docker compose exec -T postgres psql -U odudu -d odudu -x -P 'null=(null)' -c \
  "select e.request_id, e.event_type, e.action, e.outcome, e.actor_subject_id,
          e.resource_type, e.resource_id, e.detail
     from audit_events e
    where e.request_id like 'signup-audit-%'
    order by e.occurred_at;"
```

```
200
200
201
400
-[ RECORD 1 ]----+-------------------------------------
request_id       | signup-audit-verify
event_type       | credential
action           | account.registered
outcome          | allowed
actor_subject_id | 01a1689d-0341-7c52-9945-8ef8d6be4ff0
resource_type    | subject
resource_id      | 01a1689d-0341-7c52-9945-8ef8d6be4ff0
detail           | {}
-[ RECORD 2 ]----+-------------------------------------
request_id       | signup-audit-duplicate
event_type       | credential
action           | account.registration_duplicate
outcome          | refused
actor_subject_id | (null)
resource_type    | subject
resource_id      | 01a1689d-0341-7c52-9945-8ef8d6be4ff0
detail           | {"reason": "already_registered"}
```

Five requests, two rows: one for the account the button made and one for the attempt on its
address, and none for the registration itself, the visit, or the replayed press.
`01a1685b-76ca-…` is the `users.subject_id` this stack holds for `ada` in `signup-audit`, and
the refused row's `resource_id`; its `actor_subject_id` is empty, because the caller proved
nothing. `detail` holds no password, address, username or key: the action names what happened,
and the only value is the reason.
