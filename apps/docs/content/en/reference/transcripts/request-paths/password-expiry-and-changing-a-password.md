---
title: 'Password expiry, and changing a password'
description: "A tenant's password_max_age_days ages a password out."
---

# Password expiry, and changing a password

A tenant's `password_max_age_days` ages a password out. An expired password
is **not** refused: the login authenticates exactly as it always did, and
the `update-password` required action is what stops it from completing —
the gate that could rescue a refused login sits downstream of a success, so
refusing the factor would lock out precisely the accounts the policy exists
to move along.

The policy is two tenant settings, so `seed tenant --set` carries both. The
`psql` that follows has no alternative and never will: nothing can make a
password ninety days old in less than ninety days. On its own stack, on
`http://localhost:3089`:

```bash
odudu seed \
  --tenant expiry-demo --client expiry-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed tenant --name expiry-demo \
  --set password_max_age_days=90 --set password_history_depth=2
docker compose -p odudu-p4f-i9 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo');"
```

```
{"created":true,"tenant":"expiry-demo","tenantId":"01a1d0b7-5ac9-7e4c-ad54-fc7cb613838b","clientId":"expiry-spa","userSubjectId":"01a1d0b7-5b8a-7b64-95ee-abb9f482e9fe"}
{"command":"tenant","created":false,"tenant":"expiry-demo","tenantId":"01a1d0b7-5ac9-7e4c-ad54-fc7cb613838b","settings":["password_max_age_days","password_history_depth"]}
UPDATE 1
```

`/authorize` parks the request and renders the ordinary password form; the
`auth_session_id` in it — `01a1d0b7-5e13-7f85-b172-3453605f8f93` in this
run — is what every request below carries. The correct password answers
`200` with a change-password form rather than `302` with a code: it was
accepted, and the pending action is what holds the login (no `set-cookie`,
no `code`).

```bash
curl -sS -X POST http://localhost:3089/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0b7-5e13-7f85-b172-3453605f8f93' \
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
  <input type="hidden" name="auth_session_id" value="01a1d0b7-5e13-7f85-b172-3453605f8f93">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="0RhoXjBXiGzyyJt84yvD8w==">(function () {
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
  <label><input type="checkbox" name="end_other_sessions" id="end-other-sessions" value="true" checked> End my other sessions</label>
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
  'http://localhost:3089/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0b7-5e13-7f85-b172-3453605f8f93' \
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
  'http://localhost:3089/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0b7-5e13-7f85-b172-3453605f8f93' \
  --data-urlencode 'password=correct-horse-battery' \
  | sed -n '/<header class="intro">/,/^<\/div>/p'
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

(both refusals re-render the whole form, the second cut by the `sed` to its heading and its alert; the hidden
`auth_session_id` comes back with it, so the same parked login survives a
wrong answer.)

A candidate that satisfies the policy replaces the password, retires the
one it displaces as a `password-history` credential, and completes the
action. The parked login then resumes where it stopped: the password it
already accepted is not asked for again, nothing else is owed, and the
answer is the code issued to the client:

```bash
curl -sS -D - -o /dev/null -X POST \
  'http://localhost:3089/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0b7-5e13-7f85-b172-3453605f8f93' \
  --data-urlencode 'password=a-brand-new-passphrase'
docker compose -p odudu-p4f-i9 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT type, created_at FROM user_credentials
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY type;"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d0b7-5ee7-76d7-9eb0-cd30025dd09d
set-cookie: expiry-demo-session=01a1d0b7-5f37-7591-b5f0-75dc3df08d7f:ECAKeOz21yy4-CZI5Bn5FB8VE6G4TL9Yeq9UKGUAIlI; HttpOnly; SameSite=Lax; Path=/
set-cookie: expiry-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: expiry-demo-device=nVM8tzc4m6UpD7Y_9vLn8A; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/expiry-demo/; Max-Age=0
location: http://localhost:8080/callback?code=MVkIIlKFC3wRWi34_CYIT5RUcABfpsCNmK4N9s64KgM&state=xyz&iss=http%3A%2F%2Flocalhost%3A3089%2Ftenants%2Fexpiry-demo
content-length: 0
Date: Thu, 12 Nov 2026 17:04:00 GMT
Connection: keep-alive
Keep-Alive: timeout=72

       type       |          created_at
