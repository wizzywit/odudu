# P4e — authentication and token audit events

What the phase found, in the shape `docs/phases/p2b.md` established: this
file is the running record the spec, the plan and the umbrella spec's close
note do not keep — what was discovered while building, and especially what
turned out to be wrong. The phase's own argument is in
[its spec](../superpowers/specs/2026-09-26-p4e-audit-events-design.md) and
[ADR 0037](../adr/0037-refusal-rows-are-bounded-by-the-principal-they-name.md);
what it built is shown door by door in
[docs/request-paths.md](../request-paths.md) and, for the admin rows, in
[docs/admin-paths.md](../admin-paths.md).

Two shapes recur below. **An audit write that changes the thing it
records** — an extra statement, an aborted transaction, a lock — three
times, each in a property the spec had stated and the plan had then
broken. And **a claim about this repository written into the plan and
not checked**: a call-site count, a file placement, a bound's premise.

## The plan's own lockout row broke the login's statement parity

The login executor promises that a wrong password, an unknown username and
a locked account issue the same statements, so timing cannot tell them
apart. The plan added a `lockout.tripped` row as a second `INSERT` after
the attempt's own — reachable only by an account that exists, which made
it exactly the distinguisher the promise exists to prevent. Review caught
it only because the risk was named to the reviewer; nothing in the plan
flagged it.

The fix is `recordAll`: every row an attempt produces goes in one
statement, however many there are, and
`packages/protocol-oidc/tests/audit-login.int.test.ts` counts statements
with a trigger rather than asserting the property from the code.

## A refusal row could abort the transaction it was recorded in

A refused login commits, deliberately, so its row lands beside its
`login_failures` write. But a failing audit `INSERT` inside that
transaction aborted it: the caller got a `500` and the failure count was
lost — both of which spec §7 forbids. The repair is `withSavepoint`, and
the detail worth keeping is why raw `SAVEPOINT` statements do not work:
postgres-js remembers a failed query even when the caller catches it and
rethrows it when the transaction ends. The driver's own nested transaction
is the only form that isolates the failure.

## Every audited transaction takes a lock nobody had counted

`audit_events.tenant_id` references `tenants`, so every row written takes
`FOR KEY SHARE` on the tenant row until commit. Session admission locked
that row `FOR UPDATE`, which conflicts with key share, and two submissions
of one login form deadlocked (`40P01`): the loser's `advance` held key
share from its step row and waited on the authentication session, while
the winner had consumed the session and waited on the loser's key share.
It surfaced in CI as a one-in-thirty `500` in the concurrent-submission
test, latent from the increment that first wrote login rows.

The lock is now `FOR NO KEY UPDATE`, which still excludes admissions from
each other — checked by executing `nowait` against a held one — and ADR
0033's amendment records the three other tenant-row locks moved for the
same reason. None of this was visible from the audit code: an `INSERT`
into an append-only table does not look like it can take part in a
deadlock.

## A bound whose premise was false

The spec exempted refusals "after the client authenticated" from the
per-client refusal budget, on the ground that such a row names a proven
client. A public client authenticates with its `client_id` alone, so
anybody who knows `demo-spa` could append a refused `token.refresh` row per
request with a random token. Spec §8 was amended mid-phase: every refusal
row at `/token`, `/revoke` and `/introspect` spends the `(tenant, client)`
budget. The same review found `/introspect`'s client-authentication
failures unrecorded — an authentication decision like one at `/token` —
and they are recorded now.

## What the plan said about this repository, and what was true

- It placed the refusal recorder in the `view` layer calling a repository,
  which `CLAUDE.md`'s layering forbids; it lives in `usecase/`.
- It counted 57 admin `withTenant` call sites, all in `view/routes`, and
  missed `createTenant` in `usecase/`, so tenant creation wrote a row with
  no `request_id` or `ip`.
- It ran `admin_mutation` detail through the vocabulary's allowlist, keyed
  by action name — harmless only until an admin action is named like a
  vocabulary one, `token.revoke` say. `admin_mutation` detail now answers
  to its own allowlist alone.

## An actor column the spec described and no writer filled

Spec §5 says `actor_tenant_id` is the row's own tenant, except on
`token.foreign_issuer`. Only the admin writers set it; every
authentication, session, token and credential row carried a null beside a
filled `actor_subject_id`, and no test looked. It was found by reading the
end-to-end transcript's JSON, not by any test, and `auditRepository` now
defaults the column to the tenant the transaction is bound to. The same
closing pass found three writers — credential rows from the login flow and
from self-service, and `/token`'s refusal rows — whose integration files
had no foreign-tenant probe, which §12 requires of every one.

## Refusals the vocabulary never named

The closing pass read `docs/request-paths.md`'s "What is not implemented"
and found two items still addressed to this phase. One was merely stale —
it said nothing wrote `credential` rows, after they were written. The other
was true: a refused credential or session change writes no row. Spec §5
listed credential actions as successes only, and §8's table enumerates the
refusals that write rows without saying what happens to one it does not
list, so the gap was a silence rather than a decision. Each of those
refusals names a principal ADR 0037's rule can bound, and it is still open
at the time of writing; the not-implemented list places it on this phase.

## Guards, one that could never fire and one that looked like it could not

A foreign-issuer check compared `tenantIssuer(base, name)` against `iss`
after a `startsWith` that already guaranteed equality, and was added as
defence in depth. It could not fail, and was deleted. The `/` check beside
it looked equally redundant and is not: tenant names are unconstrained
strings (`z.string().min(1)`, no `CHECK`), so a name containing `/` nests
one tenant's issuer under another's. It has a test that fails without it.
Constraining tenant names is not this phase's topic; `docs/NEXT.md` places
it.

A throw inside foreign-issuer resolution turned the admin door's `401` into
a `500`, which is the property P4c reverted its first attempt over. It now
yields the plain `issuer_mismatch` refusal and is logged.

## A refresh can leave an allowed row and a refusal under one request id

When rotation commits and the post-rotation audience check then refuses,
the request carries an `allowed` `token.refresh` row and a refusal row
both. Recorded as a decision rather than a defect: the first is true — the
old token was consumed and a replacement exists, in a transaction that
committed — and removing it would make the trail disagree with the
database, which spec §7 exists to prevent.

## Transcripts that looked right and were not

Review found a refresh transcript that never assigned the refreshed token,
so its second call used the original; a section announcing seven requests
and showing six; and prose saying every request carried an `x-request-id`
when one did not. Each would have survived a reader, because each was
plausible, and review found all three.

## Process

A user flagged, mid-run, two phase-number references in comments; from
then on every task's instructions quoted `CLAUDE.md`'s comment rules
verbatim rather than pointing at them.

`verify` reached its 15-minute timeout after every test had passed and was
cancelled; the timeout is 30 minutes now. That is a stopgap, and
`docs/NEXT.md`'s CI entry records that its own trigger for caching has
fired.
