---
title: 'Following a required-actions link'
description: "An administrator's POST /admin/tenants/{tenant}/subjects/{id}/actions-email (the admin paths) mails a link to the same…"
---

# Following a required-actions link

An administrator's `POST /admin/tenants/{tenant}/subjects/{id}/actions-email`
([the admin paths](../admin-paths/index.md)) mails a link to the same
`/login-actions/action-token` endpoint a reset link uses, carrying the
actions it was sent for. Opening it renders the actions and consumes
nothing, so a mail scanner's `GET` does not spend it; the form carries a
password field only when `update-password` is among them. Submitting it
sets that password under the reset link's rules — the tenant's policy, the
previous password refused, every outstanding password-setting link retired, a
`password.reset` row in the trail — and **owes every other action rather
than doing it**: enrolling a TOTP secret, a passkey or recovery codes still
takes a sign-in with the password and any factor the subject already holds,
which then runs each in turn and finishes, as it does for one an
administrator set — one password, then the enrolment, then the code issued
to the client. A link
that sets a password is stopped by `reset_password_allowed` the way a reset
link is, and every link is spent once.

On a stack of its own, on `http://localhost:3094`, started on an empty volume
with `ODUDU_OUTBOX_ENABLED=false`, `ODUDU_REAP_ENABLED=false` and
`ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true`, with `seed admin --username ada` run
against it and `$ADMIN_TOKEN` got the way [Admin
paths](../admin-paths/getting-the-token.md) shows. Its tenant
`required-actions-demo` came from `odudu seed --tenant required-actions-demo
--client actions-app --redirect-uri https://app.example/callback --user seeder
--password correct-horse-battery`, a relay at the `postgres` container's port 25
was set with `PUT /smtp`, `grace` was made with an address and no password, and
the link was mailed by `POST /subjects/:id/actions-email` for `configure-totp`
and `update-password` and read from `email_outbox`. The link there is that run's
own, not the one [Admin paths](../admin-paths/index.md)'s section shows. Its
page, the submission, then what `grace` now owes, read through the admin API
with `$ADMIN_TOKEN` as there, and the same submission again — its page is the
spent-link one, not the missing- or weak-password one the same endpoint also
answers `400` with:

```bash
curl -sS -D - \
  'http://localhost:3094/tenants/required-actions-demo/login-actions/action-token?key=ZPLLKU68CFpPmla3ybn_vHhlGZIfv0LxQOgMkCaLO1M'
```

```
HTTP/1.1 200 OK
x-request-id: 01a137d6-0294-7385-8d89-25ff1b96ce96
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; script-src 'nonce-6Bx5ZwMggBZBu/rZ7Uz01A=='
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 3394
Date: Wed, 14 Oct 2026 00:35:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Update your account</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<header class="intro">
<h1>Update your account</h1>
<p class="tenant"><bdi>required-actions-demo</bdi></p>
</header>
<p>Your administrator asks you to:</p>
<ul>
<li>Choose a new password</li>
<li>Set up an authenticator app</li>
</ul>
<form method="post" action="/tenants/required-actions-demo/login-actions/action-token">
  <input type="hidden" name="key" value="ZPLLKU68CFpPmla3ybn_vHhlGZIfv0LxQOgMkCaLO1M">
  <label>New password <input type="password" name="password" autocomplete="new-password" id="password" minlength="15" spellcheck="false" autocapitalize="off" autocorrect="off" aria-describedby="password-rules-list"></label>
  <div class="rules hint" id="password-rules" data-min="15" data-summary="{met} of {total} rules met">
    <p class="rules-head"><span>Your password needs:</span> <button type="button" class="quiet" hidden aria-controls="password" aria-pressed="false">Show password</button> <span role="status"></span></p>
    <ul id="password-rules-list">
      <li data-rule="length">At least 15 characters</li>
      <li>Not a common password</li>
    </ul>
  </div>
  <script nonce="6Bx5ZwMggBZBu/rZ7Uz01A==">(function () {
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
  <button type="submit">Continue</button>
</form>
</main>
</body>
</html>
```

```bash
curl -sS -D - -X POST http://localhost:3094/tenants/required-actions-demo/login-actions/action-token \
  --data-urlencode 'key=ZPLLKU68CFpPmla3ybn_vHhlGZIfv0LxQOgMkCaLO1M' \
  --data-urlencode 'password=a-new-passphrase-for-ops'
```

```
HTTP/1.1 200 OK
x-request-id: 01a137d6-02c7-7996-9fc9-0c51ccac9243
content-type: text/html
content-security-policy: default-src 'none'; style-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'
x-frame-options: DENY
referrer-policy: no-referrer
cache-control: no-store
x-content-type-options: nosniff
content-language: en
content-length: 903
Date: Wed, 14 Oct 2026 00:35:34 GMT
Connection: keep-alive
Keep-Alive: timeout=72

<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Account updated</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>Your account is updated</h1>
<p>Sign in to the application to finish:</p>
<ul>
<li>Set up an authenticator app</li>
</ul>
</main>
</body>
</html>
```

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3094/admin/tenants/required-actions-demo/subjects/01a137d6-00b4-7bdc-a5f0-449c5f9c5dbb/required-actions; echo
curl -sS -w '\n' -X POST \
  http://localhost:3094/tenants/required-actions-demo/login-actions/action-token \
  --data-urlencode 'key=ZPLLKU68CFpPmla3ybn_vHhlGZIfv0LxQOgMkCaLO1M' \
  --data-urlencode 'password=another-passphrase-for-ops'
```

```
{"actions":["configure-totp"]}
<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>Can&#39;t use this link</title>
<link rel="stylesheet" href="/instrument/instrument.css">
<link rel="icon" href="/instrument/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/instrument/favicon.ico" sizes="48x48">
</head>
<body>
<main class="page">
<p class="brand"><svg class="mark" viewBox="0 0 32 32" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true" focusable="false"><circle cx="16" cy="6" r="4"/><path d="M16 10V30"/><path d="M12 14H20"/></svg><span class="wordmark">odudu</span></p>
<h1>This link can&#39;t be used</h1>
<p>It may have already been used or expired. Request a new one and try again.</p>
<p class="links">
<a href="/tenants/required-actions-demo/login-actions/reset-password">Request a new link</a>
</p>
</main>
</body>
</html>
```

The link in this run was sent with no client, so neither page above offers a way
back. A link sent with a `client_id` ends on the same pages with one more link,
"Return to the application", to a redirect address the client registered, as
[the admin page](../admin-paths/post-subjectsidactions-email.md) shows.
