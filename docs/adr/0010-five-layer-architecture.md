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
