---
title: 'Enrolling a passkey'
description: 'POST /tenants/{tenant}/login-actions/required-action?action=configure-passkey enrols a WebAuthn credential for the subject the authentication…'
---

# Enrolling a passkey

`POST /tenants/{tenant}/login-actions/required-action?action=configure-passkey`
enrols a WebAuthn credential for the subject the authentication session is
bound to, the same way the `configure-totp` submission above enrols a TOTP
one. The action becomes pending when something adds it: a row in
`user_required_actions` an administrator wrote, or the tenant's
`require_passkey` switch, which adds it at the sign-in of a person who holds
no passkey ([the run below](#a-tenant-that-asks-everyone-for-a-passkey)).
Signing in _with_ the credential this enrols is
[Signing in with a passkey](./signing-in-with-a-passkey-and-no-username.md).

**No transcript here was executed, and this page does not show output for it.**
Every other command in these pages was run against a running stack; this one
cannot be. A registration response can only be produced by
`navigator.credentials.create()` inside a browser, talking to a real
authenticator or a virtual one in the browser's own devtools — `curl` cannot
sign an attestation, and inventing a response body would make this section a
claim dressed as evidence. What is verified instead is an integration test,
which drives the enrolment against real PostgreSQL with a software authenticator
producing `none`-format attestations, and checks the stored credential, the
challenge being spent, and each refusal below.

What the flow is, stated rather than shown:

1. A login that discovers `configure-passkey` pending renders the enrolment
   page. The page carries the creation options the server generated —
   relying party, user handle, challenge, and the ids of any passkeys this
   subject already has, so the browser steers them to a different
   authenticator rather than replacing one.
2. **The challenge is on the authentication session, not in the page's
   form.** The response gives back a challenge of its own choosing; only the
   server's copy decides anything.
3. The page posts the response JSON back in the `credential` field, with
   `auth_session_id` and an optional `label`.
4. The server reads and clears the challenge in one statement, verifies the
   response against it with `@simplewebauthn/server`, and only then writes the
   credential: `lookup_key` is the credential id, and `secret_data` holds the
   COSE public key, the authenticator's signature counter at registration, and
   its transports. The `configure-passkey` action is cleared last, so a refused
   ceremony leaves it owed, and one `credential` audit row, `passkey.enrolled`,
   is written in the same transaction, with the notice to the subject's verified address queued beside it (its `detail.notice`
   says `sent`, `skipped_unverified` or `skipped_none`); a refused ceremony writes none. The
   parked login then resumes: the recovery codes the enrolment owes come next,
   and acknowledging them answers the `302` to the client, with no second
   password.
   The creation options carry the tenant's `webauthn_resident_key` and
   `webauthn_user_verification` (both `required` unless the tenant changed
   them), and the credential's row records the two it was made under, beside
   the key, the counter and the transports. A response without the user-verified
   flag is refused only where verification was required; the row is then
   verified at sign-in by what it recorded, and a change of the setting
   afterwards applies to the next passkey only.
5. The page's script is inline, because only a script can reach an
   authenticator. The response's `Content-Security-Policy` names a
   per-response `nonce` and that script carries it — not `unsafe-inline`, so
   an injected script on this page still runs nowhere. No `connect-src`:
   this page is handed its options inline and fetches nothing, unlike the
   login page's passkey script.

Refused, each for its own reason:

- A response replayed after a successful enrolment — the challenge it
  answered no longer exists, so there is nothing for it to match.
- A response answering a challenge this server never issued.
- A response produced against another relying party or origin.
- A submission for an action the subject does not owe **next**: the
  required-action route refuses any action that is not the head of their
  pending set in the order `verify-email`, `update-password`,
  `configure-totp`, `configure-passkey`, `generate-recovery-codes`,
  `update-profile`, `accept-terms`, whatever the form says.
- A submission against a session whose authentication has not finished — a
  password passed and a second factor still outstanding, including one the
  subject enrolled in another attempt since — or one already spent on a
  sign-in. A required action blocks a login's completion, not its factors.
- Any enrolment at all on a deployment with no `ODUDU_PUBLIC_BASE_URL`. The
  relying party id comes from that value and nowhere else, and the page
  reports the action as one that cannot be completed rather than binding a
  credential to a guessed domain. With `NODE_ENV=production` the server
  refuses to boot in that state.

## A tenant that asks everyone for a passkey

`require_passkey` is a tenant setting, off unless it is turned on. With it on, a sign-in that completes adds the
`configure-passkey` action for a person who holds no passkey under the address they signed in at, and the page above is the
next thing they see. This section ran, and the blocks are what came back; the passkey ceremony itself still needs a browser, so
it stops at the page. On a stack of its own on `http://localhost:3000`, started on an empty volume, a tenant `switch-demo` with
a client `switch-spa` and `ada`:

```bash
odudu seed --tenant switch-demo --client switch-spa --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery
```

```
{"created":true,"tenant":"switch-demo","tenantId":"01a1cfdb-2633-71b2-82b2-d2176a45d71c","clientId":"switch-spa","userSubjectId":"01a1cfdb-26f0-7925-b25a-93c21753df78"}
```

`sign_in` is a shell function that starts an authorization request with a cookie jar and posts `ada`'s password to the form it
gets back. It prints the status line and `Location` of a sign-in that finishes, with the authorization code shown as `CODE`,
and otherwise the lines of the page it landed on that matter. `rows` reads the owed actions of the tenant as the database owner:

```bash
AUTHORIZE_URL='http://localhost:3000/tenants/switch-demo/protocol/openid-connect/auth?response_type=code&client_id=switch-spa&redirect_uri=http%3A%2F%2Flocalhost%3A8080%2Fcallback&scope=openid&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
sign_in() {
  curl -sS -D a.hdr -c "$1" -b "$1" -o a.html "$AUTHORIZE_URL"
  if head -1 a.hdr | grep -q 302; then
    head -1 a.hdr | tr -d '\r'; grep -i '^location' a.hdr | tr -d '\r' | sed 's/code=[^&]*/code=CODE/'
    return
  fi
  SID=$(grep -o 'name="auth_session_id" value="[^"]*"' a.html | head -1 | sed 's/.*value="//;s/"//')
  curl -sS -D b.hdr -c "$1" -b "$1" -o b.html --data-urlencode "auth_session_id=$SID" \
    --data-urlencode username=ada --data-urlencode password=correct-horse-battery \
    http://localhost:3000/tenants/switch-demo/login-actions/authenticate
  head -1 b.hdr | tr -d '\r'
  if head -1 b.hdr | grep -q 302; then
    grep -i '^location' b.hdr | tr -d '\r' | sed 's/code=[^&]*/code=CODE/'
  else
    grep -E '<title>|<form |<p>This|cancel' b.html
  fi
}
rows() {
  docker compose exec -T postgres psql -U odudu -d odudu -c \
    "select u.username, r.action from user_required_actions r join users u on u.subject_id = r.subject_id where r.tenant_id = (select id from tenants where name = 'switch-demo') order by 1, 2"
}
```

With the switch off, `ada` signs in and ends in the redirect, and her browser keeps the session. The tenant then turns the switch on:

```bash
sign_in jarA
odudu seed tenant --name switch-demo --set require_passkey=true
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=CODE&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fswitch-demo
{"command":"tenant","created":false,"tenant":"switch-demo","tenantId":"01a1cfdb-2633-71b2-82b2-d2176a45d71c","settings":["require_passkey"]}
```

Nothing happens to the session that is open. `ada` asks for another authorization with the same cookie jar and ends in the
redirect again: no sign-in runs, so none is asked for a passkey:

```bash
sign_in jarA
```

```
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=CODE&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fswitch-demo
```

A sign-in that starts without that session is the next one that completes. The password is right, so authentication succeeds,
and the page that comes back is the passkey page, with the action owed. Its form has no `cancel` button, which the count
confirms:

```bash
sign_in jarB; rows
grep -c 'name="cancel"' b.html
```

```
HTTP/1.1 200 OK
<title>Add a passkey</title>
<form method="post" action="/tenants/switch-demo/login-actions/required-action?action=configure-passkey" id="passkey-form" data-failed="Your device did not finish adding the passkey — {reason}. You can try again." data-cancelled="the request was cancelled">
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
 username |      action
----------+-------------------
 ada      | configure-passkey
(1 row)
0
```

The sign-in is not complete until the passkey is registered. A third sign-in is asked the same, and the owed action is still one row:

```bash
sign_in jarC; rows
```

```
HTTP/1.1 200 OK
<title>Add a passkey</title>
<form method="post" action="/tenants/switch-demo/login-actions/required-action?action=configure-passkey" id="passkey-form" data-failed="Your device did not finish adding the passkey — {reason}. You can try again." data-cancelled="the request was cancelled">
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
 username |      action
----------+-------------------
 ada      | configure-passkey
(1 row)
```

Turning the switch off does not remove what is owed. After it, `ada` signs in again and meets the page, and the row is still there:

```bash
odudu seed tenant --name switch-demo --set require_passkey=false
sign_in jarD; rows
```

```
{"command":"tenant","created":false,"tenant":"switch-demo","tenantId":"01a1cfdb-2633-71b2-82b2-d2176a45d71c","settings":["require_passkey"]}
HTTP/1.1 200 OK
<title>Add a passkey</title>
<form method="post" action="/tenants/switch-demo/login-actions/required-action?action=configure-passkey" id="passkey-form" data-failed="Your device did not finish adding the passkey — {reason}. You can try again." data-cancelled="the request was cancelled">
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
 username |      action
----------+-------------------
 ada      | configure-passkey
(1 row)
```

An administrator clears it with the required-actions route. `ADA` is the `userSubjectId` the seed printed above, and
`ADMIN_TOKEN` and the `ETag` are got as [the required-actions page](../admin-paths/get-subjectsidrequired-actions-and-put-subjectsidrequired-actions.md)
shows. The next sign-in, with the switch still off, ends in the redirect and nothing is owed:

```bash
ADA=01a1cfdb-26f0-7925-b25a-93c21753df78
curl -sS -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"actions":[]}' http://localhost:3000/admin/tenants/switch-demo/subjects/$ADA/required-actions
sign_in jarE; rows
```

```
{"actions":[]}
HTTP/1.1 302 Found
location: http://localhost:8080/callback?code=CODE&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fswitch-demo
 username | action
----------+--------
(0 rows)
```

Clearing the action lets the sign-in through once, and it is not an exemption. With the switch on again, the next sign-in owes
it again:

```bash
odudu seed tenant --name switch-demo --set require_passkey=true
sign_in jarF; rows
```

```
{"command":"tenant","created":false,"tenant":"switch-demo","tenantId":"01a1cfdb-2633-71b2-82b2-d2176a45d71c","settings":["require_passkey"]}
HTTP/1.1 200 OK
<title>Add a passkey</title>
<form method="post" action="/tenants/switch-demo/login-actions/required-action?action=configure-passkey" id="passkey-form" data-failed="Your device did not finish adding the passkey — {reason}. You can try again." data-cancelled="the request was cancelled">
    const reason = caught && caught.message ? caught.message : form.dataset.cancelled;
 username |      action
----------+-------------------
 ada      | configure-passkey
(1 row)
```

A person whose browser or device cannot make a passkey is therefore asked at every sign-in while the switch is on. Turn the
switch off and clear the action that is already owed, since turning it off does not remove it; or leave the switch on and
clear the action at each of their sign-ins. Either holds until they have a device that can.
