---
title: 'Password reset'
description: 'GET/POST /tenants/{tenant}/login-actions/reset-password is the third account-lifecycle setting, reset_password_allowed — off by default, like…'
---

# Password reset

`GET`/`POST /tenants/{tenant}/login-actions/reset-password` is the third
account-lifecycle setting, `reset_password_allowed` — off by default, like
`registration_allowed` and `verify_email` — so a tenant serves nothing here
until an operator turns it on:

```bash
odudu seed \
  --tenant reset-off-demo --client reset-off-spa \
  --redirect-uri http://localhost:8080/callback
curl -sS -o /dev/null -w '%{http_code}\n' \
  http://localhost:3000/tenants/reset-off-demo/login-actions/reset-password
```

```
404
```

A separate tenant has it on, and a user seeded to reset:

```bash
odudu seed \
  --tenant reset-demo --client reset-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
```

The third account-lifecycle setting, turned on the same way as the other two:

```bash
odudu seed tenant --name reset-demo --set reset_password_allowed=true
```

```
{"command":"tenant","created":false,"tenant":"reset-demo","tenantId":"01a1d09c-629c-7e99-9850-cd23801dee58","settings":["reset_password_allowed"]}
```

The token a request mints is valid for the tenant's
`reset_password_ttl_seconds` (five minutes by default
— Keycloak's own default for a password-reset action token, chosen because
the window it opens is an account-takeover window). Run the rest of this
section within that window, or the link expires and every `curl` past that
point answers `400` for a different reason than the ones named here.

**This is the property the whole flow exists for**: the response to a
request naming an address that has an account and one naming an address
that does not must be indistinguishable — same status, same body — while
mail goes out only for the one that exists. Requesting both proves it:

```bash
curl -sS -X POST http://localhost:3000/tenants/reset-demo/login-actions/reset-password \
  --data-urlencode 'email=ada@example.com'
echo
curl -sS -X POST http://localhost:3000/tenants/reset-demo/login-actions/reset-password \
  --data-urlencode 'email=nobody@example.com'
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
<p>If that address has an account, we&#39;ve sent a link to reset its password.</p>
</main>
</body>
</html>
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
<p>If that address has an account, we&#39;ve sent a link to reset its password.</p>
</main>
</body>
</html>
```

Identical, character for character — and in the same time, which is the
half of this property that the response body cannot carry. Neither request
waits for a mail server: the one that matched an address queued its message
in the transaction that minted the token and answered, so the difference
between the two paths is one `INSERT`, not an SMTP round trip
([Sending queued mail](./sending-queued-mail-odudu-send-mail.md)). Only the
first produced mail at all, and `ODUDU_SMTP_HOST` is unset, so the
container's log carries it instead of an inbox — logged by the mail pass a
moment after both answers had gone out, and there exactly once:

```json
{
  "level": 30,
  "to": "ada@example.com",
  "subject": "Reset your reset-demo password",
  "text": "Reset your password for ⁨reset-demo⁩ by visiting this link:\n\nhttp://localhost:3000/tenants/reset-demo/login-actions/action-token?key=b1opXzSvCaOP4zK1GNSRvd07yNnqeDB6n1T3cmYw5Kc\n\nIf you did not request this, you can ignore this message.\n\n--\nYou received this because a password reset was requested for this email address at ⁨reset-demo⁩.\n© 2026 Odudu · Powered by odudu",
  "htmlBytes": 5836,
  "msg": "captured email — no SMTP host configured"
}
```

