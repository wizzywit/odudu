---
title: 'Password expiry, and changing a password'
description: "A tenant's password_max_age_days ages a password out."
---

# Password expiry, and changing a password

> **Not replayed after the device cookie.** A response on this page that ends a sign-in now also carries a `set-cookie` for `<tenant>-device`, which the blocks below do not show, because this page was captured before that cookie existed and has not been run again. [A session's device](the-me-api.md#a-sessions-device) is a live capture of the cookie.

A tenant's `password_max_age_days` ages a password out. An expired password
is **not** refused: the login authenticates exactly as it always did, and
the `update-password` required action is what stops it from completing —
the gate that could rescue a refused login sits downstream of a success, so
refusing the factor would lock out precisely the accounts the policy exists
to move along.

The policy is two tenant settings, so `seed tenant --set` carries both. The
`psql` that follows has no alternative and never will: nothing can make a
password ninety days old in less than ninety days. On its own stack, on
`http://localhost:3086`:

```bash
odudu seed \
  --tenant expiry-demo --client expiry-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed tenant --name expiry-demo \
  --set password_max_age_days=90 --set password_history_depth=2
docker compose -p odudu-t8d -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo');"
```

```
{"created":true,"tenant":"expiry-demo","tenantId":"01a10b6c-…","clientId":"expiry-spa","userSubjectId":"01a10b6c-…"}
{"command":"tenant","created":false,"tenant":"expiry-demo","tenantId":"01a10b6c-99d6-7be3-8938-3d002dc8dc15","settings":["password_max_age_days","password_history_depth"]}
UPDATE 1
```

`/authorize` parks the request and renders the ordinary password form; the
`auth_session_id` in it — `01a10b6c-9d41-75c4-85f5-e18615bcb162` in this
run — is what every request below carries. The correct password answers
`200` with a change-password form rather than `302` with a code: it was
accepted, and the pending action is what holds the login (no `set-cookie`,
no `code`).

```bash
curl -sS -X POST http://localhost:3086/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a10b6c-9d41-75c4-85f5-e18615bcb162' \
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
<title>Change your password</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Change your password</h1>
<p class="tenant"><bdi>expiry-demo</bdi></p>
</header>
<p>This account needs a new password before you can continue.</p>
<form method="post" action="/tenants/expiry-demo/login-actions/required-action?action=update-password">
  <input type="hidden" name="auth_session_id" value="01a10b6c-9d41-75c4-85f5-e18615bcb162">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="A9NPJYpWmxYUW8zXfjAHiQ==">(function () {
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
  <button type="submit">Update password</button>
</form>
</main>
</body>
</html>
```

The candidate is judged by the tenant's own policy, the same
`evaluatePassword` call registration, reset redemption and the seed CLI are
bound by — `400`, with every rule it broke:

```bash
curl -sS -X POST \
  'http://localhost:3086/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a10b6c-9d41-75c4-85f5-e18615bcb162' \
  --data-urlencode 'password=short' \
  | grep -E 'role="alert"|<li id="form-error'
```

```
<div class="alert" role="alert" id="form-error">
<li id="form-error-0">Password must be at least 15 characters long.</li>
```

Above a `password_history_depth` of zero, a tenant also remembers that many
retired passwords and refuses the one in force. This is the only rule that
cannot be decided from the candidate alone — it is up to
`password_history_depth` Argon2id verifications against stored hashes — and
it is reported as a policy violation like the rest:

```bash
curl -sS -X POST \
  'http://localhost:3086/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a10b6c-9d41-75c4-85f5-e18615bcb162' \
  --data-urlencode 'password=correct-horse-battery'
```

```
<header class="intro">
<h1>Change your password</h1>
<p class="tenant"><bdi>expiry-demo</bdi></p>
</header>
<p>This account needs a new password before you can continue.</p>
<div class="alert" role="alert" id="form-error">
<ul>
<li id="form-error-0">Password must not be one you have used before.</li>
</ul>
</div>
```

(both refusals re-render the whole form, the second elided here to its heading and its alert; the hidden
`auth_session_id` comes back with it, so the same parked login survives a
wrong answer.)

A candidate that satisfies the policy replaces the password, retires the
one it displaces as a `password-history` credential, and completes the
action. The parked login then resumes where it stopped: the password it
already accepted is not asked for again, nothing else is owed, and the
answer is the code issued to the client:

```bash
curl -sS -D - -o /dev/null -X POST \
  'http://localhost:3086/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a10b6c-9d41-75c4-85f5-e18615bcb162' \
  --data-urlencode 'password=a-brand-new-passphrase'
docker compose -p odudu-t8d -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT type, created_at FROM user_credentials
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY type;"
```

```
HTTP/1.1 302 Found
x-request-id: 01a10b6c-9e27-7704-bf0a-d87e1a580945
set-cookie: expiry-demo-session=01a10b6c-9e9a-7e01-94c9-b3e323ac2827:jzvh-oA-g-vYo4to48WNw7BB9g3eY-gyZlK_yf-MBHY; HttpOnly; SameSite=Lax; Path=/
set-cookie: expiry-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/expiry-demo/; Max-Age=0
location: http://localhost:8080/callback?code=Z2mgP39xHfH1nMBDl2Zo2TrkJU-AP0cnUHW85P-dS8E&state=xyz&iss=http%3A%2F%2Flocalhost%3A3086%2Ftenants%2Fexpiry-demo
content-length: 0
Date: Mon, 05 Oct 2026 09:37:10 GMT
Connection: keep-alive
Keep-Alive: timeout=72

       type       |          created_at
------------------+-------------------------------
 password         | 2026-10-05 09:37:10.190521+00
 password-history | 2026-10-05 09:37:10.190521+00
(2 rows)
```

`created_at` moved with the hash. One row holds a subject's password for
the life of the account, so it dates the password rather than the row —
left alone, the new password would still be a hundred days old and the
action would be owed again on the very next login.

Reset redemption shares only half of this. It refuses the password in
force — otherwise a mailed link would restart the clock on an expired
password without changing it — but it consults no history, so a password
retired more than one change ago can be restored that way. Only this action
reads history, and only this action writes any.

An accepted change writes one `credential` audit row, `password.changed`,
naming the subject. A candidate the policy or the history refuses writes
none, and no row carries a candidate either way.

A retired hash is never a login's input. The password credential read at
authentication filters on `type = 'password'`, so the row above answers
nothing but a reuse check — the old password is simply wrong now, against a
fresh authentication session:

```bash
curl -sS -D - -o /dev/null -X POST http://localhost:3086/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a10b6c-9f33-7c8c-9899-50a2af0044d4' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
```

```
HTTP/1.1 200 OK
```

No `set-cookie` and no `location`: the login form again, exactly as any
wrong password renders it. History rows past the tenant's depth are deleted
outright rather than kept and marked, which is the one exception to
[ADR 0021](https://github.com/wizzywit/odudu/blob/main/docs/adr/0021-retention-is-bounded-by-the-detection-window.md)'s default in this codebase —
a retired password nothing will ever compare against is a stored hash that
answers no decision.
