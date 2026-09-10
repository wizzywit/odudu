# 0008 — ESLint flat config over Biome

**Status:** Accepted · 2026-09-10

## Context

Biome is 10–30× faster than ESLint and would normally win on merit.

## Decision

ESLint flat config with type-aware `@typescript-eslint` rules, plus
Prettier. `dependency-cruiser` runs standalone for boundary enforcement.

## Rationale

Biome cannot perform type-aware linting. `no-floating-promises` and
`no-misused-promises` catch unawaited asynchronous work in
security-critical paths — a bug class this codebase will be dense with.
That single pair of rules is worth the slower lint.

## Consequences

Linting is slower than it needs to be. Revisit if Biome gains type-aware
analysis.

## Correction, 2026-09-10

This ADR originally said "ESLint 9". The installed version is 10.10.0; the
major was written from memory rather than checked. The decision is unchanged
— only the version number was wrong, so this is a factual correction rather
than a superseding ADR.
