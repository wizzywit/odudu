# P4c — the admin API

What the phase found, in the shape `docs/phases/p2b.md` established: this
file is the running record the spec, the plan and the umbrella spec's close
note do not keep — what was discovered while building, and especially what
turned out to be wrong. The phase's own argument is in
[its spec](../superpowers/specs/2026-09-24-p4c-admin-api-design.md); what it
built is in [docs/admin-paths.md](../admin-paths.md).

Three shapes recur below, each often enough to be worth naming before the
individual findings. **A mechanism built with no caller** — twice, and both
times every test passed, because every test exercised the mechanism.
**A test that cannot fail** — six times, always because the expected value
and the observed value came from the same place. And, for the second phase
running, **a comment whose conclusion is right and whose stated reason is
false** — six of those, one of which had been copied from a note in
`docs/NEXT.md` that was itself wrong.

## A mechanism with no caller passes every test it has

Signing-key selection was rewritten so that `/userinfo` signs with a key of
the algorithm a client registered for, rather than with the tenant's active
key whatever its algorithm. `forAlg` was written, unit-tested, and wired
into nothing: `/userinfo` went on calling `activeSigningKey` and went on
answering `mismatch`. The test that was supposed to establish the property
walked stage, promote and retire and never made a `/userinfo` call, so it
proved the rotation sequence and nothing about what the rotation was for.
The consequence was worse than "unfinished", because registration had
already been widened to accept any non-retired algorithm: a client
registered against a staged key got a `500` on every `/userinfo` call until
that key was promoted, and every client on the old algorithm got one from
the moment it was.

Per-tenant SMTP repeated it exactly one increment later. `resolveSender`
was implemented and tested, and `send-pending` did not call it, so a
tenant's own transport changed the behaviour of one endpoint —
`POST /smtp/test` — and nothing else. The document already asserted a
resolution order "when this tenant's mail is actually sent", which was
false for the sentence's whole life until the wiring landed.

The rule the second instance produced: a capability is not delivered until
the path a user reaches goes through it, and the test that establishes it
drives that path. A test against the mechanism is a test that the mechanism
exists.

The follow-on is subtler and worth keeping. Once `resolveSender` did run
per message, it was resolving a **deployment-level** decision — whether
`ODUDU_SMTP_HOST` is set at all, and therefore whether the capturing
adapter stands in — on every single message. `CLAUDE.md` says to decide at
boot what cannot change per tick, and that is exactly what this was: the
per-tenant override is legitimately per-message, the deployment fallback is
not. Wiring a per-request lookup can quietly demote a boot-time decision
into a per-request one.

## Six tests that could not fail, and the one thing they share

- A capability test iterated the route table and asserted that lookups into
  the route table resolve.
- A documentation-coverage test compared the route table against a document
  built from the route table.
- A flow-requirement guard walked only the default flow, which has no
  `required` step, so it could not see the regression it guarded.
- A key-encryption "the stored format did not change" test built its
  "previously stored" fixture by calling the new writer.
- An audit test asserted that a rotated secret is absent from a `detail`
  that is always empty, because that mutation records no detail at all.
- The capability matrix read each route's expected capability from the same
  table the router registers from: breaking the authorization function
  failed 102 of 104 cases, and changing a route's declared capability stayed
  green.

Every one of them has the same shape — the expected value and the observed
value come from one source — and four of the six came from a brief that
said what to assert without saying what would have to change for the
assertion to go red. Adding that one sentence to a task's instructions is
what stopped the run.

The matrix was fixed by adding **invariants** rather than a second
expectation table. A duplicate table drifts; properties that hold for any
correctly-wired route do not: a `GET` requires a `view-*` capability or a
`manage-*` composing one, a mutating method never a bare `view-*`, and
routes under one resource path share a capability family. Mutating
`DELETE /roles/{id}` from `manage-tenant` to `view-audit` turns two
invariants red while the old grid stayed green.

## The same escalation, one table over, five times

A caller may never grant authority it does not itself hold. The check was
written for `PUT /subjects/{id}/roles`, correctly, and survived four
attempts to get past it — a role composing the admin composite under an
innocuous name, a colliding role name on another client, an escalation
split across two requests, and the wrong tenant's context.

