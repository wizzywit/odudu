# Working on Odudu

Read `docs/superpowers/specs/2026-09-10-odudu-design.md` first. Decisions
and their rejected alternatives are in `docs/adr/`. Current position is in
`docs/NEXT.md`.

## How a phase is run

Phases and their exit criteria are in section 11 of the design spec. The
umbrella spec fixes only the decisions that span all of them — **each phase
gets its own spec and its own plan** before any code.

The sequence, in order:

1. **Brainstorm the phase** (`superpowers:brainstorming`) — scope, the
   design decisions specific to it, 2–3 approaches per contested call.
   Ends in a phase spec under `docs/superpowers/specs/`.
2. **Write the plan** (`superpowers:writing-plans`) — increments of 2–6
   hours, each independently mergeable, each ending green. Saved under
   `docs/superpowers/plans/`.
3. **Execute** (`superpowers:subagent-driven-development`) — a fresh
   implementer per task, then a review of spec compliance _and_ quality,
   with a fix loop until clean. A whole-branch review closes the phase.
4. **Finish** (`superpowers:finishing-a-development-branch`).

Work happens on a branch; `main` is protected and requires `verify`,
`container` and `commit-messages` to pass.

### CI runs on the branch, from the first increment

**Open a draft pull request with the first push of a phase branch, and push
at the end of every increment.** An increment is not finished until CI is
green on the pushed commit — a failure there is fixed before the next
increment starts, not collected for the end.

This is a mechanism, not a preference. `verify.yml` triggers on
`pull_request` and on push to `main`; a branch with no pull request open
runs **nothing**, however often it is pushed. P1 ran nineteen increments
that way, and a broken container build survived eight of them unnoticed —
`pnpm verify` does not build the image, and `container` and `conformance`
have no local equivalent anybody runs by habit. "CI green" was an exit
criterion that had never once been observed.

The unit is the increment, not the commit. An increment is several commits,
sometimes written concurrently; pushing each one races the others, spends
CI on states nobody intends to keep, and makes "fix before proceeding"
meaningless, since a red build partway through an increment is a work in
progress rather than a defect. The `conformance` job builds the OIDF suite
from source, which is minutes per run — affordable per increment, not per
commit.

### The documentation an increment owns

`README.md` and `docs/request-paths.md` describe what the server does
**now**, not what it did when they were written. An increment that changes
a request, a response, a branch, an error code, an endpoint, a command or a
default updates them in the same commit as the code — they are part of
finishing the work, in the way a test is, not a tidy-up afterwards.

`docs/request-paths.md` carries a stronger promise than most prose: every
command in it has been executed against a running stack and every response
in it is real output. Changing behaviour without re-running the affected
transcript silently downgrades it to a claim, which is the state it was
written to escape. If a command cannot be run, the document says so rather
than showing output nobody produced.

**Three rules a transcript has to follow, each learned from a way one was
false while looking fine.**

