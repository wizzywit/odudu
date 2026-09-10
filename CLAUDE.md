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

## Comments

Comments carry only what the code cannot express. No restating the obvious,
no ceremony, no verbose block headers. Where no comment is needed, write
none.

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

- Test-driven. Tests precede implementation.
- Integration tests run against real PostgreSQL via Testcontainers, never a
  mock.
- Every repository method is probed with a foreign `realm_id`.
- `SET LOCAL`, never `SET`, for realm context. A session-scoped setting
  leaks between pooled requests.
- Every increment ends with CI green, branch merged, and `docs/NEXT.md`
  updated.
