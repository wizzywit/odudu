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
`http://localhost:3092`:

```bash
odudu seed \
  --tenant expiry-demo --client expiry-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed tenant --name expiry-demo \
  --set password_max_age_days=90 --set password_history_depth=2
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo');"
```

```
{"created":true,"tenant":"expiry-demo","tenantId":"01a1d0ec-d011-7e75-be3a-15df3464d28e","clientId":"expiry-spa","userSubjectId":"01a1d0ec-d0cd-766e-b8c3-8a592c7186c9"}
{"command":"tenant","created":false,"tenant":"expiry-demo","tenantId":"01a1d0ec-d011-7e75-be3a-15df3464d28e","settings":["password_max_age_days","password_history_depth"]}
UPDATE 1
```

`/authorize` parks the request and renders the ordinary password form; the
`auth_session_id` in it — `01a1d0ec-d3b3-73f1-93e8-8ee67cbd8a9d` in this
run — is what every request below carries. The correct password answers
`200` with a change-password form rather than `302` with a code: it was
accepted, and the pending action is what holds the login (no `set-cookie`,
no `code`).

```bash
curl -sS -X POST http://localhost:3092/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0ec-d3b3-73f1-93e8-8ee67cbd8a9d' \
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
  <input type="hidden" name="auth_session_id" value="01a1d0ec-d3b3-73f1-93e8-8ee67cbd8a9d">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="0uCg9tzpv95ZhmpbOx8qEQ==">(function () {
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
  'http://localhost:3092/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ec-d3b3-73f1-93e8-8ee67cbd8a9d' \
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
  'http://localhost:3092/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ec-d3b3-73f1-93e8-8ee67cbd8a9d' \
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
  'http://localhost:3092/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ec-d3b3-73f1-93e8-8ee67cbd8a9d' \
  --data-urlencode 'password=a-brand-new-passphrase'
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT type, created_at FROM user_credentials
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY type;"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d0ec-d498-7994-b640-c86908131c2e
set-cookie: expiry-demo-session=01a1d0ec-d4f7-7d90-b974-7d5d4e83decc:af54735-DdxuG23HzToV18t1WsuOLcayzDQS-6hlSMg; HttpOnly; SameSite=Lax; Path=/
set-cookie: expiry-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: expiry-demo-device=OxZWDNfQy9BSqpvKQW5vnQ; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/expiry-demo/; Max-Age=0
location: http://localhost:8080/callback?code=gUd1bq2nW3_waLol2EamXCDnjOQU563e0EBbtzsLAIw&state=xyz&iss=http%3A%2F%2Flocalhost%3A3092%2Ftenants%2Fexpiry-demo
content-length: 0
Date: Thu, 12 Nov 2026 18:02:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72

       type       |          created_at
------------------+-------------------------------
 password         | 2026-11-12 18:02:24.287186+00
 password-history | 2026-11-12 18:02:24.287186+00
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
naming the subject, saying in `ended_other_sessions` whether the person
asked for their other sessions to end (the section after this one), and in `breached_check`
what the breached-password check decided (the last section). A candidate the
policy or the history refuses writes none, and no row carries a candidate
either way.

A retired hash is never a login's input. The password credential read at
authentication filters on `type = 'password'`, so the row above answers
nothing but a reuse check — the old password is simply wrong now, against a
fresh authentication session:

```bash
curl -sS -D - -o /dev/null -X POST http://localhost:3092/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0ec-d577-7cbe-a47a-dca2dd3b4962' \
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
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT created_at, expires_at > now() AS live FROM sessions
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY created_at;"
```

```
          created_at           | live
-------------------------------+------
 2026-11-12 18:02:24.372181+00 | t
(1 row)
```

The password is aged again, so that the tenant owes the change a second time, and
the next sign-in reaches the page. The page carries the box, checked:

```bash
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo');"
curl -sS -X POST http://localhost:3092/tenants/expiry-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0ec-d61e-78db-9c11-79f9ff18644b' \
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
  'http://localhost:3092/tenants/expiry-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ec-d61e-78db-9c11-79f9ff18644b' \
  --data-urlencode 'password=a-second-new-passphrase' \
  --data-urlencode 'end_other_sessions=true'
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT created_at, expires_at > now() AS live FROM sessions
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
     ORDER BY created_at;"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d0ec-d6cb-77d5-854b-cfea1e549703
