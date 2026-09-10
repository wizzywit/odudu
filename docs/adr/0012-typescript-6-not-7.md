# 0012 — TypeScript pinned to 6.x, not 7.x

**Status:** Accepted · 2026-09-10

## Context

TypeScript 7.0.2 is the current release. typescript-eslint 8.70.0 declares
a peer range of `typescript: ">=4.8.4 <6.1.0"`.

## Decision

Pin TypeScript to exactly 6.0.3 until typescript-eslint supports 7.x.

## Rationale

Type-aware linting is the sole reason ESLint was chosen over Biome
(ADR 0008). `no-floating-promises` and `no-misused-promises` catch
unawaited asynchronous work in security-critical paths. Installing
TypeScript 7 does not fail loudly; it disables those rules while the lint
still reports success. That failure mode is worse than a build break.

## Consequences

- The TypeScript 7 native compiler's speed is unavailable for now.
- Task 1 step 14 asserts the resolved version, so an accidental upgrade is
  caught rather than silently degrading the lint.
- Revisit when typescript-eslint widens its peer range.
