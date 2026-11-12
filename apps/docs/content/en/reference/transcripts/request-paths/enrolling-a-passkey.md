---
title: 'Enrolling a passkey'
description: 'POST /tenants/{tenant}/login-actions/required-action?action=configure-passkey enrols a WebAuthn credential for the subject the authentication…'
---

# Enrolling a passkey

`POST /tenants/{tenant}/login-actions/required-action?action=configure-passkey`
enrols a WebAuthn credential for the subject the authentication session is
bound to, the same way the `configure-totp` submission above enrols a TOTP
one. Nothing yet asks for the action on its own — there is no tenant switch
for passkeys, the way `otp_required` exists for TOTP — so it becomes pending
only when something adds it (today: a row in `user_required_actions`).
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
  pending set in the order `update-password`, `configure-totp`,
  `configure-passkey`, `generate-recovery-codes`, whatever the form says.
- A submission against a session whose authentication has not finished — a
  password passed and a second factor still outstanding, including one the
  subject enrolled in another attempt since — or one already spent on a
  sign-in. A required action blocks a login's completion, not its factors.
- Any enrolment at all on a deployment with no `ODUDU_PUBLIC_BASE_URL`. The
  relying party id comes from that value and nowhere else, and the page
  reports the action as one that cannot be completed rather than binding a
  credential to a guessed domain. With `NODE_ENV=production` the server
  refuses to boot in that state.