set-cookie: expiry-demo-session=01a1d0ec-d74a-737a-bd56-6d2f4e358135:USvJaLTE5HxiBgLIos7UaQdfjja0EO64Ego4Ytg-RFk; HttpOnly; SameSite=Lax; Path=/
set-cookie: expiry-demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: expiry-demo-device=WdfHz3lobnwOARLMACOxjw; HttpOnly; SameSite=Lax; Path=/; Max-Age=34560000
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/expiry-demo/; Max-Age=0
location: http://localhost:8080/callback?code=8mZLfY9ogGL0JS8-ZH391eTyBAAa1RJo06LUKkDQ9N0&state=xyz&iss=http%3A%2F%2Flocalhost%3A3092%2Ftenants%2Fexpiry-demo
content-length: 0
Date: Thu, 12 Nov 2026 18:02:24 GMT
Connection: keep-alive
Keep-Alive: timeout=72

          created_at           | live
-------------------------------+------
 2026-11-12 18:02:24.372181+00 | f
 2026-11-12 18:02:24.968766+00 | t
(2 rows)
```

The audit trail has each change, whether it asked, and one `session.ended` row
for the session it ended, `via` `self` as when a person ends a session of
their own from the "me" API:

```bash
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT action, detail FROM audit_events
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'expiry-demo')
       AND action IN ('password.changed', 'session.ended')
     ORDER BY occurred_at, id;"
```

```
      action      |                           detail
------------------+-------------------------------------------------------------
 password.changed | {"breached_check": "passed", "ended_other_sessions": false}
 session.ended    | {"via": "self"}
 password.changed | {"breached_check": "passed", "ended_other_sessions": true}
(3 rows)
```

A form that leaves the field out, as a script posting the form would, ends
nothing; the page's own default of checked is what makes ending the usual
answer. A password reset reached through a mailed link ends every session of the
person whether or not they asked, since a reset is how an account is recovered
([Password reset](./password-reset.md) shows it), so that page has no box.

## A password known from breaches

A tenant also refuses a new password that is known from breaches, after the rules above and before the reuse check, and it
does so on this page like every other place a person chooses one. By default it looks in a table inside the server's own
database, which is empty until an operator loads a file into it, so nothing is refused until then. The file is a list of SHA-1
hashes, one to a line, each optionally followed by `:` and a count. This one holds the hash of
`a leaked passphrase from a breach` with a count and of `another leaked passphrase` without; the second `load` of the same
file adds nothing, and the tenant, `breach-demo`, is made as `expiry-demo` was, with no history setting:

```bash
odudu seed \
  --tenant breach-demo --client breach-spa \
  --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed tenant --name breach-demo --set password_max_age_days=90
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'breach-demo');"
```

```
{"created":true,"tenant":"breach-demo","tenantId":"01a1d0ed-6ed1-7131-a416-8250e6b894d5","clientId":"breach-spa","userSubjectId":"01a1d0ed-6f7b-7afd-9847-3b33cc2a2edd"}
{"command":"tenant","created":false,"tenant":"breach-demo","tenantId":"01a1d0ed-6ed1-7131-a416-8250e6b894d5","settings":["password_max_age_days"]}
UPDATE 1
```

```bash
printf '%s' 'a leaked passphrase from a breach' | shasum -a 1 | awk '{print toupper($1) ":12"}' > leaked.txt
printf '%s' 'another leaked passphrase' | shasum -a 1 | awk '{print toupper($1)}' >> leaked.txt
cat leaked.txt
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml cp leaked.txt odudu:/tmp/leaked.txt
odudu breached-passwords load /tmp/leaked.txt
odudu breached-passwords load /tmp/leaked.txt
```

```
73D19908EAACB33D2E87168047A26BB39AD2190D:12
CEEF9B2F2D3CE722DD4383AAF704E8829230A69B
 odudu-p4f-i92-odudu-1 Copying leaked.txt to odudu-p4f-i92-odudu-1:/tmp/leaked.txt
 odudu-p4f-i92-odudu-1 Copied leaked.txt to odudu-p4f-i92-odudu-1:/tmp/leaked.txt
{"read":2,"inserted":2}
{"read":2,"inserted":0}
```

The sign-in reaches the change-password page, and a candidate in the file is refused with its own message, `400`, in the
form's alert. The message does not say which source found it, and a candidate that was refused by a rule is never looked up:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3092/tenants/breach-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0ed-73f0-7b86-a65c-e5f2780ce817' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery'
curl -sS -D - -o /dev/null -X POST \
  'http://localhost:3092/tenants/breach-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ed-73f0-7b86-a65c-e5f2780ce817' \
  --data-urlencode 'password=a leaked passphrase from a breach' | sed -n 1p
curl -sS -X POST \
  'http://localhost:3092/tenants/breach-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ed-73f0-7b86-a65c-e5f2780ce817' \
  --data-urlencode 'password=a leaked passphrase from a breach' \
  | grep -E 'role="alert"|<li id="form-error'
```

