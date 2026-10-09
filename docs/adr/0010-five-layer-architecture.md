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
