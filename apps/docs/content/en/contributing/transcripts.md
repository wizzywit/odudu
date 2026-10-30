---
title: How the transcripts are captured and checked
description: How the recorded request, admin and console transcripts were captured against running stacks, and the tests that keep them true to the server.
---

# How the transcripts are captured and checked

The transcripts under [Reference](../reference/transcripts/index.md) are real
output. This page holds what a contributor needs to know about how each set was
captured: the stacks, the commits, the conventions that keep a transcript honest, and
the tests that read them.

## Request path transcripts

Every endpoint Odudu serves today, what a client does with each answer, and
what happens on each way a request can go wrong. Every command below was run
and every response is the one that came back. Unless a block says otherwise
the run was against the compose stack (`infra/docker/compose.yaml`); the
bootstrap and a full authorization-code exchange were additionally run in
each of the other two ways of running the server, which
[Pick how you are running it](../reference/transcripts/request-paths/bootstrap.md#pick-how-you-are-running-it) sets out.

Every command is written against `http://localhost:3000`, the port the compose
file publishes by default. A block that was captured on a stack publishing
another port says so in the command itself, and the port in its output is that
stack's: the blocks re-run for the sign-in refusal message, the passkey
button's spacing and the throttle page ran on the project `odudu-17h` on port
`3171`, built from the branch commit `a92240a1` plus the documentation, started
with `ODUDU_THROTTLE_LIMIT=1000 ODUDU_LOGIN_THROTTLE_LIMIT=1000` unless a
block says otherwise.

The `content-security-policy` lines in these guides gained `style-src 'self';
font-src 'self'; img-src 'self'` when pages began linking a same-origin
stylesheet (ADR 0029's amendment). Each page kind was checked against a live
stack on that change (the authorization form, an error page, the logout
confirmation, the console shell), and `tests/docs/page-csp-transcripts.test.ts`
holds every recorded line in all three guides to what `pageHeaders` sends.

Every page document in the three guides now shows the shared shell (the
Instrument stylesheet, the mark and one `<main>`), and every page response
carries `x-content-type-options: nosniff`. That was applied to the recorded
documents by wrapping each in the shell, and to each `content-length` by the
shell's 490 extra bytes, which a live response confirmed (the unknown-client
error page, 704 bytes, on the project `odudu-p4g-12`); those guides were not
replayed end to end. The test above holds the headers of every recorded block,
`nosniff` included. Every page response also carries `content-language`, the
negotiated page language (`en` in every recorded block, since only `en` is
shipped); it was added to the recorded blocks by hand, after `nosniff` where
`pageHeaders` places it, and a live login-page response on the project
`odudu-p4g-13b` confirmed its value and position.

A page follows the colour the person chose in the console. The console writes
the cookie `odudu-theme` (`light` or `dark`; it expires it for `system`), and
every page's `<html>` names that value in `data-theme` and nothing else: with no
cookie, or one holding anything but exactly `light` or `dark`, there is no
attribute and the page follows the operating system, so the recorded documents
below are the bytes served without it. The cookie is a preference, not a secret
or an identifier; the pages are `no-store`, so no `Vary` is needed. Two cases
give no theme that a reader might expect to: the name present twice (a cookie
planted at another path or domain cannot choose), and a `Cookie` header over
8,192 characters (the cap that bounds what a public page parses). Captured
against the project `odudu-p4g-theme`, a new stack with the tenant `acme`
seeded and nothing else:

```
$ U=http://localhost:3180/tenants/acme/protocol/openid-connect/logout
$ PAD=$(printf 'x%.0s' $(seq 1 9000))
$ curl -s "$U" | grep -m1 "<html"
<html lang="en" dir="ltr">
$ curl -s -H 'Cookie: odudu-theme=dark' "$U" | grep -m1 "<html"
<html lang="en" dir="ltr" data-theme="dark">
$ curl -s -H 'Cookie: odudu-theme=LIGHT' "$U" | grep -m1 "<html"
<html lang="en" dir="ltr">
$ curl -s -H 'Cookie: odudu-theme=x"><script>' "$U" | grep -m1 "<html"
<html lang="en" dir="ltr">
$ curl -s -H 'Cookie: odudu-theme=light; odudu-theme=dark' "$U" | grep -m1 "<html"
<html lang="en" dir="ltr">
$ curl -s -H "Cookie: odudu-theme=dark; pad=$PAD" "$U" | grep -m1 "<html"
<html lang="en" dir="ltr">
$ curl -s -H "Cookie: pad=$(printf 'x%.0s' $(seq 1 3000)); odudu-theme=dark" "$U" | grep -m1 "<html"
<html lang="en" dir="ltr" data-theme="dark">
```

The text of the server's own pages now comes from a message catalogue, and a
value somebody else wrote (a client's name, an account's name, a scope label,
an error description) is wrapped in `<bdi>` after it is escaped. Three things
changed in the recorded documents as a result: those values sit inside
`<bdi>…</bdi>`, an apostrophe in a page's own text is `&#39;` (`Can&#39;t
continue`) where it was a bare `'`, and the passkey script reads its three
sentences from `data-` attributes of its form instead of holding them. The
login page with and without a refusal, the error pages (restart link, no row,
unknown client, `415`), the logout confirmation, `Can&#39;t sign out`, the
two consent screens (the second with its client registered through dynamic
registration), the account chooser and the unverified-email page were
each run again on the project `odudu-p4g-14`; every changed line and every
changed `content-length` in the recorded blocks is the byte-for-byte result of
that change, checked against those runs, and the blocks were not replayed end
to end. The two consent screens in [the admin paths](../reference/transcripts/admin-paths/index.md) were
re-run the same way on that project, and `tests/docs/page-documents-transcripts.test.ts`
now renders each recorded consent, chooser, error, logout and throttle body back
through the real renderer. Every sentence from the catalogue sits in `<bdi>` on
the error page too, not only text somebody typed, since the page cannot tell them
apart. The sign-in refusal comparison under
[A refused login says so](../reference/transcripts/request-paths/path-a-authorization-code-with-pkce.md#a-refused-login-says-so) is a fresh run.

The pages then took one card width and a visual pass, which
[docs/phases/p4g.md](https://github.com/wizzywit/odudu/blob/main/docs/phases/p4g.md#server-pages-the-visual-pass) records. In the
recorded documents that is: the shell opens with `<p class="brand">`, the mark
beside the word `odudu`; a page that knows its tenant puts its `<h1>` in
`<header class="intro">`, with the tenant in `<p class="tenant">` and, on a
sign-in form whose parked request names a client, the line
`to continue to <bdi>…</bdi>`; a refusal is `<p class="alert" role="alert">`;
the update-password violations sit in `<div class="alert" role="alert">`; and
consent's Deny, the chooser's buttons and the passkey button carry classes. That
was applied to the 53 recorded documents and their `content-length` lines by a
script over the documents as they stood, not by replaying the guides end to end.
Seven runs on the project `odudu-p4g-vis` were compared line for line with the
matching recorded document, session ids, ports, secrets and nonces masked: the
sign-in form, the refused sign-in, the TOTP enrolment, the recovery codes, the code
form with and without a refusal, and the update-password page, whose tenant name is
the only difference. The console's sign-in form names its client `Odudu
administration`, the name of the client whose `client_id` is `odudu-admin`.

The authn-flows pages read their text from a catalogue of their own too. The
two that changed in these recordings are the authenticator enrolment page and
the recovery-codes page: the key URI, the key and each recovery code are
wrapped in `<bdi dir="ltr">` so a right-to-left page does not reorder them, which
adds 42 bytes to the first and 210 to the second (`content-length` 1568 to 1778
and 1656 to 1866). The enrolment page, a wrong code, and the recovery codes
page that follows were run on the project `odudu-p4g-15` and the blocks edited
to match (the codes, secret and session id in the blocks are those of the
earlier run, not that one); the change-password pages are byte-for-byte what
they were. `tests/docs/page-documents-transcripts.test.ts` also renders each
recorded enrolment, recovery-codes and change-password body back through its
renderer, with the QR image elided as the blocks show it.

The account pages (registration, verification, reset and the required-actions
link) and the console's sign-in refusal read from catalogues as well. Their
recordings changed only where a page's own text holds an apostrophe, now
`&#39;` (`Can&#39;t create this account`, `we&#39;ve sent`, `This link
can&#39;t be used`): 11 lines. The registration pages, the reset request, form, weak-password, success and
spent-link pages and the verification pages were run again on the project
`odudu-p4g-16` against a tenant with registration, verification and reset on,
and each recorded body that run produced matches the recorded one line for
line; the not-reused reset page and the required-actions pages are what they
were and were not re-run live. The test above now renders these bodies back through their
renderers too.

Values that change on every run — authorization codes, tokens, `jti`,
session ids, timestamps — are shortened or truncated where they appear, and
that is said each time. Nothing here is reconstructed from what the code
looks like it should do.

Three conventions that keep that promise checkable. A fenced block holding a
response **carries no language tag**, because a tagged one is reformatted by
Prettier and what a reader then sees is the formatter's markup rather than
the server's — the bytes below are the bytes served, line breaks included.
Node prints two `ExperimentalWarning` lines about its Web Crypto API on
every CLI invocation; they are on `stderr` and are trimmed from every
transcript here. And a section whose output depends on the state of the
stack it ran against **says which state** — [Retention](../reference/transcripts/request-paths/retention-what-odudu-reap-removes.md),
the second [lockout](../reference/transcripts/request-paths/brute-force-lockout.md) run and
[the throttle](../reference/transcripts/request-paths/brute-force-lockout.md#the-per-origin-throttle) each do. Everything else was run in
the order it appears, front to back, against one stack started with
`ODUDU_THROTTLE_LIMIT=1000 ODUDU_LOGIN_THROTTLE_LIMIT=1000`: a scripted
walkthrough of a whole document sends more requests a minute than the budget
a person needs ([the per-origin throttle](../reference/transcripts/request-paths/brute-force-lockout.md#the-per-origin-throttle), and
[the per-username one](../reference/transcripts/request-paths/brute-force-lockout.md#the-per-username-budget-on-sign-in) for one user
signing in again and again), and every transcript past the tenth would
otherwise be a `429`.

The unverified sign-in block in Self-registration was run again when the page's
sentence was shortened. It ran on the project `odudu-p4g-31p` on port `3197`, on a
tenant made for it with `registration_allowed` and `verify_email` on, and `ada`
registered with the same password as above. Only its request id, length and date,
and that sentence, differ from the earlier capture.

The `GET /admin/openapi.json` block was run again when the subject delete's description
grew. It ran on the project `odudu-p4g-31p` on port `3197`, a freshly built stack.

It ran again when the `If-Match` rule was reworded, and a third time when it was stated on the two `PATCH` routes: on the project `odudu-p4g-consolefix`,
port `3480` in place of the `3197` the command shows, a freshly built stack.

Registration, the reset request, the reset form and the actions form then began to
come back as the same form when they refuse, and the sign-in form began to offer the
pages beside it. The blocks that show those responses were run again against a stack
of the branch, the project `odudu-p4g-31g` on port `3195` (throttles at `10000`), and
the blocks' text now names that port and the sessions and keys of those runs: in
Self-registration the refused username, the taken address, the short password with one
rule and with three, the two password-containing-the-name refusals, the duplicate
address under the audit tenant and the new section on the way
there and back; in Password reset the refused password and the unchanged-password
refusal; in A refused login says so the refused page and the diff between the two
refusals; in Two-factor authentication the replayed enrolment code, run against a
second tenant `otp2-demo` seeded like `otp-demo`; and in Recovery codes the two
refusals of a code already spent and of one nobody holds. The audit section of
Self-registration was run again whole, on the same stack, tenant `signup-audit`, so its
keys, subject ids and audit rows are that run's. The rest of each page and the keys of
the sections around those blocks stand as the earlier runs left them. The required-actions link page, the change-password page and the reset
success page are byte-for-byte what they were, and were not run again.

A mailed link then stopped carrying the request, and the sign-in page began to set a cookie
naming the request it parks. The blocks that show those were run on a stack of the branch, the
project `odudu-p4g-31m` on port `3197` (throttles at `10000`), on tenants `demo`, `register-demo`
and `back-demo` created for them: in Path A the whole response to the authorization request of
section 2 (so the page body there is also what the server serves now, where its passkey script had
changed since the earlier run), in Self-registration the part of the way there and back that reads
the mailed link, and in Password reset the new section on coming back to the application. Their
keys, sessions and times are that run's, and the rest of each page stands as the earlier runs left it.

The pages then linked the brand favicon, `favicon.svg` and `favicon.ico`, in place of the bare mark: two
`<link rel="icon">` lines in every recorded page document and 66 more bytes in each `content-length`.
That was applied to the 16 pages that show a document by a script. The rest of those transcripts' bytes
did not change and they were not replayed end to end.

The change was checked against a live stack of the branch (project `odudu-p4g-31n`, port `3181`,
commit `15c09936`), by running the console's browser specs for the server pages, the refused sign-in,
the relying-party flow, the return to the application, the restarted sign-in and the console shell
with every HTML response saved. For each page kind a transcript quotes, the real `<head>`, from
`<!doctype html>` to `</head>`, is byte for byte the recorded one: Account created, Account updated,
Allow access?, Can&#39;t sign out, Can&#39;t use this link, Change your password, Check your email,
Choose a new password, Choose an account, Create account, Enter your authentication code, Password
reset, Save your recovery codes, Sign in, Sign-in error, Sign-in failed, Signed out and Verify your
email. Five whole documents (`Can&#39;t sign out`, `Password reset`, `Signed out` and the four
`Sign-in failed` ones) are identical to a live response, so their `content-length` is the served one too.
The `Too many attempts` and `Update your account` pages were not reachable in that run and are checked
only by the test below. The recorded console shell in `GET /console/` is an older capture that never had
the icon links; this change did not touch it.

`tests/docs/page-documents-transcripts.test.ts` proves a recorded document is the shell `page()` builds
around its title and body, and that its `content-length` is the length of the bytes shown. It does not
prove the bytes were served; the live comparison above is what does.

The password pages then gained a list of what a password needs, a small script that ticks it and says a
summary in a status line, and the `id`, `minlength`, `spellcheck`, `autocapitalize`, `autocorrect` and
`aria-describedby` of the field, and a new tenant's minimum became 15 characters.
That changed 15 recorded blocks in five transcripts: Getting the token (the change-password page),
Self-registration (eight, one of them a `grep` of a page), Following a required-actions link, Password
expiry and changing a password (the page and a trimmed excerpt, now a `grep`), and Password reset. The refusal sentences read "at least 15", the
`myADApassword` examples became `myADApassword2026` so they still break only the two rules they show,
and the `GET /settings`, range and export transcripts show `password_min_length` of 15 for a new tenant,
with the `ETag` and `content-length` of a live response.

Every changed block was run again on the branch's stack (project `odudu-p4g-31o`, port `3187`, commit
`64d30b79` plus this increment's documentation) on tenants made for it: the same tenant settings, the same password, the same submission. Each
recorded block equals the live response line for line once its ids, nonces, dates and tenant names are
masked, and each header (the `content-security-policy` with its `script-src` nonce included) is the one
served. The recorded nonces, ids and times are those of the earlier runs, except the nonces of the pages
whose script was added, which come from live responses. The `ETag` of the first `GET /settings` is the live
one.

Every command in the 26 pages of this directory was then run again, in the page's own order, against the
image built from `main` at `758fdb6e`: Bootstrap, Path A, the account pages, Paths B and C, the CORS, branches, mail and documentation
pages on the compose project `odudu-p4g-rerun-request-paths` (port 3611, a fresh volume), Retention on its own
fresh stack (`odudu-p4g-rerun-ret`, 3612) and RP-initiated logout, Brute-force lockout and Path D on a third
(`odudu-p4g-rerun-lo`, 3613). Each output was compared with the block after it, ports, ids, times, nonces and
tokens masked and `content-length` not. Where a block differed it was written again from the run, and where a
command could not have printed its block as written the command was corrected; a block that shows part of a
response says so. `docs/phases/p4g.md` lists, page by page, what was identical, what changed and what was not
run again.

The 73 pages of the admin paths were run the same way, in index order on one fresh stack (compose project
`odudu-p4g-rerun-admin-a`, port 3650) built from `main` at `9b81712c`, so a tenant holds what the pages above it
left. The pages that name a tenant's state say how it was made; where a page showed a response cut by hand,
the command now cuts it or the whole response is shown, and a page that showed fewer commands than answers
now shows each one. The audit bound page ran against 12,000,000 rows inserted as the database owner.
Bootstrap's host mode (Postgres in a container, the server from the source on a high port) and no-Docker mode
(a throwaway PostgreSQL 18.6 cluster) were run for real afterwards, and the `/token`, login POST and
`/userinfo` tables in The branches were run row by row.

The authorization and token endpoints now send an `error_description`. A block that quotes one shows the
real body or query from a live capture on a stack of this branch (project `odudu-p4g-31r`, port `3197`),
with its `content-length`. The blocks were not replayed from the top, so the keys,
times, ids and ports around an updated line are the earlier runs'. The state-less redirect in the branches
and the two responses on the CORS page were run on that stack, and their commands say so.

The two lines that had been typed from the shared redirect, the `consent_required` redirect and the
`access_denied` that follows a refused consent, are captured now. `odudu seed client --consent-required`
made a client that asks, and both ran against it on the project `odudu-p4g-31k`, port `3199`, commit
`7cf7b4db` plus this increment's documentation, on a tenant `demo` with `ada` seeded. The consent screen
that precedes them was captured in the same run, and is the page the transcripts quote, apart from the
client's name and the `content-length` that follows from it.

A registration under `verify_email` then stopped creating the account until its link is confirmed, a
held address began to be answered as a free one is, the form gained a confirmation field, and a link
began to ask before it acts. Self-registration was run again whole, block by block in the page's own
order, on the project `odudu-p4g-31k` on port `3199`, commit `869edbf7` plus this increment's
documentation, on a freshly built stack with throttles at `10000`. Each command is the block's own with
the port named and the confirmation added, so every response, page, mail capture and listing is that
run's. The mail is the capture the stack's log wrote (no SMTP host is set), and each listing is scoped to
its tenant. The sign-in page and registration-link blocks of the "way there and back" section that only
read the sign-in page were not changed and not run again. The earlier run of Path A's address verification
(a sign-in's ID token before, two visits, two presses, the ID token after) stands: that flow did not
change. The retention transcript and the reap report were run again for the new
`pending_registrations` key, on a fresh stack driven as that page describes, with one more block that adds
two pending rows. The password pages' shared script is unchanged; the registration form carries a second,
short one that shows the confirmation with the password.

`prompt=create` then began to answer with the registration page, and the discovery document gained
`prompt_values_supported`. The new Self-registration section, "Starting at the registration page", ran
on the project `odudu-p4g-31l` on port `3331`, commit `0f573be5` plus this increment's code and
documentation, a freshly built stack with throttles at `10000`, on `register-demo` seeded as that page's
first block does with its three settings on, and on `closed-demo` seeded with the same client and
nothing set; its commands name the port. Path A's section 1 was run again on that stack too, and its
recorded output differs from the live one in exactly two ways: the new member, which was added, and the
host port, which the recorded block keeps at `3000`. That block is an exception to the convention above
on purpose: `tests/docs/discovery.test.ts` compares the recorded document, member for member, with the
one the server builds for `http://localhost:3000`, and a block showing `3331` in its issuer would fail
it. Every other line of that document was confirmed identical.

Logout always asks, and the transcripts that showed a `GET` with an ID token hint ending a session were run
again for it: [RP-initiated logout](../reference/transcripts/request-paths/rp-initiated-logout.md) (the opening
section, the expired-hint section, introspection and revocation, the same request over `POST`, the `client_id` that
disagrees with the hint, the front-channel frames and the matched redirect after them) and
[Following the logout redirect](../reference/transcripts/console-paths/following-the-logout-redirect.md). They ran on
the compose project `odudu-tx`, a fresh stack with `demo`, `demo-spa`, `demo-post`, `ada` and, for the console page,
`grace` seeded, published on port `3191`, built from the branch `p4b/b-logout` at `fa7f01b3` plus the working tree
that the commit after it records. The opening section ran with a local TCP forward from port `3000` to `3191`, so its
commands read against `3000` as the guide that excerpts them does; every other re-run block names `3191`. Blocks
elsewhere on those pages, such as the deliveries queue after the front-channel logout and the offline-access
section, keep the output they had: the deliveries queue was queried again on this stack and answered as recorded.

The logout form's token then began to cover its `client_id`, `post_logout_redirect_uri` and `state` (ADR 0047). The
section on [a form edited after it was issued](../reference/transcripts/request-paths/rp-initiated-logout.md#a-form-edited-after-it-was-issued)
was captured for it, the opening section's two requests and the front-channel section's confirming `POST` were run
again, and the guide [Refresh and end a session](../guides/refresh-and-end-a-session.md) now carries the opening
section's output. They ran on a second `odudu-tx` compose project on port `3191` (the first was removed), a fresh
stack with `demo`, `demo-spa`, `demo-post` and `ada` seeded and `reports-widget` added for the front-channel
request, built from the branch `p4b/b-logout` at `0d739434` plus the working tree that the commit after it
records. The opening section ran through a local TCP forward from port `3000` to `3191`, as before, which is why
its output shows the full headers of a live response. Other blocks on those pages keep the output they had.

A client then gained `skip_logout_confirmation` (ADR 0047). The new sections were captured live: [a client may skip
the page](../reference/transcripts/request-paths/rp-initiated-logout.md#a-client-may-skip-the-page) and [turning the
logout confirmation off for one client](../reference/transcripts/admin-paths/patch-clientsid.md#turning-the-logout-confirmation-off-for-one-client),
on a throwaway compose project, `odudu-skip` on port `3193` (removed afterwards). Every block that shows a client's
representation or its `ETag` was then **run again**, so none of them is edited: on a second throwaway project,
`odudu-skip2` on port `3194` with `ODUDU_THROTTLE_LIMIT=1000 ODUDU_LOGIN_THROTTLE_LIMIT=1000`, a fresh stack built from
`p4b/b-logout` at `b68568f9` plus the working tree that the commit after it records, removed when the capture
finished. The system administrator `ada` made by `seed admin` supplied `$ADMIN_TOKEN`. The state each block needs was
made by the admin API (`POST /admin/tenants`, `POST /clients`, `PUT /groups/{id}/roles`, `PUT /smtp`, the key
rotation), and the ids the blocks name are that run's: on `GET`/`POST /clients` the tenants `demo` and
`client-facts-demo`, the listing, the search and its cursor; on `PATCH /clients/{id}` the `billing` blocks of
`client-limits-demo` and `client-pages-demo`, `demo-operator`'s `ETag` chain and the disable pair in
`client-facts-demo`; the rotation of `demo-backend` on `POST /clients/{id}/secret`; the scope removal on `DELETE
/scopes/{id}/clients/{clientId}` (its second `/authorize` command names port `3194`, so the `iss` in its output
matches it, and an `echo` between the read and the second removal keeps the status line off the end of the body); the
three `client.create` listings, the signing-key and refused listings and the id lookup on `GET /audit`, in a tenant
`audit-demo` holding `demo-backend` with a `jwks`, `demo-app`, the refused `odudu-admin` and one key rotation, and a
tenant `resource-audit`; the export of `export-demo`; the `odudu-admin` read in "Getting the token"; and the three
blocks of the OpenAPI page, whose `content-length` is that build's. Where a block's command named an older
id, tenant or `ETag`, the command was rewritten to this run's, and the text around it was left. The other blocks of those
pages stand as their earlier runs left them. The two console pages, [`POST
/console/auth/logout`](../reference/transcripts/console-paths/post-consoleauthlogout.md) and [following the logout
redirect](../reference/transcripts/console-paths/following-the-logout-redirect.md), ran on the same stack with `grace`
seeded in the `system` tenant and signed in to the console, and the second now shows the console's client signed out at
once, with no confirmation page; the log filter on the first selects the request's own `reqId`, so the stack's health
probes do not appear.

The branding and mail transcripts were run again on one stack: [the theme routes](../reference/transcripts/admin-paths/get-theme-put-theme-and-the-theme-routes.md),
[the mail preview and branding](../reference/transcripts/admin-paths/get-mailpreview-and-get-mailbranding.md),
[the message overrides](../reference/transcripts/admin-paths/get-message-overrides-put-message-overrides-and-delete-message-overrides.md),
[the SMTP test](../reference/transcripts/admin-paths/get-smtp-put-smtp-delete-smtp-and-post-smtptest.md) from its client section on,
[the tenant import](../reference/transcripts/admin-paths/post-admintenant-imports.md),
[the themed sign-in](../reference/transcripts/request-paths/a-themed-sign-in-and-the-brand-route.md) and
[the OpenAPI document](../reference/transcripts/admin-paths/get-adminopenapijson.md), which went last. The stack was the
compose project `odudu-p4b-tx` on port `3000` (`ODUDU_THROTTLE_LIMIT` and `ODUDU_LOGIN_THROTTLE_LIMIT` at `10000`), built from
commit `966da152`, a freshly created volume with `ada` made by `seed admin`, and a Mailpit as the
deployment's own sender (`ODUDU_SMTP_HOST`, its web port on `8725`, `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true`). Each page ran in the
order it is written, a tenant of its own made new each time, and every output in it is that run's. The 96 by 32 pixel logos, the
640 by 360 pixel background and the 540 by 540 pixel image of random colour were made for the run. The `429` in the SMTP page ran
after the container was recreated with `ODUDU_THROTTLE_LIMIT=3`, and the stack was put back to `10000` afterwards. The brand
guide's stylesheet response was taken from the guide's own steps run on that stack.

## Admin path transcripts

The admin API: the endpoints under `/admin/tenants/{tenant}/` that let an
operator manage a tenant instead of reaching for `psql`.

Three artifacts describe this API and each has one job. The published
OpenAPI document, served unauthenticated at `/admin/openapi.json`, is the
**reference** — generated, and the place every endpoint and every field is
listed exhaustively. This document is the **narrative** — an operator's
journey through a task, in the order they would actually hit it, with the
shape of each request and, once a live stack has been brought up to capture
it against, the real response. [Getting the token](../reference/transcripts/admin-paths/getting-the-token.md) is the **entry
point** — how to get a token that can call any of this at all.

There is one list of what is missing or refused for the whole server, and it
stays in [the roadmap](../roadmap.md#later);
this document never starts a second one. An admin endpoint that does not do
yet what its name suggests says so in its own section below, and points at
that list rather than duplicating it.

Every transcript below is captured output, and follows the same discipline
as [the request paths](../reference/transcripts/request-paths/index.md): a fenced block holding a
response carries no language tag, a section whose output depends on the
state of the stack it ran against says which state, and a precondition a
refusal depends on is shown rather than asserted.

**Reproducing a run that signs in repeatedly.** Several stacks below are
described as started with `ODUDU_THROTTLE_LIMIT=1000` (or `10000`) so a
scripted run of sign-ins is not refused. Those captures pre-date the
per-username sign-in budget, which refuses a sixth submission naming one
username from one address inside a minute
([ADR 0023](https://github.com/wizzywit/odudu/blob/main/docs/adr/0023-brute-force-authority-is-split.md)); to run any of them
again, start the stack with `ODUDU_LOGIN_THROTTLE_LIMIT=1000` as well. The
transcripts themselves are unchanged.

**The stack.** One run of `infra/docker/compose.yaml`, brought up from an
empty volume, with `odudu seed admin --username ada` run against it and a
tenant named `demo` created through `POST /admin/tenants` below. The
sections are in the order they were executed, so the ids, secrets, `ETag`s
and timestamps in them are one run's real ones and refer to each other:
`demo` is `01a0d6fc-3626-7e23-94d7-3b1b666e278f`, `ada` in the `system`
tenant is subject `01a0d6fb-0918-7846-b430-0a714b8bf7bf`. Secrets shown
here are that stack's, and it was torn down with `docker compose down -v`
when the capture finished.

**The second stack.** The sections that turn on `If-Match` being
mandatory, and the tenant and SMTP sections that describe endpoints added
after the first capture, ran against a second stack brought up the same
way from an empty volume: `seed admin --username ada`, then `demo` created
through `POST /admin/tenants`, then a subject `grace`, a role
`billing-viewer`, a group `engineering` and a scope `billing` created
through the endpoints below. Its `demo` is
`01a0d7ee-b611-71a0-b223-5a57ecbe83d8` — a different run, so its ids,
`ETag`s and timestamps refer to each other and to nothing in the sections
above. Each such section says so. It was torn down the same way.

**The third stack.** "Getting the token" was captured again, after the
session cookie gained its secret (`0071_session_secret.sql`), against a
stack brought up the same way from an empty volume with only
`seed admin --username ada` run against it. Its password, ids, code and
cookie are that run's own: its `ada` is
`01a0de12-c116-70ee-9cc1-984429980dcc`, not the subject the sections after
it name. "Getting the token" has since been captured once more, on a stack of
its own, and says so.

**The fourth stack.** "Getting the token"'s final probe and `GET /whoami`
were recaptured together (the first has since been captured again with the
rest of that section), after `whoami` started answering `capabilities`
and `crossTenant`, against this branch's own already-running development
stack rather than a fresh one — it was not brought up for this capture and
was not torn down afterward. It carries a tenant also named `demo`, under
its own id, `01a0db22-1c32-7d17-b351-697d7911033c` — a different tenant
from the one the sections above and below this note refer to by that same
name. `seed admin --username ada-whoami` run against it created the
subject behind the `GET /whoami` probe, `01a0e0a7-0ead-703a-ab34-22bcf5167d46`, rather
than reusing the existing `ada` whose password from this stack's own
history is not known here; its capabilities come from holding
`tenant-admin`, which composites every capability plus `manage-tenants`
(the same account "Getting the token" describes `ada` as). The searches
under `GET /subjects` and the two refusals under `POST /subjects` were
captured against it later, as `ada-whoami`, after its `odudu` service was
rebuilt from this branch; the searches under `GET /admin/tenants` and
`GET /clients` after a further rebuild that applied `0074`; and those under
`GET /roles`, `GET /groups`, `GET /scopes` and `GET /keys` after one that
applied `0075`, against roles and groups created in `demo` for them
through the endpoints below, as each of those sections shows (the role and
group ones, and the composites and defaults after them, have since been
recaptured on the fourteenth stack, and say so). The counts
under `GET /admin/tenants/count` were captured against it after a further
rebuild, as that section says. The memberships under `GET /subjects/:id/groups` were captured
against it after one more rebuild, in a tenant of their own, as that
section says. So were the composites under `GET /roles/:id/composites` and
the defaults under `PUT /roles/:id/default`, after a further rebuild, in a
tenant `composites-demo`. `DELETE /scopes/:id/clients/:clientId` was
captured against it after one more rebuild, as a new admin subject
`ada-scope-unassign`, in a tenant `scope-unassign-demo` created for it; its
built-in admin client guard and `DELETE /scopes/:id`'s `openid` guard were
captured together after a further rebuild, as the same subject, in a
tenant `scope-guard-demo` created for them. `GET /subjects/:id/profile`
and `PATCH /subjects/:id/profile` were captured after one more rebuild, as
a new admin subject `ada-profile` in the system tenant, in a tenant
`profile-demo` created for them, on a subject `grace` created there; the
same section was recaptured after a further rebuild fixed the write-order
and locking review found in it, as the same `ada-profile`, in a fresh
tenant `profile-demo2`, on a new subject also named `grace`; the two
resubmit-the-same-number calls at the end of it were added after one more
rebuild narrowed the reset rule to a different number, against that same
`profile-demo2` tenant and subject, continuing where the recapture left
off. `GET /subjects/:id/consents` and `DELETE /subjects/:id/consents/:clientId`
were captured after a further rebuild, as a new admin subject
`ada-consents2` in the system tenant, in a tenant `consents-demo2` created
for it, on a subject `grace` seeded there with `odudu seed user` and a
confidential client `consents-demo-app2` created with `consent_required`
— recaptured entirely, under this tenant, after a further rebuild made
`DELETE` also revoke the subject's grants against the client.
`DELETE /subjects/:id/lockout`, `DELETE /subjects/:id/sessions` and
`POST /subjects/:id/password` were captured in that order after one more
rebuild, with the `odudu` service alone started with
`ODUDU_THROTTLE_LIMIT=1000` (and, to reproduce it now,
`ODUDU_LOGIN_THROTTLE_LIMIT=1000`) so a scripted run of sign-ins is not
refused by the per-origin throttle, as a new admin subject `ada-recovery` in the
system tenant, in a tenant `recovery-demo` created for them, on a subject
`hana` seeded there with `odudu seed user`, and, for the target ceiling,
subjects `mo` and `lin` seeded beside it. The service was restarted
without that override afterwards, so the stack is back to its default
throttle of ten. The `demo-fields-check` create and read under
`POST /clients` were recaptured after a further rebuild added
`builtin_admin` and `service_subject_id` to a client's representation, as
`field-facts-admin`, a new admin subject in the system tenant — the client
was deleted and recreated under the same `client_id` in `demo`, so its row
id, secret and timestamp are later than the rest of this section's.
`GET /settings` and `PATCH /settings`, and the rename under
`PATCH /subjects/:id`, were recaptured after one more rebuild that applied
`0077_username_editable.sql`, as a new admin subject `ada-rename` in the
system tenant, in tenants `settings-demo` and `rename-demo` created for
them, as each section says. `GET /export` was captured after one more
rebuild, as a new admin subject `ada-export`, in a tenant `export-demo`
created for it, as that section says; its audit-trail queries were later
recaptured, scoped by `from=$RUN_START` instead of left unscoped, as a
further admin subject `ada-export2` against that same tenant, without
rebuilding the stack. `POST /admin/tenant-imports` was captured after one
more rebuild, as a new admin subject `ada-import`, from a tenant
`import-source` created for it into a tenant `import-demo`, as that
section says; its own unscoped audit-trail query was later recaptured,
scoped by `resource_type`/`resource_id`, as a further admin subject
`ada-import2` importing into a new tenant `import-demo2` from the same
`import-source`, again without rebuilding the stack. The range refusals
under `PATCH /settings` were captured after a further rebuild, as the same
`ada-import`, in a tenant `settings-range-demo`; the rest of that section
was not re-run.

**The fifth stack.** The sections this note names were captured against a
stack of their own: compose project `odudu-task2`, published on port 3080,
built from this branch and brought up from an empty volume with
`seed admin --username ada-t2`, each section after a rebuild that added
what it describes. It was torn down with `docker compose down -v` when the
capture finished. They are "A refusal names its field", the `ETag`
sections under scope assignment and signing keys, `GET /scopes/:id/clients`,
"Filtering by capability", "The last administrator", "The authenticators a
step may name", "The owning client, by name", and the OpenAPI entry under
`PUT /scopes/:id/clients/:clientId`.

**The sixth stack.** Every transcript whose output changed once a `400`
named its field under `errors`, a create answered its `ETag`, SMTP reported
`effective`, a flow answered `available` and a role named its owning
client was captured again against one more stack (the role and group ones
since recaptured on the fourteenth, and saying so): the same compose project
`odudu-task2` on port 3080, brought up from an empty volume built from this
branch, with `seed admin --username ada` run against it and every tenant,
client, role, group, scope and subject a section names created there
through the endpoints below — each section says which. Its `demo` is
`01a0ea4c-0884-74fa-825c-05f6ef568dd0`, a different tenant from the other
stacks' `demo`s. It was torn down with `docker compose down -v` when the
capture finished. A section that says it was captured against it refers
to nothing on the stacks above.

**The seventh stack.** `GET /subjects/:id/lockout` and
`DELETE /subjects/:id/recovery-codes` were captured against a stack of
their own: compose project `odudu-t8` on port 3080, built from this branch
with both routes in it and brought up from an empty volume with
`ODUDU_THROTTLE_LIMIT=1000` (and, to reproduce it now,
`ODUDU_LOGIN_THROTTLE_LIMIT=1000`), so a scripted run of sign-ins is not
refused by the per-origin throttle, and `seed admin --username ada-t8` run against
it. Each of the two sections says what else it seeded. It was torn down
with `docker compose down -v` when the capture finished.

**The eighth stack.** `GET /subjects/username-policy`, the refusal of a
disabled subject's token under "The shape of it", and `GET /admin/openapi.json`
(recaptured since against the twelfth stack, below) were captured against one more stack of their own: compose project
`odudu-t8b` on port 3080, built from this branch and brought up from an
empty volume, with `seed admin --username ada-t8b` run against it, then a
tenant `policy-demo` made with `odudu seed tenant` and a subject `vera`
seeded there with `odudu seed user` and granted `odudu-admin:view-users`
alone. `$VERA_TOKEN` is `vera`'s own admin access token, got the way
"Getting the token" shows but at `policy-demo`. It was torn down with
`docker compose down -v` when the capture finished.

**The tenth stack.** The sections on routes added for the operator's side of a
tenant — its sessions and grants, its mail and logout deliveries, bulk and
tenant-wide writes, claim evaluation, audit reporting and tenant deletion — the
older `GET /audit` transcripts their notes say were recaptured, and in
[the request paths](../reference/transcripts/request-paths/index.md) "One sign-in's audit trail" and the
back-channel logout queue's `attempts`, ran against one more stack: compose
project `odudu-t8b2` on port 3082, its Postgres on 5464, built from this branch
at `a66cf8df` and brought up from an empty volume with
`ODUDU_OUTBOX_ENABLED=false` and `ODUDU_LOGOUT_SENDER_ENABLED=false`, so that
mail and Logout Tokens leave only when `odudu send-mail` and `odudu
send-logouts` are run by hand, `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true` and
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true`, so that a relay and a logout endpoint
can name the stack's own `postgres` container, where nothing listens and so
every delivery fails, and `ODUDU_THROTTLE_LIMIT=1000`. Against it: `seed admin
--username ada-t8b2` in `system`, a tenant `ops-demo` made through `POST
/admin/tenants`, subjects `grace` (with an address), `linus` (without), `mona`,
`sam` and `uma` seeded there with `odudu seed user`, `mona` granted
`odudu-admin:manage-tenant`, `sam` `odudu-admin:manage-sessions` and `uma`
`odudu-admin:manage-users`, and a confidential client `ops-app` made through
`POST /clients` with a back-channel logout URI of
`https://postgres:9/backchannel`, row id `01a0ee8a-d1a7-7c3c-a05b-903a2d8fa123`.
`grace` then signed in through `ops-app` twice — once asking for
`offline_access` — and `linus` once. `$ADMIN_TOKEN` is `ada-t8b2`'s token, got
fresh for each section the way "Getting the token" shows, and
`P=http://localhost:3082/admin/tenants/ops-demo` throughout. Each section says
what else it seeded. The two rename refusals, `GET /admin/openapi.json` (since
recaptured against the twelfth stack), `ivy`'s
read under `GET /audit` and the back-channel logout queue ran last, on the image
rebuilt at `1507a6c3`, whose only change is the wording of the
`about:blank#logout-deliveries-pending` detail. The stack was torn down with
`docker compose down -v` when the capture finished. `DELETE
/admin/tenants/{tenant}` was captured again at the close of P4d, on a stack of its own,
as its section says.

**The twelfth stack.** Every transcript whose output changed once groups and
roles carried a `description` (the role and group ones since recaptured on the
fourteenth, and saying so), groups `default_for_new_subjects`, scopes
their client default and consent fields, a tenant `audit_event_types`, a
client the fields `0084` to `0086` added and `odudu reap` its `cleared`
report, and the sections on the routes and settings those changes added,
ran against one more stack: compose project `odudu-t8c2` on port 3082, its
Postgres on 5464, built from this branch at `15cdb46a` and brought up from
an empty volume with `ODUDU_OUTBOX_ENABLED=false`, `ODUDU_REAP_ENABLED=false`
and `ODUDU_LOGOUT_SENDER_ENABLED=false`, so that mail leaves and `reap` runs
only when run by hand, `ODUDU_ALLOW_PRIVATE_SMTP_HOSTS=true`,
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true` and `ODUDU_THROTTLE_LIMIT=1000`, with
`seed admin --username ada-t8c2` run against it. `$ADMIN_TOKEN` is
`ada-t8c2`'s, got fresh for each section the way "Getting the token" shows.
Every tenant, client, role, group, scope and subject a section names was
created there for it through the endpoints below, each section says which,
so its ids refer to nothing on the stacks above. It was torn down with
`docker compose down -v` when the capture finished. The required-actions
transcripts under `POST /subjects/:id/actions-email` and in
[the request paths](../reference/transcripts/request-paths/following-a-required-actions-link.md),
and the audit types under `GET /audit`, ran on a later stack: compose project `odudu-t8d2` on port 3086, its Postgres
on 5466, built at `6feb06b7` and brought up from an empty volume with
`ODUDU_OUTBOX_ENABLED=false`, `ODUDU_REAP_ENABLED=false` and
`ODUDU_THROTTLE_LIMIT=1000`, with `seed admin --username ada` run against it. The
tenant `required-actions-demo` and its client `actions-app` came from `odudu seed
--tenant required-actions-demo --client actions-app --redirect-uri
https://app.example/callback --user seeder`; it was torn down with `docker
compose down -v` when the capture finished.

**The fourteenth stack.** Every transcript that shows a role or a group
answer ran against one more stack, once each such answer carried `admin_reach`,
a group's own record `subtree_admin_reach` and `holds_default_group`, and each
role in a group's roles its own `admin_reach`: compose project `odudu-t10b` on
port 3082, its Postgres on 5464, built from this branch at `539ffd7a` and
brought up from an empty volume with `ODUDU_THROTTLE_LIMIT=1000`,
`ODUDU_OUTBOX_ENABLED=false`, `ODUDU_REAP_ENABLED=false` and
`ODUDU_LOGOUT_SENDER_ENABLED=false`. Against it: `seed admin --username
ada-t10b`, then a subject `ada-sys` seeded in `system` with a password and
granted `odudu-admin:tenant-admin`, whose own admin token, got the way "Getting
the token" shows, is `$ADMIN_TOKEN` throughout. Every tenant, client, role,
group and subject a section names was made there for it through the endpoints
below, `seed client` and `seed user`, and each section says which, so the ids in
them refer to nothing on the stacks above. The transcripts that show audit rows,
counts and the answers to a subject's roles carry no role or group record and
stay on the stacks they were captured against. It was torn down with
`docker compose down -v` when the capture finished.

**The fifteenth stack.** Every transcript about a client's service account reach, the exact
lookup and the 200-entry bound under `GET /clients`, `PATCH /clients/{id}`
and [the request paths](../reference/transcripts/request-paths/bootstrap.md#dynamic-client-registration) ran
against one more stack: compose project `odudu-tx` on port 3082, its Postgres
on 5464, built from this branch at `3cf8eceb` with the changes those sections
describe, from an empty volume. Against it: `seed admin --username ada`, whose
token, got the way "Getting the token" shows, is `$ADMIN_TOKEN`; a tenant
`client-reach-demo` made through `POST /admin/tenants`, `$P` being
`http://localhost:3082/admin/tenants/client-reach-demo`; and in it a
confidential client `billing` made through `POST /clients`, row id
`01a11113-6605-7a86-baa1-1f49b57fb240`, with one redirect URI. Rows a section
writes by `psql`, which no route does, say so. It was torn down with `docker
compose down -v` when the capture finished.

**The sixteenth stack.** The transcripts about the 200-scope bound under `PUT
/scopes/{id}/clients/{clientId}`, `POST`/`PATCH /scopes`, `POST /admin/tenant-imports`
and `odudu seed assign-scope` ran against one more stack: compose project
`odudu-tx` on port 3082, its Postgres on 5464, built from this branch at
`1b3ad4cd` from an empty volume, with `ODUDU_THROTTLE_LIMIT=1000`. Against it:
`seed admin --username ada4`, whose token, got the way "Getting the token" shows,
is `$ADMIN_TOKEN`; a tenant `scope-limit-docs` made through `POST /admin/tenants`,
`$P` being `http://localhost:3082/admin/tenants/scope-limit-docs` and `$A` the
same without the tenant; in it a public client `limit-app` made through `POST
/clients`, row id `$CID` (`01a11266-76cd-7f4f-81a8-3e9b76d5b1b4`); and scopes
`reports:read` (`$SID`, `01a11266-7838-7db8-9c08-e5c64a8cf4d7`) and `late` made
through `POST /scopes`. The scopes the sections add to reach the limit were
written by `psql`, which no route does, and say so. It was torn down with
`docker compose down -v` when the capture finished.

**The eighteenth stack.** The transcripts under `GET`/`PUT /scopes/:id/roles` and
`GET`/`PUT /scopes/:id/mappers`, once a scope's roles carried `admin_reach` and its
mappers `declared`, ran against one more stack: compose project `odudu-tx` on
port 3082, its Postgres on 5464, built from this branch at `95941669` from an
empty volume, with `ODUDU_THROTTLE_LIMIT=1000`. Against it: `seed admin
--username ada`, whose token, got the way "Getting the token" shows, is
`$ADMIN_TOKEN`; a tenant `scope-reach-demo` made through `POST /admin/tenants`; in
it a scope `billing`, made through `POST /scopes`, and a role `billing-viewer`,
made through `POST /roles`. It was torn down with `docker compose down -v` when
the capture finished.

**The seventeenth stack.** "Getting the token" and the three sections after it
(the admin client itself, converting a public one, rotating the console's key)
ran against one more stack: compose project `odudu-docs-12b` on port 3082, its
Postgres on 5464, built from this branch at `b4efbb72` from an empty volume,
with `ODUDU_THROTTLE_LIMIT=10000` and a console key made for it by
`infra/docker/console-key.sh`. Against it: `seed admin --username ada`, whose
token, got the way "Getting the token" shows, is `$ADMIN_TOKEN`; and a tenant
`legacy`, seeded with `ODUDU_CONSOLE=false` so that its `odudu-admin` was public.
[Console paths](../reference/transcripts/console-paths/index.md) ran on the same stack, and its seventh run says
what else it holds. It was torn down with `docker compose down -v` when the
capture finished.

**The nineteenth stack.** The five typed refusals of `PUT /flow/executions` ran
against one more stack: compose project `odudu-docs-14` on port 3082, its Postgres on
5464, built from this branch with the typed refusals from an empty volume, with
`ODUDU_THROTTLE_LIMIT=10000` and a console key made for it by
`infra/docker/console-key.sh`. Against it: `seed admin --username ada`, whose token,
got the way "Getting the token" shows, is `$ADMIN_TOKEN`, and a tenant `flow-demo` made
through `POST /admin/tenants`. It was torn down with `docker compose down -v` when the
capture finished.

**The twentieth stack.** The three typed refusals of the signing-key routes ran against
one more stack: compose project `odudu-docs-15` on port 3082, its Postgres on 5464,
built from this branch with the typed refusals and the cut client list from an empty
volume, with `ODUDU_THROTTLE_LIMIT=10000` and a console key made for it by
`infra/docker/console-key.sh`. Against it: `seed admin --username ada`, whose token,
got the way "Getting the token" shows, is `$ADMIN_TOKEN`, and a tenant `key-refusals`
made through `POST /admin/tenants`, `$P` being its `/admin/tenants/key-refusals`. It
was torn down with `docker compose down -v` when the capture finished.

**The twenty-first stack.** The blank display name under every route that writes one ran
against one more stack: compose project `odudu-docs-17` on port 3082, its Postgres on 5464, built
from this branch from an empty volume, with `ODUDU_THROTTLE_LIMIT=10000` and a console
key made for it by `infra/docker/console-key.sh`. Against it: `seed admin --username ada`,
whose token, got the way "Getting the token" shows, is `$ADMIN_TOKEN`, and a tenant
`name-demo3` and `name-demo4` made through `POST /admin/tenants`. It was torn down with
`docker compose down -v` when the capture finished.

**The twenty-second stack.** The audit row of a test send ran against one more stack:
compose project `odudu-docs-18` on port 3082, its Postgres on 5464, built from this
branch from an empty volume, with `ODUDU_THROTTLE_LIMIT=10000` and a console key made
for it by `infra/docker/console-key.sh`. Against it: `seed admin --username ada`, whose
token, got the way "Getting the token" shows, is `$ADMIN_TOKEN`, and a tenant
`smtp-audit-demo` made through `POST /admin/tenants`. It was torn down with
`docker compose down -v` when the capture finished.

**The branding captures.** The theme, message-override, mail-preview and brand-route
pages, the registration page for names in other languages, and the pages that show a
client, a scope, a tenant's settings or an export once they carried languages (settings,
export, import, clients, `PATCH /clients`, scopes, built-in scopes, the scope-client
delete, the secret rotation, the OpenAPI page and the audit page up to its load test),
were run on one stack: compose project `odudu-26a` on port 3000, its Postgres on 5442,
built from the branch (the stack was rebuilt once, for the fix that made an undeclared
upload type answer the asset problem) on an empty volume, with
`ODUDU_THROTTLE_LIMIT=10000` and `ODUDU_LOGIN_THROTTLE_LIMIT=10000` and a console key made
for it. `seed admin --username ada` made the administrator, whose token, got the way
"Getting the token" shows, is `$ADMIN_TOKEN`. A script ran each command and wrote the block
that followed it, so no output was typed. Each page creates the tenants it names with
commands shown on the page; between runs of a page the script deleted those tenants, so
a page is what it printed against tenants that did not yet exist. The tokens of a
tenant's own subject (`$OPERATOR_TOKEN`, `$IVY_TOKEN`) were got by the sign-in "Getting the
token" shows, which is not repeated on the page. The OpenAPI page's block printed 98 paths
and 627891 bytes, the figures the test derives. The PNGs the pages upload are
solid-colour images made for them and were not kept.

**Pages that name more than one run.** [Getting the
token](../reference/transcripts/admin-paths/getting-the-token.md) is the run of its first
half on a stack of its own; its client listing was run again on this stack and says so.
The last section of [the audit page](../reference/transcripts/admin-paths/get-audit.md) is
a load test of twelve million rows on stacks of their own, and says so.

### Built-in scopes

[The built-in scopes page](../reference/transcripts/admin-paths/get-scopesidimpact-get-scopesbuiltins-and-post-scopesrestore-builtins.md)
was captured by a script that ran each command and wrote the command and its output
as the blocks, so no output was typed. The stack was the project `odudu-p4g-31j` on
`http://localhost:3192`, its `odudu` service built from commit `724badf2` plus the
documentation under change, on an empty volume with a console key made for it.
`seed admin` made the administrator, and the tenant `demo`, the public client `portal`
and the role `auditor` mapped to `roles` were the only other state. The OpenAPI
section of [the admin API's OpenAPI page](../reference/transcripts/admin-paths/get-adminopenapijson.md) was run again on the
same stack with nothing seeded.

### A value that changes with a build is not asserted

A transcript may show a response that holds a hashed file name, a byte size, a path
count or a `content-length` that depends on the build or on the contract, because the
block is what that run printed. It may not state one in prose as a fact unless a test
derives it from the built artefact. Where a test can, it does: the OpenAPI page's path
count and byte size are compared with the document the code generates
(`tests/docs/admin-paths.test.ts`). Where it cannot without a stack, the page says
the value belongs to the build that ran and nothing depends on it, as the console
shell and the documentation route's pages do. A new page that quotes such a value
either adds the test or scopes the value in the same commit.

## Console path transcripts

The console gateway: the routes under `/console` that sign an administrator
in to a tenant, hold that administrator's tokens server-side, and forward the
console's calls to the admin API. The browser holds nothing but a session
cookie.

[Configuration](../operating/configuration.md) is the **entry point** — which
settings turn the console on. [the admin paths](../reference/transcripts/admin-paths/index.md)
is the admin API the proxy forwards to, and this document shows only enough
of it to show the forwarding. There is one list of what is missing or refused
for the whole server, in
[the roadmap](../roadmap.md#later); this
document never starts a second one.

Every transcript below is captured output, under the same discipline as
[the request paths](../reference/transcripts/request-paths/index.md): a fenced block holding a response
carries no language tag, a section whose output depends on the state of the
stack says which state, and a precondition a refusal depends on is shown
rather than asserted. `tests/docs/console-paths.test.ts` holds every
`/console/` route this document names to the routes the server serves. Every
audit row below answers `actor_name` and `actor_origin` as well, resolved when
it is read ([Admin paths](../reference/transcripts/admin-paths/get-audit.md)).

### Replayed on the final image

Every page in this directory, and [First start](../reference/transcripts/first-start.md), was run again
against the image built from `main` at `5eeac524` and compared with the recorded blocks, ids, times and
the stack's `ip` aside. Pages that differed were re-derived from the run, and the `ada` and `grace`
chains were refreshed as wholes so each reads as one run. The refresh sections were waited for in real
time, since the token lives 300 s. The stack was the compose project `odudu-p4g-rerun-console-a` on
`http://localhost:3701` (every command on a page names `3000`, `3082` or the port it was first run on;
only the port was changed), on one fresh volume, with `ODUDU_THROTTLE_LIMIT=1000
ODUDU_LOGIN_THROTTLE_LIMIT=1000`. "Behind TLS" in
[`GET /console/auth/callback`](../reference/transcripts/console-paths/get-consoleauthcallback.md#behind-tls)
ran on the same stack, recreated with `ODUDU_TLS=true` and an `https` base. The full list, with what
changed on each page, is in `docs/phases/p4g.md`.

**The stack.** The `docker-odudu-1` container of `infra/docker/compose.yaml`,
restarted on the existing database volume. For the first two runs its `odudu`
service was built at commit `5fd4b11`; for the third it was rebuilt at
`6401476`. `ODUDU_PUBLIC_BASE_URL` is `http://localhost:3000` and
`ODUDU_CONSOLE` is left at its default, `true`. `ODUDU_TLS` is off, so the
cookies are `odudu-console` and `odudu-console-login`; with `ODUDU_TLS=true` they are
`__Host-odudu-console`, `__Host-odudu-console-login` and `__Host-odudu-console-restart` and carry
`Secure` ([captured](../reference/transcripts/console-paths/get-consoleauthcallback.md#behind-tls)).
The image built at those commits shipped no console build, so
`ODUDU_CONSOLE_DIR` (`/app/console`) was absent, and the third run logged
that below. The image has carried a build since `78826ac`;
[`GET /console/`](../reference/transcripts/console-paths/get-console.md) is captured separately, against its own
throwaway stack, because this stack's image carried no console build. The server logged these warnings when it booted for the third
run. The second line is the console cookie's plain-HTTP fallback, and the
third is the missing build. The first two lines were captured again on a later stack, with `ODUDU_TLS` off, after the
console cookie began to follow `ODUDU_TLS`:

```
{"level":40,"time":1792694569189,"pid":1,"hostname":"bfa69d731ce2","msg":"authn-flows: serving session cookies without the __Host- prefix because TLS is off. This is expected for local development only — never in production."}
{"level":40,"time":1792694569189,"pid":1,"hostname":"bfa69d731ce2","msg":"console: serving the odudu-console cookie without the __Host- prefix or Secure, because ODUDU_TLS is off. This is expected for local development only."}
{"level":40,"time":1790590008445,"pid":1,"hostname":"062313e900ce","msg":"ODUDU_CONSOLE_DIR (/app/console) has no console build (ENOENT); /console/* answers 503"}
```

**The tenant.** Every cookie, code and token below belongs to a throwaway
tenant, `console-paths`, seeded for this capture and holding nothing else.
It was created with the seed CLI, which printed one JSON line per command.
Node's `ExperimentalWarning` lines on stderr are left out.

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name console-paths
docker compose exec -T odudu node dist/main.js seed user --tenant console-paths \
  --username grace --password console-paths-throwaway --email grace@example.com
docker compose exec -T odudu node dist/main.js seed grant-role --tenant console-paths \
  --username grace --role odudu-admin:tenant-admin
docker compose exec -T odudu node dist/main.js seed user --tenant console-paths \
  --username hopper --password console-paths-throwaway-2 --email hopper@example.com
```

```
{"command":"tenant","created":true,"tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad"}
{"command":"user","tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","username":"grace","userSubjectId":"01a0e72d-5ba9-78cd-b877-7ea6d4076028"}
{"command":"grant-role","tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","username":"grace","role":"odudu-admin:tenant-admin"}
{"command":"user","tenant":"console-paths","tenantId":"01a0e72d-5927-73c3-b14d-a5b60d1ca9ad","username":"hopper","userSubjectId":"01a0e72d-7fc7-7950-a1e7-1d079588f8b4"}
```

`grace` is the administrator; `hopper` is there so that a list has a second
page. The sections are in the order they ran, one curl cookie jar (`jar`)
throughout, so each section's cookies are the ones the section before it set.

Two sections come from **a second run**, twenty minutes after the first, on
the same container and tenant, with a new, empty `jar` and a new sign-in: the
refused callbacks and the path that escapes `/admin/`. Each says so in its
first line.

Three sections come from **an eighth run**, on a stack of its own built from
the branch tip at the close of the console's features: the `infra/docker`
compose file as the project `odudu-docs-18a`, on `http://localhost:3185`, its
`odudu` service built from the tree the document describes, on an empty
volume, with a console key made for it by `infra/docker/console-key.sh`.
It is where the `PATCH`, the cross-site refusals and the principal refusal
ran, one after another on one session, with a throwaway tenant,
`console-paths`, holding `grace` as its administrator and `hopper` beside her.
`grace` signed in through the same four steps the first run shows, with a new,
empty `jar`. The seed printed:

```bash
docker compose -p odudu-docs-18a exec -T odudu node dist/main.js seed tenant --name console-paths
docker compose -p odudu-docs-18a exec -T odudu node dist/main.js seed user --tenant console-paths \
  --username grace --password console-paths-throwaway --email grace@example.com
docker compose -p odudu-docs-18a exec -T odudu node dist/main.js seed grant-role --tenant console-paths \
  --username grace --role odudu-admin:tenant-admin
docker compose -p odudu-docs-18a exec -T odudu node dist/main.js seed user --tenant console-paths \
  --username hopper --password console-paths-throwaway-2 --email hopper@example.com
```

```
{"command":"tenant","created":true,"tenant":"console-paths","tenantId":"01a13ff2-eddb-7d89-8555-c32d1cd8acf9"}
{"command":"user","tenant":"console-paths","tenantId":"01a13ff2-eddb-7d89-8555-c32d1cd8acf9","username":"grace","userSubjectId":"01a13ff2-eff9-746c-b8cb-e56af2072daa"}
{"command":"grant-role","tenant":"console-paths","tenantId":"01a13ff2-eddb-7d89-8555-c32d1cd8acf9","username":"grace","role":"odudu-admin:tenant-admin"}
{"command":"user","tenant":"console-paths","tenantId":"01a13ff2-eddb-7d89-8555-c32d1cd8acf9","username":"hopper","userSubjectId":"01a13ff2-f33a-79ce-a952-0aeec04a80d4"}
```

The gateway refuses a write naming no subject in `X-Odudu-Console-Subject`, so
every write in those three sections names `grace`'s, and the principal
refusal shows the refusal beside the same write forwarded.

One section comes from **a fifth run**, on a stack of its own, the project
`odudu-signin` on `http://localhost:3082` at `0824c4e7`: the restarted
callback. It says what it seeded in its first lines.

One response comes from **a sixth run**, after the pending sign-in's window
was raised: `GET /console/auth/login` says which.

**A seventh run** follows `odudu-admin` becoming a confidential client, which
is what the gateway now signs in as: a stack of its own, the project
`odudu-docs-12b` on `http://localhost:3082`, its `odudu` service built from
commit `b4efbb72` on an empty volume, with a console key made for it by
`infra/docker/console-key.sh`. `seed admin --username ada` made the `system`
tenant's administrator, who signed in to the console with a new, empty `jar`.
Every section that makes a token, refresh or revocation call ran on it, and
each says so in its first line: [the gateway is a confidential
client](../reference/transcripts/console-paths/the-gateway-is-a-confidential-client.md), the first block of the
discovery read, [a refresh](../reference/transcripts/console-paths/a-refresh.md), [a refresh that cannot take the
lock](../reference/transcripts/console-paths/a-refresh-that-cannot-take-the-lock.md), [a refresh the server
refuses](../reference/transcripts/console-paths/a-refresh-the-server-refuses.md), and the logout with the redirect it
ends on. Their audit rows answer `actor_name` and `actor_origin`.
