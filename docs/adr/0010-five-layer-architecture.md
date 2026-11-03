# 0010 — Five functional layers, mechanically enforced

**Status:** Accepted · 2026-09-10

## Decision

Both consoles and the server organise code into five functional layers:
view, usecase, repository, adapter, service. Consoles are additionally
feature-driven, with each feature exposing a single `index.ts`.

`service` is the sole home of domain rules. `adapter` owns API-contract
logic — endpoints, DTO shapes, pagination, retry, error translation — but
no domain rules. `view`, `usecase`, and `repository` contain integration
code only.

Permitted imports are listed in the design spec.

## Rationale

The payoff is testability: four of the five layers test with no network and
no mocking framework. For a console of roughly forty screens this is the
difference between a suite that runs in seconds and one that runs in
minutes. On the server it keeps protocol endpoints thin — parse, delegate,
serialize — so specification conformance is tested against services, where
the MUST clauses actually live.

## Consequences

- pnpm enforces package boundaries for free, but cannot see folder
  boundaries inside a package. `dependency-cruiser` runs in CI for those.
  Without mechanical enforcement the convention decays within weeks.
- Some layers will feel thin in simple features. Accepted; uniformity is
  what makes the codebase navigable at scale.

## Amendment, 2026-10-05: what "integration code only" means in a console

The admin console showed how the decision fails without a check. Its usecases and repositories collected decisions as it was built:

- when a write is held, and the sentence that says why;
- which message a failure becomes;
- which field a 409 lands on;
- how a list of capabilities is joined into prose.

Each line looked like glue where it was written. Together they put the console's rules where no unit test reaches them without React, and copied the same mapping into every feature.

So, in a console:

- **A usecase** holds hooks, local state, and calls. It calls service functions with that state and hands their results to the view, and it navigates. It decides nothing itself: no branch on domain data, no copy, no formatting, no failure classification.
- **A repository** holds queries, mutations, cache keys and invalidation. It holds no rule about what the data means.
- **A service** is where every such decision lives, as a pure function a unit test calls directly. A decision two features share lives once, in `shared/service`.
- **An adapter** maps the wire and nothing more.

`tests/lint/console-usecase-integration-only.test.ts` holds the usecase and repository layers to this. It fails the build on the constructs that are logic in every case. The file name is fixed here and the checks are chosen by the audit that produced this amendment. A construct the test cannot see is still a breach.

## Amendment, 2026-11-03: the consoles name the layers by segment and place them in slices

P4k ([the phase note](../phases/p4k.md)) brought both consoles to the shape this
decision describes and made the shape checkable. The five layers and their
import rules are unchanged; what changed is where they live.

- **Segments.** In a console the layers are folders named `ui`, `use-cases`,
  `repository`, `adapter` and `services`, with `types` for a slice's
  declarations. The server's packages keep `view`, `usecase` and `service`: the
  rename was a console decision and no server rule reads it.
- **Slices in layers.** "Each feature exposes a single `index.ts`" generalises: a
  console's code is in slices (`pages`, `widgets`, `features`, `entities`),
  `app` and `shared`, a slice imports only from a layer below it and only
  through that slice's `index.ts`, and the five layers sit inside each slice.
  `shared` is `ui`, `api` and `lib` and holds no business knowledge. ADR 0048
  has the checks and the one closed list of platform words that stay in `shared`.
- **A view reaches a service through a use case.** The earlier text let a view
  read its own model; 143 views imported a service directly and each is now
  routed through a use case. A file in `shared/ui` may import
  `shared/lib/services`, the pure helpers the design system formats with.
- **Where a shared rule lives.** The earlier text put a decision two features
  share in `shared/service`. It now lives once in the entity that owns the
  concept, or in `shared/lib/services` when it names no domain concept; where
  two copies of a rule disagreed the variant stayed as a named option of the one
  owner, and the disagreements are listed in the phase note.