Then it turned out that `POST /roles/{id}/composites` is the identical
escalation one level down, `PUT /groups/{id}/roles` is it one table over,
`PATCH /groups/{id}` is it again without naming a role at all — group
closure walks child to parent, so moving your own group under one carrying
admin roles inherits them — and `PUT /scopes/{id}/roles` is it a fourth
time. None of those had any ceiling.

The correction was not four more guards but one restatement: the ceiling is
a property of **every path that can change what capabilities a subject
reaches**, not of the endpoints someone thought of. It now has one
implementation, reused at five sites, and the reparent guard compares the
whole new ancestor chain rather than the immediate parent.

A related hole is still open by design: `POST /groups` accepts a
`parent_id` with no ceiling. Harmless while nothing adds a subject to a
group — a new empty group grants nobody anything — and it needs the same
guard the moment a membership endpoint exists.

## A defect the whole test suite was structurally unable to see

`ajv-formats` was imported as a namespace and called. Under Vitest this
works, because its CJS interop makes the namespace callable. Under Node's
own ESM loader it is not callable and throws — so the container's
entrypoint crashed on boot while `pnpm verify` stayed green. That is the
worst shape a defect can have: the check that exists cannot reach the
failure mode, and the failure mode is total.

The remedy was not the import fix but the guard beside it: a smoke test
that runs the built artefact under `node` and is wired into `pnpm verify`.
It reproduces the crash against the pre-fix code, which is the only way to
know a guard guards anything.

## Two places where correctness depended on a lock nobody had taken

`If-Match` on tenant settings could not prevent a lost update. The read was
a plain `SELECT`, the write an `UPDATE`, and under `READ COMMITTED` two
concurrent amendments carrying the same `ETag` both matched and the second
silently overwrote the first — both answered `200`. The precondition
prevented the slow case while implying it prevented the fast one, which is
worse than not having it. The fix is `SELECT … FOR UPDATE` before the
`ETag` is computed, proven with two overlapping transactions and a
`pg_locks` poll showing the second genuinely blocked. Every amending client
endpoint had the same shape and took the same fix.

Body coercion was the same class of mistake in the opposite direction.
Ajv's `coerceTypes` was enabled for querystrings, where `?limit=10` needs
it, and applied to JSON bodies as well: `POST /admin/tenants` with
`{"name": 123}` was coerced to `"123"` and answered `201` with a tenant
named `123`. Bodies now go through a non-coercing validator, selected by
the part of the request being validated.

## A transaction boundary that committed what a refusal had refused

Two independent instances, found a week apart.

Creating a tenant inserted the row on the owner connection, which
autocommits, and provisioned the flow and the built-in admin client in a
separate transaction. A failure in the second left a committed tenant with
no flow and no admin client — a tenant nobody could log into and nobody had
asked for. The commit message that introduced it asserted the opposite,
which is the durable half of the defect.

Amending a subject wrote `enabled` before validating `email`, so a body
refused with `400` still committed the disable: the wrapper saw a normal
return and committed. And a third variant, found by an implementer while
writing tests rather than by review: catching a `CHECK` violation **inside**
the transaction and returning normally leaves PostgreSQL in aborted-
transaction state, so the implicit `COMMIT` fails with the raw error and the
caller gets a `500` instead of the `400` the catch was written to produce.
The exception has to propagate far enough to drive the `ROLLBACK`.

## Six comments right about the conclusion and wrong about the reason

This was `docs/phases/p3b.md`'s headline finding and it recurred here at the
same rate. The two clearest:

A comment claimed that sorting role ids before locking them is what makes
composite insertion deadlock-free. It is not: the ids go into one
`inArray(…).for('update')`, an unordered set predicate, so the JavaScript
ordering never reaches PostgreSQL. The conclusion — that the operation does
not deadlock — is true, for a different reason.

A comment beside key promotion claimed the lock prevents a constraint
collision. The partial unique index is what provides that safety; the lock
does something else.

