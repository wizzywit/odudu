---
title: Send a person to change a credential
description: Send a signed-in person to Odudu to change a password, authenticator or recovery codes, take them back, and check what changed.
sidebar_position: 5
---

# Send a person to change a credential

An application that has its own account page does not have to build a password form or an authenticator setup. It sends the
person to Odudu with one more parameter on the sign-in request, `action`, and Odudu shows the page it already uses for that change.
This guide follows one recorded run: what the application sets up, what it sends, what comes back, and the one check it must make
before it believes the answer.

The tenant is `actions-demo`, with a public client `profile-app` and two people, `grace` and `lin`.

## 1. Allow the actions on the client

A client may start none until an administrator allows it. The setting is `allowed_actions`, a list of `update-password`,
`configure-totp`, `configure-passkey` and `generate-recovery-codes`. Set it in the admin API, in the console under **Advanced**
on the client, or with `--allow-action` on `odudu seed client`, which also assigns the scope `me:read`. A client that may start an
action has to hold `me:read`, because that is how it reads the outcome. Dynamic registration refuses the setting, because only
an operator decides what an application may ask a person to do.

```bash
odudu seed client --tenant actions-demo --client-id profile-app --public --redirect-uri $REDIR \
  --audience $ME --allow-action update-password --allow-action configure-totp \
  --allow-action configure-passkey --allow-action generate-recovery-codes
```

```
{"client_id":"profile-app","type":"public","allowed_actions":["update-password","configure-totp","configure-passkey","generate-recovery-codes"],"scopes":["me:read"]}
```

Full transcript: [Sending a person to change a credential](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#a-tenant-two-people-and-two-clients).

## 2. Send the person

The request is the usual one with `action=configure-totp`, and it asks for `me:read` and the me URL as the `resource`, so the
token it gets later can read the credential list. A person who is not signed in sees the sign-in page first. One whose sign-in is
older than the tenant's `session_freshness_seconds` is asked to sign in again before the page is shown. Then the person sees the
page of the action, with a control to leave it.

```
Sign in
page: Set up your authenticator
cancel control: yes
```

Full transcript: [Changing an authenticator](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#changing-an-authenticator).

## 3. Handle what comes back

The browser returns to the redirect address with `code`, `state` and `iss` as for any sign-in, and `action_status`, which is
`success`, `cancelled` or `error`. Here the person confirmed an authenticator and saved the recovery codes it owes:

```
page: Save your recovery codes
cancel control: no
location: http://127.0.0.1:8080/callback?code=9L66TF1ZtawRU11zIydClrva7Dj15ScjtSMo3Zt9u6A&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
```

A person who closes the tab sends nothing, so an application that waits for this redirect must be able to go on without it.

Full transcript: [Changing an authenticator](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#changing-an-authenticator).

## 4. Check the result, and never trust the status alone

`action_status` is a hint. It travels through the browser, and anyone can type it into an address, and a person who closes the tab
sends nothing at all. The authority is the me API: read `GET /me/credentials` with the token the code buys, and decide from that.
What to read depends on the action:

- `configure-totp` and `configure-passkey`: the credential list. The new authenticator is there by its type.
- `generate-recovery-codes`: `recovery_codes_left` in the same answer. It also carries `recovery_codes_low`, `true` once a person's
  set has fewer unspent codes than the tenant's `recovery_code_warn_below` (3 by default, 0 turns it off) and `false` when they hold
  no set. Odudu shows no page after sign-in to warn on, so an application shows the warning from that field and sends the person
  here; the sign-in never asks for a step on its account.
- `update-password`: the list shows the password by type either way, so it cannot show a change. Each credential lists when it was
  made, and a new password is dated from the change, so compare the password's `created_at` from before the action with the one
  after it. Section 5 shows it.

For the authenticator, the list and the count look like this:

```bash
GRACE=$(token)
credentials "$GRACE"
```

```
{"types":["password","totp"],"recovery_codes_left":10}
```

Full transcript: [Changing an authenticator](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#changing-an-authenticator).

## 5. Know what the person is asked

Recovery codes the person already holds are not replaced until they confirm, and leaving the question changes nothing. A person with
an authenticator and no set is asked before a first set is made, too: nothing is issued while the question is on the screen, a reload
included. The page that shows the new codes has no way to cancel, because it would then say `cancelled` of a set that has changed.

A change the person completes is also told to them by mail: an authenticator or passkey set up, or a new set of recovery codes. The notice goes to a verified address only; for an address nobody verified the change still happens and the audit row says `skipped_unverified`.

```
answered: HTTP/1.1 200 OK
This replaces your current recovery codes. The old ones stop working as soon as you confirm.
location: http://127.0.0.1:8080/callback?code=xe-Z4RBU3bKU8IJyy8Wyzxjy1wHDcqkWqj_YwEFwX7A&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
```

A set can be replaced once an hour, counted from when the last was made, because each set costs ten password hashes. A person who
asks inside the hour, while they still have codes to spend, is shown how many minutes to wait, with the way out, and the answer is
`429`. The first set, a set with no code left to spend, and a set the person's sign-in is waiting for are never held back. The refusal is written to the audit trail as
`recovery_codes.refused`:

```
answered: HTTP/1.1 429 Too Many Requests
Your recovery codes were issued recently and still work. You can replace them in 60 minutes.
page: Save your recovery codes
cancel control: yes
location: http://127.0.0.1:8080/callback?code=NUpkJpwg86uVA3l5LLsCnlr13GOLZalv55gvZ0oW2dU&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
```

Full transcript: [Replacing the recovery codes](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#replacing-the-recovery-codes).

A requested password change asks for the current password first. A wrong answer counts as a failed sign-in against the tenant's
lockout, so a person who is asked for it can be locked out by guessing, as at the sign-in page. The right answer changes the
password and ends the run of failures. The last line shows the check of section 4 for a password, the `created_at` of the
password read before the action and after it:

```
{"locked":false,"locked_until":null,"failure_count":1,"last_failure_at":"2026-11-12T11:13:52.487Z"}
location: http://127.0.0.1:8080/callback?code=5wQR9HgWqTy2kIcVRRnWA15ESAG27OMlfXNBn_h1IAk&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
{"locked":false,"locked_until":null,"failure_count":0,"last_failure_at":null}
password made: before 2026-11-12T11:13:48.048Z, after 2026-11-12T11:13:52.568Z
```

Full transcript: [Changing the password](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#changing-the-password).

The page also offers "End my other sessions", checked. Left checked it ends every session of the person but the one they are signed in with, which is the session the request came from; cleared, it ends none.

## 6. Know what is refused

An action the client is not allowed, an unknown name, the parameter twice and the parameter empty are each refused with
`invalid_request` at the redirect address, and no page is shown. An action the person's account cannot take, such as recovery codes
for a person with no authenticator, shows a page at Odudu that says so and links back with `action_status=error`. That status is a
hint too: the credential list is still where the application looks.

```
HTTP/1.1 400 Bad Request
Can&#39;t continue
This change is not available for your account.
http://127.0.0.1:8080/callback?error=access_denied&error_description=The+user+did+not+allow+the+request.&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=error
```

Full transcript: [An action the account cannot take](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#an-action-the-account-cannot-take).