(Reduced to the fields that matter, the same way [Address
verification](./path-a-as-a-confidential-client.md#address-verification) reduces
its own capture, with `htmlBytes` for the markup; the key is shortened nowhere
in this section because a reader needs the whole thing to follow the link. It is
from a second run, so its key is that run's.) The link's host is
`ODUDU_PUBLIC_BASE_URL`, never the request's `Host` header — the same rule and
the same reasoning [Self-registration](./self-registration.md) establishes for
the verification link, and unset it refuses the request the same way: 500,
logged as a misconfiguration, for every address alike, so a missing
configuration never becomes a way to tell addresses apart either.

`GET`ting the link does not reset anything by itself — a reset-password
token needs a password to consume it with, unlike a verify-email link, so
the same `/login-actions/action-token` endpoint answers with a form instead
of completing an action:

```bash
curl -sS 'http://localhost:3000/tenants/reset-demo/login-actions/action-token?key=Z-v9554vUQeunNLqsn4pWv5ReqqPoJ-9atob1oNKaWE'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Choose a new password</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Choose a new password</h1>
<p class="tenant"><bdi>reset-demo</bdi></p>
</header>
<form method="post" action="/tenants/reset-demo/login-actions/action-token">
  <input type="hidden" name="key" value="Z-v9554vUQeunNLqsn4pWv5ReqqPoJ-9atob1oNKaWE">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="H9a9ieOSxJnRWnWRh+/oAQ==">(function () {
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
  <button type="submit">Reset password</button>
</form>
</main>
</body>
</html>
```

The same tenant password policy that binds registration binds this
submission too. A password that fails it is refused, and the link is left
alone rather than spent — it is still the same unconsumed token, so trying
again with a compliant password on the very same link works:

```bash
curl -sS -X POST http://localhost:3000/tenants/reset-demo/login-actions/action-token \
  --data-urlencode 'key=Z-v9554vUQeunNLqsn4pWv5ReqqPoJ-9atob1oNKaWE' \
  --data-urlencode 'password=weak'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Choose a new password</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Choose a new password</h1>
<p class="tenant"><bdi>reset-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must be at least 15 characters long.</li>
</ul>
</div>
<form method="post" action="/tenants/reset-demo/login-actions/action-token">
  <input type="hidden" name="key" value="Z-v9554vUQeunNLqsn4pWv5ReqqPoJ-9atob1oNKaWE">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="TYhSEVBdEvn+mg5k5kXSZw==">(function () {
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
  <button type="submit">Reset password</button>
</form>
</main>
</body>
</html>
```

A candidate that satisfies every rule above and is **the password already
in force** is refused too, by the one rule no candidate decides on its own.
Every writer of a password resets the tenant's `password_max_age_days` clock
on it — which is what stops an expired password being owed forever — so
without this, anybody who can read the account's mail could clear an
expiry without ever changing a password.

This one check ran against a second tenant, `reset2-demo`, because the link
above had already been spent by the time it was added; everything else about
the flow is identical.

```bash
curl -sS -i -X POST http://localhost:3195/tenants/reset2-demo/login-actions/action-token \
  --data-urlencode 'key=QWKz96N_0Cc7rb2J9S1BPGL8AQlPf1vu-NTLfkga41E' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a16366-5ccb-7c02-b039-bdd53561506d
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'nonce-4/8GQQZJ4XtVs1IIhUGodg=='
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3450
Date: Thu, 22 Oct 2026 11:36:55 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Choose a new password</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Choose a new password</h1>
<p class="tenant"><bdi>reset2-demo</bdi></p>
</header>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must not be one you have used before.</li>
</ul>
</div>
<form method="post" action="/tenants/reset2-demo/login-actions/action-token">
  <input type="hidden" name="key" value="QWKz96N_0Cc7rb2J9S1BPGL8AQlPf1vu-NTLfkga41E">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-invalid="true" aria-describedby="form-error-0 password-rules-list" autofocus></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="4/8GQQZJ4XtVs1IIhUGodg==">(function () {
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
  <button type="submit">Reset password</button>
</form>
</main>
</body>
</html>
```

This is **only** the password in force, not the tenant's
`password_history_depth`: reset redemption keeps no history and reads none,
so a password retired more than one change ago can be restored through a
reset and its age starts again. [Password expiry, and changing a
password](./password-expiry-and-changing-a-password.md) is where history is
read and written.

Submitting a compliant password on the `reset-demo` link above sets it:

```bash
curl -sS -X POST http://localhost:3000/tenants/reset-demo/login-actions/action-token \
  --data-urlencode 'key=Z-v9554vUQeunNLqsn4pWv5ReqqPoJ-9atob1oNKaWE' \
  --data-urlencode 'password=a brand new password'
```

```
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Password reset</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Your password has been reset</h1>
<p>Return to the application you were signing in to and sign in with your new password.</p>
</main>
</body>
</html>
```

The old password no longer authenticates — `/login-actions/authenticate`
answers 200, the login form again, not the 302 a successful attempt gets:

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=reset-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/tenants/reset-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3000/tenants/reset-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 200 OK
content-type: text/html
```

The new one does, with a fresh authorization session (the one above is
spent, the same way every login attempt consumes its `auth_session_id`):

```bash
AUTH_SESSION_ID=$(curl -sS --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=reset-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid email' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  'http://localhost:3000/tenants/reset-demo/protocol/openid-connect/auth' \
  | sed -n '/name="auth_session_id"/{s/.*value="\([^"]*\)".*/\1/p;q;}')

curl -sS -i -X POST http://localhost:3000/tenants/reset-demo/login-actions/authenticate \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=a brand new password'
```

```
HTTP/1.1 302 Found
set-cookie: reset-demo-session=01a1d09c-6731-…:-YupE_beLNoI…; HttpOnly; SameSite=Lax; Path=/
set-cookie: reset-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: reset-demo-device=Ifaw679Sisxq0ODAGdO3AA; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/reset-demo/; Max-Age=0
location: http://localhost:8080/callback?code=9AhrvZyTNiy1…&state=xyz123&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Freset-demo
```

(Session entry and code truncated.)

The same link a second time is refused — minted for one redemption, the
same as a verify-email token, and `action_tokens.consumed_at` is now set:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/tenants/reset-demo/login-actions/action-token \
  --data-urlencode 'key=Z-v9554vUQeunNLqsn4pWv5ReqqPoJ-9atob1oNKaWE' \
  --data-urlencode 'password=another password'
```

```
400
```

A completed reset also retires every other outstanding link that can set the
same subject's password — reset links, and [required-actions links](./following-a-required-actions-link.md)
naming `update-password` — not only the one just spent — a second mailed link
from an earlier request the user forgot about, or one an attacker
triggered, dies the moment the legitimate one is redeemed rather than
staying valid for its own five minutes. And turning `reset_password_allowed`
off closes redemption as well as the request form: an outstanding link
minted while it was on answers `400` from `/login-actions/action-token`
once it is off, the kill switch an operator reaches for during an incident
covering both halves of the flow.

## Coming back to the application

A person who asked for the reset from an application's sign-in page wants to finish
that sign-in. The mail cannot carry the request (it would put the application's `state`
and `nonce` in a mailbox, and a link that restarted it without them is refused by any
application that checks its own), so the link holds its key alone. The browser that started
the sign-in holds a cookie naming it
([the cookie](./path-a-authorization-code-with-pkce.md#2-authorize)), and the page the
link opens offers _Continue to sign in_, the original request, only to that browser. This
ran on `http://localhost:3197`, on a stack where tenant `back-demo` was created by the two
commands below and driven only as far as this section:

```bash
odudu seed --tenant back-demo --client back-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed tenant --name back-demo --set reset_password_allowed=true
```

```
{"created":true,"tenant":"back-demo","tenantId":"01a1647c-7cff-715e-aad3-d2a3ccc0fe7b","clientId":"back-spa","userSubjectId":"01a1647c-7d77-7059-b0e3-44f7554c44f2"}
{"command":"tenant","created":false,"tenant":"back-demo","tenantId":"01a1647c-7cff-715e-aad3-d2a3ccc0fe7b","settings":["reset_password_allowed"]}
```

The application's sign-in page, fetched with a cookie jar as a browser would, and the
**Forgot password?** link it carries:

```bash
curl -sS -c jar.txt -o page.html --get \
  --data-urlencode 'response_type=code' \
  --data-urlencode 'client_id=back-spa' \
  --data-urlencode 'redirect_uri=http://localhost:8080/callback' \
  --data-urlencode 'scope=openid' \
  --data-urlencode 'code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' \
  --data-urlencode 'code_challenge_method=S256' \
  --data-urlencode 'state=xyz123' \
  --data-urlencode 'nonce=abc123' \
  'http://localhost:3197/tenants/back-demo/protocol/openid-connect/auth'
grep -o '<a href="[^"]*">Forgot password?' page.html | sed 's/&amp;/\&/g'
```

```
<a href="/tenants/back-demo/login-actions/reset-password?return_to=%2Ftenants%2Fback-demo%2Fprotocol%2Fopenid-connect%2Fauth%3Fresponse_type%3Dcode%26client_id%3Dback-spa%26redirect_uri%3Dhttp%253A%252F%252Flocalhost%253A8080%252Fcallback%26scope%3Dopenid%26code_challenge%3DE9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM%26code_challenge_method%3DS256%26state%3Dxyz123%26nonce%3Dabc123">Forgot password?
```

Asking for the reset twice from that page, as the browser holding the cookie, with the
`return_to` the link carries. The two mails are read out of the outbox, oldest first:

```bash
RT='/tenants/back-demo/protocol/openid-connect/auth?response_type=code&client_id=back-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz123&nonce=abc123'
for n in 1 2; do
  curl -sS -b jar.txt -X POST http://localhost:3197/tenants/back-demo/login-actions/reset-password \
    --data-urlencode 'email=ada@example.com' --data-urlencode "return_to=$RT" | grep '<h1>'
done
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select substring(o.body_text from 'key=([A-Za-z0-9_-]+)')
     from email_outbox o join tenants t on t.id = o.tenant_id
    where t.name = 'back-demo' and o.to_address = 'ada@example.com'
    order by o.created_at;"
```

```
<h1>Check your email</h1>
<h1>Check your email</h1>
xMPZVd2_axdhNF-8aKePS8BP9S0fMQDWxXbrjRt9vyY
kwdfQzuMq4BHKlkVK0FyOqanSoMDi0GUuCJWfMNrDmk
```

The first link, opened in a browser with no cookie (`curl` with no jar): the form is the
same, holds only its key, and after the new password the page says what to do and links
nowhere:

```bash
curl -sS 'http://localhost:3197/tenants/back-demo/login-actions/action-token?key=xMPZVd2_axdhNF-8aKePS8BP9S0fMQDWxXbrjRt9vyY' \
  | grep -E '<h1>|name="key"|return_to'
curl -sS -X POST http://localhost:3197/tenants/back-demo/login-actions/action-token \
  --data-urlencode 'key=xMPZVd2_axdhNF-8aKePS8BP9S0fMQDWxXbrjRt9vyY' \
  --data-urlencode 'password=a new passphrase, elsewhere' | grep -E '<h1>|<p>|<a '
```

```
<h1>Choose a new password</h1>
  <input type="hidden" name="key" value="xMPZVd2_axdhNF-8aKePS8BP9S0fMQDWxXbrjRt9vyY">
<h1>Your password has been reset</h1>
<p>Return to the application you were signing in to and sign in with your new password.</p>
```

Setting the password retired the second link, as it retires every link that could set it,
so the person asks again, from the same page and the same browser, and opens that link
with the cookie. The reply sets no cookie of its own (the count of `set-cookie` headers is
the last line): a reset logs nobody in.

```bash
curl -sS -b jar.txt -X POST http://localhost:3197/tenants/back-demo/login-actions/reset-password \
  --data-urlencode 'email=ada@example.com' --data-urlencode "return_to=$RT" | grep '<h1>'
KEY=$(docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select substring(o.body_text from 'key=([A-Za-z0-9_-]+)')
     from email_outbox o join tenants t on t.id = o.tenant_id
    where t.name = 'back-demo' and o.to_address = 'ada@example.com'
    order by o.created_at desc limit 1;")
curl -sS -D headers.txt -b jar.txt -X POST http://localhost:3197/tenants/back-demo/login-actions/action-token \
  --data-urlencode "key=$KEY" --data-urlencode 'password=a new passphrase, here' \
  | grep -E '<h1>|<p>|<a ' | sed 's/&amp;/\&/g'
grep -ci '^set-cookie' headers.txt
```

```
<h1>Check your email</h1>
<h1>Your password has been reset</h1>
<p>Sign in with your new password.</p>
<a href="/tenants/back-demo/protocol/openid-connect/auth?response_type=code&client_id=back-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz123&nonce=abc123">Continue to sign in</a>
0
```

The link is the request that was parked, `state` and `nonce` included, so the application's
callback finds the values it asked for. It is also not a redirect: the address is rendered
into the page as a link, and `/authorize` validates it from scratch when it is followed. A
sign-in that has expired, been finished, or is held by another tab shows the text and no link,
as [self-registration](./self-registration.md#the-way-there-and-back) shows for the
verification link.

## What a reset leaves in the audit log

A redeemed link writes one `credential` row, `password.reset`, in the
transaction that sets the password. The same transaction ends every session
and revokes every grant the account held, offline ones included, so anybody
else signed in to it is signed out; each session it ends writes the
`session.ended` row a logout does. Nothing else in the flow writes one:
not the request, which must look the same whether or not the address has an
account; not a refused link, which names nobody the caller has proved
anything about; and not a password the policy refuses, which is a form
error rather than a change. This ran against its own tenant, `reset-audit`,
created by the two seed commands below, with every request's `x-request-id`
starting `reset-audit-` — six of them, all shown here:

```bash
odudu seed --tenant reset-audit --client reset-audit-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed tenant --name reset-audit --set reset_password_allowed=true
```

```
{"created":true,"tenant":"reset-audit","tenantId":"01a0dc50-7654-75c9-a070-33faf7d67368","clientId":"reset-audit-spa","userSubjectId":"01a0dc50-76c6-7e00-9086-ac84f6c1a2f2"}
{"command":"tenant","created":false,"tenant":"reset-audit","tenantId":"01a0dc50-7654-75c9-a070-33faf7d67368","settings":["reset_password_allowed"]}
```

The first link was left unredeemed past its five minutes. That it is
expired, and not spent, is what the table shows before it is submitted.
Its key is the one in the message that request queued, read from that
message's `email_outbox` row:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/tenants/reset-audit/login-actions/reset-password \
  -H 'x-request-id: reset-audit-request-1' --data-urlencode 'email=ada@example.com'

# … five minutes later
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select a.type, a.expires_at < now() as expired, a.consumed_at
     from action_tokens a join tenants t on t.id = a.tenant_id
    where t.name = 'reset-audit';"
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/tenants/reset-audit/login-actions/action-token \
  -H 'x-request-id: reset-audit-expired' \
  --data-urlencode 'key=1TPp8NWSSuC3EVyQOjd2dNllZ1QpWHC6urrquiB2D0M' \
  --data-urlencode 'password=a brand new password'
```

```
200
      type      | expired | consumed_at
----------------+---------+-------------
 reset_password | t       |
(1 row)

400
```

A second request mints a fresh link, whose key is read from the message it
queued — the newest of the two `reset-audit` has:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/tenants/reset-audit/login-actions/reset-password \
  -H 'x-request-id: reset-audit-request-2' --data-urlencode 'email=ada@example.com'
docker compose exec -T postgres psql -U odudu -d odudu -At -c \
  "select substring(o.body_text from 'key=([A-Za-z0-9_-]+)')
     from email_outbox o join tenants t on t.id = o.tenant_id
    where t.name = 'reset-audit' order by o.created_at desc limit 1;"
```

```
200
lA0JiQk1PNRbz9m_LTUP2PWGcFpQfukwqpn1Ig4euuc
```

That link is then submitted with a password the policy refuses, with one it
accepts, and once more after it is spent:

```bash
KEY=lA0JiQk1PNRbz9m_LTUP2PWGcFpQfukwqpn1Ig4euuc
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/tenants/reset-audit/login-actions/action-token \
  -H 'x-request-id: reset-audit-weak' --data-urlencode "key=$KEY" --data-urlencode 'password=weak'
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/tenants/reset-audit/login-actions/action-token \
  -H 'x-request-id: reset-audit-ada' --data-urlencode "key=$KEY" \
  --data-urlencode 'password=a brand new password'
curl -sS -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:3000/tenants/reset-audit/login-actions/action-token \
  -H 'x-request-id: reset-audit-replay' --data-urlencode "key=$KEY" \
  --data-urlencode 'password=another password'

docker compose exec -T postgres psql -U odudu -d odudu -x -P 'null=(null)' -c \
  "select e.request_id, e.event_type, e.action, e.outcome, e.actor_subject_id,
          e.resource_type, e.resource_id, e.detail
     from audit_events e
    where e.request_id like 'reset-audit-%'
    order by e.occurred_at;"
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select count(*) as rows_naming_either
     from audit_events e
    where e::text like '%a brand new password%' or e::text like '%$KEY%';"
```

```
400
200
400
-[ RECORD 1 ]----+-------------------------------------
request_id       | reset-audit-ada
event_type       | credential
action           | password.reset
outcome          | allowed
actor_subject_id | 01a0dc50-76c6-7e00-9086-ac84f6c1a2f2
resource_type    | subject
resource_id      | 01a0dc50-76c6-7e00-9086-ac84f6c1a2f2
detail           | {}

 rows_naming_either
--------------------
                  0
(1 row)
```

Six requests, one row. The last query reads every audit row this stack
holds, in every tenant, as text: none carries the password that was set or
the key that set it.