------------------+-------------------------------
 password         | 2026-11-12 17:04:00.750596+00
 password-history | 2026-11-12 17:04:00.750596+00
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
naming the subject and saying in `ended_other_sessions` whether the person
asked for their other sessions to end (the last section). A candidate the
policy or the history refuses writes none, and no row carries a candidate
either way.

A retired hash is never a login's input. The password credential read at
authentication filters on `type = 'password'`, so the row above answers
nothing but a reuse check — the old password is simply wrong now, against a
fresh authentication session:

```bash
curl -sS -D - -o /dev/null -X POST http://localhost:3089/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0b7-6018-75f9-8fe1-103bdc1fad7e' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery' | sed -n 1p
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

## Ending the other sessions

The change-password page offers a box, "End my other sessions", checked when the
page is rendered. The change above sent no `end_other_sessions` field, which is
what a browser sends for a box that was unchecked, so the session the person
holds elsewhere is left alone: one session, still live, since the change
made the one it ends in.

```bash
docker compose -p odudu-p4f-i9 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT created_at, expires_at > now() AS live FROM sessions
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY created_at;"
```

```
          created_at          | live
------------------------------+------
 2026-11-12 17:04:00.81994+00 | t
(1 row)
```

The password is aged again, so that the tenant owes the change a second time, and
the next sign-in reaches the page. The page carries the box, checked:

```bash
docker compose -p odudu-p4f-i9 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo');"
curl -sS -X POST http://localhost:3089/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0b7-60c5-7d2f-bab5-d0cb6b9d2868' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=a-brand-new-passphrase' \
  | grep 'end_other_sessions'
```

```
UPDATE 1
  <label><input type="checkbox" name="end_other_sessions" id="end-other-sessions" value="true" checked> End my other sessions</label>
```

Submitting the box checked ends every session the person had, the one in use
excepted. That session does not exist yet on this path, because the sign-in
this change belongs to completes after it, so the earlier one ends and the new
one is the only one live. When an application sent a person who is already
signed in, the session they are signed in with is the one left standing.

```bash
curl -sS -D - -o /dev/null -X POST \
  'http://localhost:3089/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0b7-60c5-7d2f-bab5-d0cb6b9d2868' \
  --data-urlencode 'password=a-second-new-passphrase' \
  --data-urlencode 'end_other_sessions=true'
docker compose -p odudu-p4f-i9 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT created_at, expires_at > now() AS live FROM sessions
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY created_at;"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d0b7-610a-7f35-be30-f277ba4a784d
set-cookie: expiry-demo-session=01a1d0b7-62b1-74f9-9b1f-1068c8cf12a2:YQw9h9eW6xEe9EFu0mwtWQnmHRSfxPduF3Jkoe5YO5k; HttpOnly; SameSite=Lax; Path=/
set-cookie: expiry-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: expiry-demo-device=kOxLIiO7A3OoNadwZWCt1A; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/expiry-demo/; Max-Age=0
location: http://localhost:8080/callback?code=fndmqvNuYWA1njXni3YiVXd8Vr58_NPwcZSF4jdHy_8&state=xyz&iss=http%3A%2F%2Flocalhost%3A3089%2Ftenants%2Fexpiry-demo
content-length: 0
Date: Thu, 12 Nov 2026 17:04:01 GMT
Connection: keep-alive
Keep-Alive: timeout=72

          created_at           | live
-------------------------------+------
 2026-11-12 17:04:00.81994+00  | f
 2026-11-12 17:04:01.710683+00 | t
(2 rows)
```

The audit trail has each change, whether it asked, and one `session.ended` row
for the session it ended, `via` `self` as when a person ends a session of
their own from the "me" API:

```bash
docker compose -p odudu-p4f-i9 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT action, detail FROM audit_events
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
       AND action IN ('password.changed', 'session.ended')
     ORDER BY occurred_at, id;"
```

```
      action      |             detail
------------------+---------------------------------
 password.changed | {"ended_other_sessions": false}
 session.ended    | {"via": "self"}
 password.changed | {"ended_other_sessions": true}
(3 rows)
```

A form that leaves the field out, as a script posting the form would, ends
nothing; the page's own default of checked is what makes ending the usual
answer. A password reset reached through a mailed link ends every session of the
person whether or not they asked, since a reset is how an account is recovered
([Password reset](./password-reset.md) shows it), so that page has no box.