One of the six is worth separating out, because its origin is different: a
comment asserting that two liveness conditions were "not identical" came
from a brief, which had taken it from an entry in `docs/NEXT.md` that was
wrong. The implementer discovered the claim was false and left it standing
rather than correcting upstream. A false claim with a citation behind it is
harder to remove than one with none.

Eleven more comments described the audit seam as a no-op that does nothing
— true when they were written, and false from the increment that made the
seam write rows, which was the same increment.

## A protocol decision that could not survive per-request issuers

The admin API verifies a token's `iss`. The first implementation compared
it against a configured issuer base while `/token` mints `iss` from the
request. On any deployment not served at `http://localhost`, every genuine
admin token would have been refused — invisible to the suite because the
fixture pinned both sides to the test client's default host.

Deriving the issuer the same way `/token` mints it is consistent with how
`/userinfo` already verifies one, and a forged `Host` yields an issuer
matching neither candidate while verification still runs against the named
tenant's own keys. So the admin API derives.

That decision then forced another. The spec had given the admin API the
resource identifier `${iss}/admin`. With issuers resolved per request there
is no issuer string to write into the client's registered `audiences` at
provisioning time — and with `audiences` empty, a token from the built-in
admin client could never carry the admin audience at all. The bootstrapped
administrator could log in and then make no admin request. The identifier
became the fixed URN `urn:odudu:params:admin-api`.

One configured issuer base for the whole deployment is probably right in
the long run, and it changes how `iss` is minted on every token, ID token,
Logout Token, the RFC 9207 parameter and discovery. `docs/NEXT.md` carries
it.

## The bootstrapped administrator could not log in

`provisionAdminClient` created the client row and no `client_oidc_config`,
and assigned no scopes, so `/authorize` rejected the client outright. The
whole purpose of `odudu seed admin` failed, and every test passed, because
nothing had yet tried to use the client for anything.

The first fix reasoned that a domain package may not import a protocol
package, so the OIDC configuration had to be a second call every creator of
a built-in admin client remembers to make — and scheduled an invariant test
to catch a forgotten one. That reasoning was wrong: `protocol-oidc` already
depends on `domain-tenant`, and protocol-to-domain is the permitted
direction, so one function in `protocol-oidc` wraps the domain call and the
configuration together and there is no second call to forget. A constraint
believed to be forced, which was not.

The test written for the first fix stopped at `/authorize`, proving that
the login form renders. It now obtains a real token and makes a real admin
request, which is the shape that would have caught the original defect.

## Two authorization defects found by review, not by design

`authorizeAdmin` matched capability names over **every** role the caller
held, including tenant roles and roles on any application client. A subject
holding an unrelated client role named `manage-users` gained that admin
capability. Externally reachable, and the worst defect found on the branch.
Capabilities are now resolved only against roles anchored to the built-in
admin client.

Separately, `requiredCapability(...) ?? null` mapped "no such route" onto
"needs no capability", so a path typo would have shipped a route open, and
an early return for a null-capability route skipped the cross-tenant check
below it. Both are fail-open coercions: the absence of a rule read as the
absence of a requirement.

The router now registers from the capability table itself and refuses to
start when the table and the handlers disagree in either direction, so the
table has teeth rather than being a parallel description of the routes.

## Things that were reverted rather than shipped

**Auditing a cross-tenant refusal.** It was implemented faithfully to an
instruction that should not have been given. An issuer mismatch is decided
before signature verification — necessarily, since a token naming an
unrecognised issuer has no keys to verify it against — so auditing there
lets any unauthenticated caller append a database row per request, on reads
as well as writes, and a throw in that path turns a `401` into a `500`.
Reverted to a recorded gap naming the real obstacle: doing it safely means
resolving the named issuer to a tenant in this deployment and verifying
against that tenant's keys first, then auditing only a token that is
authentic but presented where it may not go. The implementer's original
instinct that the work was out of proportion was correct.

**Exempting the admin door from the client cap.** The argument was that
whoever holds `manage-clients` also sets `max_clients`. False:
`max_clients` is a tenant setting amended under `manage-tenant`, a
different capability, so the exemption let one authority bypass a cap
another had set. The justifying paragraph was deleted rather than rewritten
— with the cap enforced there is nothing left to justify.