A fenced block holding a response **carries no language tag.** Prettier
reformats a tagged one, so a ` ```html ` block shows the formatter's markup
rather than the server's — `<meta charset="utf-8">` becomes
`<meta charset="utf-8" />` — and the bytes stop being the bytes served.

A transcript whose output depends on what ran before it **says what that
was, or scopes its query so that it does not.** An unscoped
`select … from login_failures` prints whatever earlier sections happened to
leave behind; a psql listing of every client prints two rows on the stack
its author had and eleven on the one the document builds. Where the state
is the point — a retention pass's counts, a lockout's arithmetic — name the
stack it was captured against.

A precondition a refusal depends on is **shown, not asserted.** Two
different checks that refuse with byte-identical output cannot be told apart
by their output, so the run has to demonstrate which one fired: the
`client_id`-versus-hint comparison needs the registered redirect list
displayed beside it, or §3 would have refused the redirect anyway and the
transcript would prove nothing.

Saying this is not enough on its own — an instruction to keep prose current
is unfalsifiable, because a stale document and a checked one look identical.
So the parts that can be checked are checked: `tests/docs/` compares what
these documents assert against what the server actually serves, and fails
the build on drift. When you add a claim that could be checked that way,
add the check with it.

### The rule P0 was written to produce

Every plan-level defect in P0 shared one shape: **a claim about how a
library, database or resolver behaves, asserted from documentation and
written into the plan as fact.** A dead `dependency-cruiser` rule, an RLS
predicate that would have errored instead of filtering, a subpath mapping
that could not resolve under Node — each was caught by execution, none by
review.

So: in a plan, any claim about third-party behaviour carries either
`verified: <the exact command run>` or `assumption:`. Every `assumption:`
on a load-bearing path gets a short spike **before** the task that depends
on it. `docs/superpowers/p0-decision-log.md` has the full account.

### The sibling rule P2b produced

P2b's eighteen plan-level defects had the opposite shape, and the P0 rule
does not reach them: fifteen were claims about **this repository** — which
table already exists, which migration number is free, which helper
`@odudu/testkit` exports, which file a method lives in, which test file has
an HTTP surface, what a Zod shape permits, what a foreign key cascades,
whether a dependency already takes the lock you were about to add, whether
a testing convention has ever been used here.

So: **a claim about this repository's own schema, scripts, helpers, file
paths or conventions gets one grep before it is written into a plan, and
the grep goes in the plan beside it.** Each of the fifteen would have been
caught by a command that takes seconds; none was caught by review, because
a confident sentence about your own codebase reads exactly like a true one.
Section 17 of
`docs/superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md`
lists them.

## Comments

Comments carry only what the code cannot express. No restating the obvious,
no ceremony, no verbose block headers. Where no comment is needed, write
none.

Write for a reader who has never seen the plan that produced the code.
**Never reference the development process from a comment** — no "Task 12",
no "Step 3", no "the brief", no "finding 2", no phase-plan slot numbers.
Those are scaffolding; they are meaningless six months later and actively
misleading once the plan is archived. Name the thing instead: not "read by
Task 14's grant" but "read by the client_credentials grant"; not "Task 16's
seed populates it" but "populated when a confidential client is provisioned".

Referring to a _durable_ artefact is fine and often useful: an RFC clause, an
ADR number, a file path, a migration filename, a named subsystem. That is
also where an essay goes when you find one: reasoning worth keeping and too
long for the code moves to an ADR or a `docs/protocols/` reading note, and
the code keeps a one-line pointer to it.

**No comment block runs longer than eight lines.**
`tests/lint/comment-block-length.test.ts` fails the build on one, naming the
file, the line and the length — the rule is otherwise unfalsifiable, and
went unenforced for twenty commits. It counts a run of comment lines
unbroken by code, so blank lines do not split a block, and it weights a line
wider than Prettier's `printWidth` as the lines it reads as. There is no
allowlist and no inline waiver: a rule anybody can switch off in a comment
is not a rule.

## Statements

Call a function as `doThing()`. Never `void doThing()`.

The `void` operator as a statement exists only to silence
`@typescript-eslint/no-floating-promises`, and it silences it everywhere —
including where a dropped promise is a real bug. If a call trips that rule,
fix the cause: `await` it, return it, or, where a library's return value is
deliberately thenable and leaving it unawaited is the documented usage, add
that call to `allowForKnownSafeCalls` in `eslint.config.js` with a comment
saying why it is safe. `fastify`'s `register` is there for exactly that
reason.

## Background work

Anything that runs on a schedule is **a command first and a timer second**.
The work is a usecase with no timer anywhere in it, taking its `now` as an
argument, and it is exposed as a command an operator can run. The loop is a
separate thin file that holds no logic of its own: an interval, its jitter,
a call, a `catch` that logs, and a `stop` that awaits the pass already in
flight. Nothing else belongs in it.

That split is what makes the work testable without a clock and the loop
testable without a database, and it is what lets a deployment schedule the
command externally instead — which is a supported configuration, never a
fallback. `odudu reap` and `apps/server/src/scheduler.ts` are the pair to
copy; ADR 0024 has the reasoning.

**A loop that dies is worse than a loop that never started.** Nothing
fails, nothing alerts, and the table grows until somebody notices months
later. So a pass that throws is logged and the loop reschedules, and the
test that establishes this asserts a **later** run — not that the error was
logged. "The run fired" says nothing about whether the loop is still alive.

**Decide at boot what cannot change per tick.** A loop whose first act each
hour is to rediscover a missing environment variable is a loop that logs
the same error forever. Refuse to start, name the variable and name the
switch that turns the schedule off. Where a precondition can only be
checked by asking the database, a persistent per-tick error is the accepted
cost of keeping the loop logic-free — ADR 0024 records the one instance and
why, so read a breach in existing code against that before fixing it.

**Test a loop with fake timers, never by waiting.** `vi.useFakeTimers()`
and `await vi.advanceTimersByTimeAsync(ms)`; a jitter band is asserted by
injecting the draw, not by timing ticks.
`apps/server/src/scheduler.test.ts` is the example. A suite that sleeps is
slow when it passes and flaky when it does not.

## Server-rendered pages

A page the login flow shows is a **`*-html.ts` in the `view` layer of the
package that owns the step**, exporting a function that returns markup and
nothing else: no `reply`, no status code, no headers. So the TOTP, passkey,
recovery-code and change-password pages live in
`packages/authn-flows/src/view/`, the registration, verification and reset
pages in `packages/account/src/view/`, and the login, error and logout
pages — which belong to the protocol endpoints themselves — in
`packages/protocol-oidc/src/view/`. A renderer is then a pure function a
unit test can assert markup against, and every page in the server has one
shape.

**Every page leaves through `sendHtml`**
(`packages/protocol-oidc/src/view/html-response.ts`), which is what makes
the security headers unforgettable on a page added later: a route never
sets `content-type`, `content-security-policy` or `x-frame-options` itself.
`html-response.test.ts` holds the view layer to naming the HTML media type
nowhere else.

**A page that needs a script says so in its return value**, as a
`RenderedPage` carrying the nonce its own markup used, and `sendHtml`
derives `script-src` from that one value. Never assemble a policy beside
the markup: `default-src 'none'` blocks an inline script **silently**, so
such a page looks broken rather than refused, and a nonce named in a header
that the markup does not carry fails exactly the same way. ADR 0018's
amendment has the reasoning. Every interpolated value passes through the
renderer's own `escapeHtml`, realm names and secrets included.

## Layering

Five functional layers, in the consoles and on the server alike:

| Layer      | Contains                                | Business logic    |
| ---------- | --------------------------------------- | ----------------- |
| view       | rendering, integration code             | no                |
| usecase    | orchestration of one journey            | no                |
| repository | state, refetch decisions                | no                |
| adapter    | wire contract: endpoints, DTOs, mapping | API-contract only |
| service    | domain and application logic            | yes               |

Permitted imports:

- `view` → own model, `shared/view`. Never repository or adapter.
- `usecase` → repository, service, view models. Never adapter.
- `repository` → adapter, service.
- `adapter` → transport, service.
- `service` → nothing.

Features expose one `index.ts`. No feature reaches into another's
internals.

Domain packages never import protocol packages. Protocol packages never
import each other.

## Non-negotiables

- **No `any`.** Not as an annotation, not as a cast, not leaked in from an
  untyped boundary such as `JSON.parse`. Use `unknown` and narrow it. The
  `no-explicit-any` and `no-unsafe-*` rules enforce this, and
  `tests/lint/no-any.test.ts` additionally fails the build if any source file
  waives one of them with an inline `eslint-disable` — a lint rule anybody can
  switch off in a comment is not a ban. If a third-party type genuinely forces
  your hand, raise it rather than suppressing it.
- Test-driven. Tests precede implementation.
- Integration tests run against real PostgreSQL via Testcontainers, never a
  mock.
- Every repository method is probed with a foreign `realm_id`.
- `SET LOCAL`, never `SET`, for realm context. A session-scoped setting
  leaks between pooled requests.
- Every increment ends with CI green **on a pushed commit with a pull
  request open** (see "CI runs on the branch"), branch merged, and `docs/NEXT.md`
  updated.