```
200
HTTP/1.1 400 Bad Request
<div class="alert" role="alert" id="form-error">
<li id="form-error-0">That password has appeared in a data breach. Choose a different one.</li>
```

A password that is in no list is accepted, and the audit row says the check passed. The refusal wrote no row, as a refused rule
does not:

```bash
curl -sS -D - -o /dev/null -X POST \
  'http://localhost:3092/tenants/breach-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ed-73f0-7b86-a65c-e5f2780ce817' \
  --data-urlencode 'password=a-third-new-passphrase' | sed -n 1p
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT action, detail FROM audit_events
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'breach-demo')
       AND action = 'password.changed';"
```

```
HTTP/1.1 302 Found
      action      |                           detail
------------------+-------------------------------------------------------------
 password.changed | {"breached_check": "passed", "ended_other_sessions": false}
(1 row)
```

A tenant that turns the check off accepts the password that was refused, and the trail says the check was off, so a tenant that
stopped checking can be told from one that never found anything. The password is aged again for the second sign-in:

```bash
odudu seed tenant --name breach-demo --set breached_check=off
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "UPDATE user_credentials SET created_at = now() - interval '100 days'
     WHERE type = 'password'
       AND tenant_id = (SELECT id FROM tenants WHERE name = 'breach-demo');"
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3092/tenants/breach-demo/login-actions/authenticate \
  --data-urlencode 'auth_session_id=01a1d0ed-7724-7791-95ee-0cf581396e81' \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=a-third-new-passphrase'
curl -sS -D - -o /dev/null -X POST \
  'http://localhost:3092/tenants/breach-demo/login-actions/required-action?action=update-password' \
  --data-urlencode 'auth_session_id=01a1d0ed-7724-7791-95ee-0cf581396e81' \
  --data-urlencode 'password=a leaked passphrase from a breach' | sed -n 1p
docker compose -p odudu-p4f-i92 -f infra/docker/compose.yaml exec -T postgres \
  psql -U odudu -d odudu -c \
  "SELECT action, detail FROM audit_events
     WHERE tenant_id = (SELECT id FROM tenants WHERE name = 'breach-demo')
       AND action = 'password.changed'
     ORDER BY occurred_at, id;"
```

```
{"command":"tenant","created":false,"tenant":"breach-demo","tenantId":"01a1d0ed-6ed1-7131-a416-8250e6b894d5","settings":["breached_check"]}
UPDATE 1
200
HTTP/1.1 302 Found
      action      |                           detail
------------------+-------------------------------------------------------------
 password.changed | {"breached_check": "passed", "ended_other_sessions": false}
 password.changed | {"breached_check": "off", "ended_other_sessions": false}
(2 rows)
```

The same check runs when a person registers, redeems a reset link or an administrator's link that asks for a password, and its
settings, `breached_check` and `breached_on_error`, are in [`GET /settings` and `PATCH /settings`](../admin-paths/get-settings-and-patch-settings.md#the-breached-password-settings).
The remote source, which asks a range service for the first five characters of the hash, is not run here: it would contact a
host outside this stack, and the tests that stand in for it assert what leaves the server instead.
