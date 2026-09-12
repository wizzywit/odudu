# 0017 — `accepted:`, and turning strict traceability on permanently

**Status:** Accepted · 2026-09-12

## Context

`docs/protocols/` carries a clause table per specification, and
`tools/trace` reconciles every row against the test suite. A row's status
was one of `covered`, `gap`, `deferred: <phase> — <reason>`, `n/a: <reason>`
or `documented: "<heading>" <reason>`, and the tool has a strict mode in
which a MUST left `gap` is an error rather than a warning. Strict was never
switched on, because it could not be: at the end of P1, nineteen MUST rows
were `gap`.

Eighteen of those nineteen are not unfinished work. Fifteen are one claim in
five specifications' words — that TLS is present, and good, on the
connection. Odudu terminates no TLS; it serves HTTP behind a reverse proxy
(`infra/conformance/compose.yaml` is the worked example), so no check inside
this process can observe a ciphersuite, a certificate, or whether the byte
stream was encrypted at all. `assertProductionTls`
(`apps/server/src/config-guard.ts`) closes the rows phrased as the server
_requiring_ TLS, and nothing can close the rest. Two more are the `https`
half of an issuer identifier, where the scheme is whatever the proxy asserts
through `X-Forwarded-Proto` — the same assertion in a different spelling.
The eighteenth is RFC 6749 §10.10's umbrella sentence, whose every conjunct
is held — by three different test ids, which one row cannot carry.

The nineteenth turned out not to belong with them at all. RFC 9068 §3's
"with no `resource` parameter, the authorization server uses a default
resource indicator in `aud`" has a condition that is unconditionally true
here — no endpoint reads a `resource` parameter — and `mintAccessToken`, the
one path every grant mints through, always sets `aud` to the client's
configured audiences plus the issuer, which `RFC6750-5.3-02` already asserts
byte-for-byte. It was closed rather than excused. That it was sitting in a
list of refusals is the argument for the discipline below as much as against
it: a status that tolerates a red row will collect rows that did not need to
be there.

So strict mode was unreachable for a reason that would never go away, and
the tables could not distinguish "nobody got to this" from "somebody decided
against this". Both were spelled `gap`.

## Decision

**Add a sixth status, `accepted: "<heading>" <reason>`, and make strict mode
the default for `pnpm trace`.**

`accepted:` means the obligation is in scope, understood, and deliberately
not satisfied by this process — and the reference says where it _is_
satisfied. It is held to the same forcing function `documented:` is: the
reference must quote a heading that `readingNoteHeadings` finds in the row's
own file, and a missing or renamed heading is an error in both modes. A MUST
recorded this way is reported as a `warn` on every run, in both modes, and
the count prints beside `covered` and `gap` on the summary line.

Strict does **not** escalate an `accepted:` MUST. That is the whole of the
status: a build that goes red over a limitation no work in this repository
can lift has exactly one remedy, which is to misrecord the row.

**`accepted:` carries no phase, deliberately.** A phase says _when_, and
`deferred: <phase>` already says it. "Satisfied by the deployment, not this
process" and "satisfied when RFC 8707 lands" are different claims, and a
phase field on `accepted:` would let the second be written as the first —
the exact conflation the two statuses exist to keep apart. If a row's honest
answer is that a later phase does this, it is `deferred:` and belongs in
that phase's scope. `accepted:` asserts there is no such phase.

## Consequences

- **A status strict tolerates is, by construction, a hole in strict mode.**
  Anyone who wants a red row quiet can reach for `accepted:`, and the tool
  cannot tell a deployment boundary from an excuse — it can check that a
  heading exists, never that the paragraph under it is true. Three things
  defend the hole, none of them a proof: the row prints on every run rather
  than disappearing; its count sits next to `covered` where a rising number
  is visible; and it must cite prose the build verifies still exists, so the
  argument has to be written down and survive every later edit to the file.
  The residual risk is the one `documented:` already carries, and it is
  worth naming plainly: prose can be checked to exist, never to be true.
- Strict is now the default, so a new MUST row with no test fails
  `pnpm verify` — which is what makes the trade above worth taking. The
  pressure that used to produce a permanent `gap` now produces either a test
  or an argument somebody signed.
- `n/a` keeps its single meaning: addressed to a different actor, or resting
  on a condition that never arises. It is no longer doing two jobs.
