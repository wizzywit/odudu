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
location: http://127.0.0.1:8080/callback?code=DiPd6RbLKYadpr1a2PblolafG2NdE2MCCzSpRwkpySw&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
```

A person who closes the tab sends nothing, so an application that waits for this redirect must be able to go on without it.

Full transcript: [Changing an authenticator](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#changing-an-authenticator).

## 4. Check the result, and never trust the status alone

`action_status` is a hint. It travels through the browser, and anyone can type it into an address, and a person who closes the tab
sends nothing at all. The authority is the me API: read `GET /me/credentials` with the token the code buys, and decide from that.
What to read depends on the action:

- `configure-totp` and `configure-passkey`: the credential list. The new authenticator is there by its type.
- `generate-recovery-codes`: `recovery_codes_left` in the same answer.
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

Recovery codes the person already holds are not replaced until they confirm, and leaving the question changes nothing. The page that
shows the new codes has no way to cancel, because it would then say `cancelled` of a set that has changed.

```
answered: HTTP/1.1 200 OK
This replaces your current recovery codes. The old ones stop working as soon as you confirm.
location: http://127.0.0.1:8080/callback?code=lQIoRIkD8ArS6vM17vKwylvG-wMKqo9NA08CWbhnANk&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=cancelled
```

Full transcript: [Replacing the recovery codes](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#replacing-the-recovery-codes).

A requested password change asks for the current password first. A wrong answer counts as a failed sign-in against the tenant's
lockout, so a person who is asked for it can be locked out by guessing, as at the sign-in page. The right answer changes the
password and ends the run of failures. The last line shows the check of section 4 for a password, the `created_at` of the
password read before the action and after it:

```
{"locked":false,"locked_until":null,"failure_count":1,"last_failure_at":"2026-11-11T22:09:56.650Z"}
location: http://127.0.0.1:8080/callback?code=cBZPvpnOQI6zTdAoK3MlJ8U_2GkPpHb5ZinXvcqgGAo&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Factions-demo&action_status=success
{"locked":false,"locked_until":null,"failure_count":0,"last_failure_at":null}
password made: before 2026-11-11T22:09:54.186Z, after 2026-11-11T22:09:56.728Z
```

Full transcript: [Changing the password](../reference/transcripts/request-paths/sending-a-person-to-change-a-credential.md#changing-the-password).

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
