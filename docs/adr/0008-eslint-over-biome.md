# 0008 — ESLint 9 flat config over Biome

**Status:** Accepted · 2026-09-10

## Context

Biome is 10–30× faster than ESLint and would normally win on merit.

## Decision

ESLint 9 flat config with type-aware `@typescript-eslint` rules, plus
Prettier. `dependency-cruiser` runs standalone for boundary enforcement.

## Rationale

Biome cannot perform type-aware linting. `no-floating-promises` and
`no-misused-promises` catch unawaited asynchronous work in
security-critical paths — a bug class this codebase will be dense with.
That single pair of rules is worth the slower lint.

## Consequences

Linting is slower than it needs to be. Revisit if Biome gains type-aware
analysis.
