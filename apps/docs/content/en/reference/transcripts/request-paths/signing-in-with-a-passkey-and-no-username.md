---
title: 'Signing in with a passkey, and no username'
description: 'An enrolled passkey is a first factor on its own. The login page offers it beside the password fields, and pressing it asks for nothing typed:'
---

# Signing in with a passkey, and no username

An enrolled passkey is a first factor on its own. The login page offers it
beside the password fields, and pressing it asks for nothing typed:

```
<form method="post" action="/tenants/demo/login-actions/authenticate" id="passkey-form" data-failed="Your device did not finish signing in — {reason}. You can try again." data-cancelled="the request was cancelled" data-not-offered="this server is not offering passkeys">
  <input type="hidden" name="auth_session_id" value="01a13fbd-81d7-…">
  <input type="hidden" name="assertion" id="passkey-assertion">
  <p><button type="submit" id="passkey-submit" class="secondary">Sign in with a passkey</button></p>
</form>
<p id="passkey-error" class="alert" role="alert" hidden></p>
<noscript><p>Signing in with a passkey needs JavaScript, because only the browser can talk to your authenticator. Use your username and password above.</p></noscript>
```

That button is on the `/authorize` response shown in
[`/authorize`](./path-a-authorization-code-with-pkce.md#2-authorize) — it is part of the same page
as the username and password, so a tenant offers both and the person chooses.
It is rendered only where `ODUDU_PUBLIC_BASE_URL` is set; without it there
is no relying party id and nothing behind the button, so there is no button.

The `<noscript>` is not decoration. The `assertion` field is empty until a
script fills it, and a browser with JavaScript off can still press that
button — so an empty field is treated as **no attempt at all** rather than a
failed one, and the login falls through to the password exactly as if the
button had not been pressed. Reading it as an attempt would hand the
ALTERNATIVE group to a factor nobody could satisfy.

**No transcript here was executed, and this page does not show output for it.**
The same limit applies as to [Enrolling a passkey](./enrolling-a-passkey.md),
for the same reason: only `navigator.credentials.get()` inside a browser,
talking to an authenticator, can produce an assertion — `curl` cannot sign one,
and inventing a response body would make this section a claim dressed as
evidence. What is verified instead is an integration test, which drives the
whole journey against real PostgreSQL with a software authenticator producing
real ES256 assertions, and checks each step and each refusal below. The steps
are that test's steps, and the server-side behaviour is what it asserts.

What the flow is, stated rather than shown:

1. The page posts `auth_session_id` to `POST
/tenants/{tenant}/login-actions/passkey-challenge` and gets request options
   back as JSON. They carry a challenge and **no `allowCredentials`**, which
   is what tells the browser to offer every discoverable credential it holds
   rather than a list the server would have needed a username to build.
2. **The challenge is on the authentication session, not in the page.** It
   is issued per press rather than with the page, so a form left open
   overnight still gets a live one, and a rejected attempt can try again
   with no re-render.
3. The page posts the assertion JSON back to
   `/tenants/{tenant}/login-actions/authenticate` in an `assertion` field,
   with the same `auth_session_id` — the same endpoint the password uses.
4. **Who is signing in comes from the assertion, before anything is
   verified.** The credential id it carries is what enrolment stored as
   `lookup_key`, and reading that back is tenant-scoped by RLS, so a
   credential from another tenant resolves to nothing rather than to somebody
   else's subject. Resolution has to come first because verification needs
   the stored public key and counter as inputs.
5. The server reads and clears the challenge in one statement, then verifies
   the assertion against it — origin, relying party id, signature, and the
   authenticator's user-verified flag, which is required for a passkey made
   under a policy that required it, and every passkey was before the tenant
   could choose (the `webauthn_user_verification` setting, whose default is
   `required`).
6. The signature counter must have advanced past the stored one, or the
   credential is answering from two places at once. The write is a
   compare-and-swap, so two assertions replaying one counter value cannot
   both pass, and it happens only after the login is confirmed to be for the
   subject this attempt is already bound to.
7. The session records `passkey` alone, and the ID token says `amr: ["hwk",
"user"]`, `acr: "2"`. **A tenant with `otp_required` on does not ask for a
   code after a passkey, and does not make the subject enrol one either** —
   enrolment demands a discoverable credential with user verification, so an
   assertion is possession of a key plus a check of who held it. That is two
   factors, and `otp_required` is a floor rather than a tax.

   A passkey made where the tenant allowed `preferred` or `discouraged`, and
   asserted without the user-verified flag, is possession alone. The session
   then records `passkey` and `passkey-unverified`, the ID token says
   `amr: ["hwk"]` and `acr: "1"`, and the second factor applies as it does
   after a password. Like the enrolment above it, this was run by an
   integration test and not against a stack: `curl` cannot sign an assertion.

Refused, each for its own reason:

- An assertion whose counter did not increase. One that reports zero from a
  credential whose stored counter is also zero **is** accepted: WebAuthn
  §6.1.1 permits an authenticator that never counts, and refusing it would
  refuse a conformant device rather than catch a clone.
- An assertion replayed after a successful login — the challenge it answered
  was cleared by the statement that read it, so there is nothing left to
  verify against.
- An assertion for a credential enrolled in another tenant.
- An assertion the authenticator did not verify anybody for, from a passkey made where verification was required.
- An assertion whose credential id names nothing in this tenant, which
  answers exactly as a wrong password does: `invalid_credentials`.
