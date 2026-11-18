# An administrator's email change is confirmed by the person

A small increment after P4f, not a phase. `PATCH /subjects/:id` with a new
`email` used to replace the stored address at once and mark it unverified, which
locked out a person who signs in by address and sent reset links to an address
nobody had proved. The person's own change (`requestEmailChange`) already
avoided both; this gives the administrator's change the same sequence (design:
`2026-11-18-admin-email-confirm-design.md`, under `docs/superpowers/specs/` and
then `docs/archive/specs/`).

What it does:

- The change is planned as one of three cases by a pure function: `null` clears
  the address at once, the address the subject already has cancels a pending
  change, anything else is stored as the pending change, mailed a link and,
  when the old address is verified, announced to it with the existing
  `address_change_requested` notice. The stored address and `email_verified` do
  not move until the person follows the link, which is the existing
  `completeEmailVerification`.
- The change is refused with `409` (`no-mail-relay`) when neither the tenant nor
  the deployment can send mail, before anything is written, and with `503` when
  the deployment has no public base URL, after rolling the request back.
- `GET` and `PATCH` of a subject carry `pending_email`; the list does not and
  the `ETag` covers it only while one is pending, so a subject with none keeps
  its earlier tag.
- The console's Profile tab says **Change pending** with **Cancel the change**,
  which is a `PATCH` back to the current address.
- A completed reset queues a "Your password was reset" notice to the address on
  the account, verified or not, in the transaction that sets the password. It has
  no link or secret, is in English and Arabic (`resetCompleted.*`, overridable),
  and the `password.reset` audit row says `notice: sent` or `skipped_none`.
- With `verify_email` on, a reset link is mailed only to a verified address. The
  answer and the cost are those of an address nobody holds, and the skipped
  request does not spend the address's mail budget.

What it found:

- `pending_email` is in every single-subject read and `PATCH` answer, `null`
  when nothing is pending, so every transcript block that shows one changed by a
  member of 21 bytes. Re-run: `get-subjectsid`, `patch-subjectsid`,
  `the-shape-of-it` (the disable of `vera`), the console `PATCH` page, the
  `admin-signs-in-and-changes-a-user` guide and the two console refresh pages.
- An email-only `PATCH` that starts, replaces or cancels a pending change moves
  the `ETag`, since the pending address is part of it while one exists. The console `PATCH` page and the guide showed a stale
  `If-Match` refused after an email change; they now change `enabled`, which
  moves the `ETag`, and point at `patch-subjectsid` for the email case.
- The relay check runs before any write, so a body that names a taken username
  and a new email answers `409 no-mail-relay` on a stack with no relay and the
  username conflict on one with a relay. The rename section of
  `patch-subjectsid` ran with a relay for that reason, and shows that the
  refused request left no pending row and mailed nothing.
- A reset now reaches an unverified address only on a tenant with `verify_email`
  off. The settings page, which said a link goes to any address an account
  holds, and the pages that said an administrator's change leaves the new
  address unverified, were corrected.
- The `get-adminopenapijson` transcript had been edited by hand, and its two
  figures disagreed (`content-length` against `wc -c`). It was fetched again on a
  live stack: 113 paths and 879,493 bytes in both.

What the whole-branch review found, fixed:

- The OpenAPI text of `PATCH /subjects/:id` said an email change replaces the
  address; it now says the change is held pending.
- The `subject.amend` audit row had no marker for a withdrawn or removed pending
  change. It now says `email_change: cancelled` or `cleared`, and `cleared`
  also when a stored address is removed.
- The PATCH took the row locks before the address lock, which a completed change
  takes the other way round; it now takes the address lock first, with a race
  test for the pair.

What it left open:

- On a tenant with `verify_email` off, a reset link still goes to an address
  nobody proved. That is the setting doing what it says, and the settings page
  and the changelog say so.
- A link mailed for a request that was cancelled is refused, which the
  transcript shows. Whether the link of an earlier request still works after a
  later request for the same address replaced it was not tested.