**Two branches that had become unreachable.** After a disabled client's
tokens were refused through one shared predicate, two `!client.enabled`
branches in the UserInfo path could no longer be reached, and the comment
above one of them asserted behaviour that could no longer happen. Deleting
them was contested on the grounds that they were harmless. Two live-looking
copies of a rule enforced elsewhere is how the next person edits the wrong
one.

## Smaller things worth not rediscovering

A permanently-present system tenant row **cannot** be created by a
migration. `tenants` has `FORCE ROW LEVEL SECURITY` and its policy reads a
session GUC, so an insert with no tenant bound is refused — the fail-closed
behaviour the design intends. Even with that bypassed it would be wrong: a
row that always exists destroys "empty database" semantics, and three
scheduled passes assert they do nothing against a database with no tenants.
The system tenant is created by `odudu seed admin`, inside a bound tenant
context, idempotently by name.

`provisionTenant` was not idempotent — its defaults were inserted
unconditionally and collided with a unique index on a second run. Found by
a re-run test that the task's own instructions did not ask for.

An over-large `limit` is clamped, not rejected. The implementation that
rejected was sound reasoning from a false premise: it followed the request
schema, and the schema was what was wrong. A schema describes shape; a
policy bound belongs in one place, and the schema was restating it.

Renaming a tenant's built-in admin `client_id` in the database breaks every
tenant-local administrator there with `403`, because capabilities are
resolved against roles anchored to that exact name. Unreachable through the
API — the field carries a refusal and provisioning only inserts the
constant — so a direct SQL write is the only route. Recorded beside the
`builtin_admin` column, where someone tempted to rename it would look.

Two concurrent composite insertions could each pass the cycle check and
commit a cycle between them. The check and the write need the same
transaction and the same lock.

The built-in admin client is **public**, not confidential: the schema
requires a confidential client to carry a secret hash and a public one to
carry none, so the intended pairing of `confidential` with a null secret
could never have inserted. Public is also right on the merits — an
administrator authenticates as a subject through the ordinary login flow,
and an application that provisions users registers its own confidential
client.

## Four defects the phase note recorded, then closed

They were written up here as placed work, with a paragraph each arguing
why the phase did not own them. The argument held for three and not for
the fourth, and re-reading them together is what showed it.

**The SMTP destination guard was half of ADR 0028.** `checkSmtpDestination`
resolves a tenant's relay host and refuses loopback, link-local, private
and the other reserved ranges — the ADR's first half. The second half is
that the connection is then made _to an address that passed_, never by
re-resolving the name, and it was missing: nodemailer resolved the host
again and a name answering differently the second time reached an address
the check had refused. This repository already had that half twice, in
`client-key-transport.ts` and `logout-delivery-transport.ts`, so this was
the recurring defect [p3b.md](p3b.md) names — a rule applied at one door
out of several — and not a scope decision.

What made it survive review was the comment beside it, which said the
second lookup was forced by the SMTP client. That was never verified.
nodemailer skips its own resolution when `host` is already an IP
(`lib/shared/index.js`, `resolveHostname`) and verifies the certificate
against `servername`, so the pin costs a field: `checkSmtpDestination`
returns the address it admitted, `smtpConfigFromRecord` passes it as
`host`, and the tenant's hostname rides along as `servername`. A claim
about a library, asserted rather than run, is what the P0 rule exists to
catch, and it is worth noting that it can be load-bearing for a security
control rather than only for a plan.

**The other three were cheap, which is the argument that actually
mattered.** A non-UUID path parameter answering `500`, a
`web_origins_are_valid` violation answering `500`, and `validateFlowSteps`
admitting the same authenticator twice were each defended on severity —
nothing disclosed, nothing written, no bypass. All three were true and
none of them was a reason: severity says whether a defect blocks, not
whether it is worth fixing, and the three together came to one derived
schema, one predicate mirroring a CHECK, and one `Set`.

The path-parameter fix is the one worth copying. It would have been
natural to narrow the ids on the routes that had been observed failing;
instead `paramsSchemaFor` derives the schema from the pattern each route
already declares, so a route added later is narrowed by existing. That is
the difference between fixing four doors and closing the corridor.
