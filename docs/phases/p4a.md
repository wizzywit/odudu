# P4a — token exchange

What the phase found, in the shape `docs/phases/p2b.md` established: this
file is the running record the spec, the plan and the umbrella spec's close
note do not keep — what was discovered while building, especially what
turned out to be wrong. The phase's own argument is in
[its spec](../superpowers/specs/2026-09-23-p4a-token-exchange-design.md) and
[its plan](../superpowers/plans/2026-09-23-p4a-token-exchange.md); the
full task-by-task record is
[the phase ledger](../superpowers/sdd/2026-09-23-p4a-token-exchange/progress.md).

## A migration idiom copied from precedent that was itself wrong

`token_grants` gained two new nullable foreign keys, `actor_subject_id` and
`exchanged_from_grant_id`, each a composite
`(tenant_id, …) REFERENCES … ON DELETE SET NULL` — deliberately copying
`0026_token_grants_session.sql`'s `session_id` idiom exactly, on the
reasoning that a working precedent beats inventing a new one. Automated
review caught what that precedent missed: PostgreSQL's composite
`ON DELETE SET NULL` nulls **every** referencing column in the constraint,
including `tenant_id` — which is `NOT NULL` — so deleting the parent row
does not detach the child, it fails outright. A two-table reproduction
against a throwaway `postgres:17` container confirmed it:
`ERROR: null value in column "tid" … violates not-null constraint`. The
fix is the column-list form, `ON DELETE SET NULL (actor_subject_id)`,
naming only the column that should actually go null (commit `ac6f8b5`).

`0026` carries the identical defect today, unfixed: this phase does not
own an unrelated table's constraint, and `reap.ts`'s deletion order never
reaches it in practice, so it is a `docs/NEXT.md` entry rather than a
silent inheritance. Its own comment is doubly wrong, not just its SQL —
it claims a session delete would "silently promote a session-bound grant
to an offline one," when the true behaviour is that the delete errors.
Worth naming plainly: the precedent copied here had never itself been
exercised against a real delete before this phase's review caught it.
Verified behaviour beats a pattern that merely compiled and passed review
once.

## A repository fact asserted instead of grepped

The plan assumed `GRANT_TYPES_PERMITTED` was an exported array tested with
`.includes(name)`. It is a module-private `new Set([...])` in
`client-metadata.ts`, untested by anything downstream because nothing had
ever imported it before. Caught before code was written against an import
that does not exist, by the grep CLAUDE.md's sibling-to-P0 rule now
requires before a plan claims a fact about this repository's own exports.
The fix exports the existing `Set` and uses `.has`, rather than adding a
second, competing grant-type list the database's own CHECK constraint
would have to agree with.

## A generic object read that would have trusted its own prototype

`parseTokenType`'s `ACCEPTED` lookup was a plain object indexed by the raw
token-type string. `parseTokenType('toString')` resolved to
`Object.prototype.toString`, typed by the lookup as a valid
`ExchangeTokenType` — a defect with no production caller yet when it was
introduced, and soon to have one reading attacker-controlled
`subject_token_type` off the request body. Escalated from a reviewer's own
"Minor" label for exactly that reason: "latent" was true only until the
grant's own issuance path landed. Fixed by switching to a `Map`, which has
no prototype chain to walk (commit `be4adfc`). The same review round
caught `attenuateScope('   ')` treating a whitespace-only scope as an
omitted one rather than a malformed value — a narrowing bug, not a
widening one, but a fail-open default in a function whose whole job is
failing closed (commit `0de905b`).

## The design spec's own sentence, ambiguous in the direction that mattered

Section 10 says a `refresh_token` member "appears only when a refresh
token was explicitly requested" — read literally, a requirement to emit
one. RFC 8693 §2.2.1 puts a requested refresh token in `access_token`
instead, whatever the issued type; the implementation follows the RFC. The
sentence was meant as a prohibition on emitting one _opportunistically_,
not a mandate to add a member the RFC does not put there. Declined as a
code change and corrected as a spec defect instead — the review that
raised it was right about a real ambiguity and wrong about the fix, the
CLAUDE.md-documented shape exactly: address the risk (the sentence is
genuinely misleading), not the specific remedy proposed (changing working,
RFC-conforming code to match a misread requirement).

## A divergence the implementation carries and nothing recorded until now

`buildActChain` nests the _actor_ token's own prior `act` beneath the new
actor; the _subject_ token's own `act` claim is resolved and then never
consulted. Flagged during review as a minor, deferred to the clause table
rather than fixed blind — nothing today constructs a subject token with
its own delegation history to exercise the path, so there was no failing
test to drive a fix, only a documented gap. `docs/protocols/rfc8693.md`'s
"The subject token's own `act` chain is not nested" reading note is where
it now lives, honestly recorded rather than justified.

## The traceability tooling this phase closed

`docs/NEXT.md` had carried two defects in `tools/trace` since before this
phase started: `parseRows` threw on the first malformed clause status,
masking every later problem in every later file, and the summary counted
a row's _declared_ status rather than what reconciliation found, so a
`covered` row with a dead test id still added to the census on an
already-failing run. Both were probed with deliberately broken rows before
being trusted as real (two files, one malformed row each; a `covered` row
citing a test id the suite does not carry), fixed, and re-probed to
confirm the fix reached both symptoms at once. Neither defect was
introduced by this phase — both predate it — but this was the change
`docs/NEXT.md`'s own trigger named, "whichever change next touches
`tools/trace`," and the census this phase's own clause table now depends
on would have inherited both silently otherwise.

## What was not wrong

The authorization model itself — impersonation gated on a per-client
column and checked before the subject token is ever read, scope
attenuation, session inheritance at every subject-token type, the
offline-grant case staying genuinely sessionless — was reviewed against
its own design and found correct on the first pass, with the divergences
above the only defects the build and its review rounds surfaced.