- Adding a seventh status is now cheap, which is a hazard rather than a
  feature. Each one dilutes what `gap` means. Six is the intended ceiling,
  and a seventh should need an ADR of its own.

## Alternatives rejected

**Reclassify the eighteen as `n/a`.** Free, requires no tool change, and
turns the build green immediately. It is also false and, worse, unfindable.
`n/a` means the obligation is addressed to a different actor — 138 rows use
it in exactly that sense — and these obligations are Odudu's, discharged by
the proxy in front of it. `reconcile` skips `n/a` rows entirely and forever,
so the refusals would join a pile of 138 nobody reads, with nothing to
distinguish a deliberate deployment boundary from a clause about client
developers. The one thing worth recording about these rows — that somebody
considered them and where they are met instead — is precisely what this
loses.

**Leave strict mode off.** Honest, in that it makes no claim the tables
cannot back, and it costs nothing today. What it forfeits is the only
mechanism that separates "nobody got to it" from "somebody decided against
it", for every row P2 and P3 will add. A warning that has been printed on
every run for two phases is furniture; nobody will notice the twentieth
line. The tables exist to make an unclosed MUST expensive, and a mode that
never fails a build makes it free.

**Give `accepted:` a phase field anyway.** Considered and rejected above: it
would make `accepted: P3 — …` writable, which is `deferred:` with strict
mode disarmed. The absence of the field is what forces the choice.

## Amendment, 2026-09-12 (the two statuses strict never looked at)

This ADR reasoned about `accepted:` against `gap` and against `documented:`
and did not look at the other two. It should have. Measured after the fact,
by adding one fresh MUST row under each status and running strict trace:

| status      | strict exit | output                  |
| ----------- | ----------- | ----------------------- |
| `gap`       | 1           | one error               |
| `accepted:` | 0           | one warn, in both modes |
| `deferred:` | 0           | **nothing at all**      |
| `n/a:`      | 0           | **nothing at all**      |

`reconcile` skipped `deferred` and `n/a` rows before any level check, so a
MUST recorded that way produced no finding in either mode. The consequences
section above claims "a new MUST row with no test fails `pnpm verify`"; that
was true only of the status somebody writing the row has no reason to
choose. The cheapest way to silence a MUST was the status nobody had
thought to check, and 111 MUST rows — 84 `n/a`, 27 `deferred` — already sat
behind the two.

**The decision is that they stay silent per row, and stop being free.**

Printing them would have been the consistent-looking answer and is the
wrong one, by this ADR's own argument. It rejected leaving strict off partly
because "a warning that has been printed on every run for two phases is
furniture; nobody will notice the twentieth line". There are eighteen
`accepted:` warnings today, and that is close to the ceiling at which a
human still reads them. Adding 111 lines would not make the 111 visible; it
would make the 18 invisible, and it would fail nothing, so nothing would
change except the cost of reading the output. A warning that cannot fail a
build is only worth printing while somebody is still counting it.

So the count is what is held instead. `tools/trace/silenced-musts.json`
records, per clause table, how many MUST rows it silences with `deferred:`
and with `n/a:`, and `reconcile` requires the recorded number to **equal**
the number it finds. A new MUST silenced either way fails strict trace with
the file, both numbers, and what to do; existing rows print nothing. The
check is per file, so a rise in one table cannot be cancelled by a fall in
another, and both directions are enforced — a census left standing above the
truth is slack the next row can be silenced into for free, which is the
failure this replaces.

What this buys and what it does not:

- A MUST can still be silenced. It now costs a line in a reviewed diff that
  says, in numbers, that one more obligation went quiet — which is the same
  standard `accepted:` is held to, arrived at by counting rather than by
  printing.
- The tool still cannot read a reason. It could not for `accepted:` either;
  this ADR said so plainly and the residual risk is unchanged. Nothing here
  checks that an `n/a:` reason is true, only that a new one was noticed.
- It is defeatable by someone who converts an existing `n/a` row to
  `covered` in the same file and same commit as they silence a new one. That
  is deliberate work with a net-zero diff, not an oversight, and it is a
  strictly higher bar than the nothing it replaces.
- The 111 existing rows are not audited by this. They are a backlog, and
  the census is the number that makes the backlog's size a fact somebody has
  to restate every time it grows.

`accepted:` keeps the treatment this ADR gave it: a warn in both modes, and
a reference the build verifies. Six remains the ceiling; nothing here adds a
status.
