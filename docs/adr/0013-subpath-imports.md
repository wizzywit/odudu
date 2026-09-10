# 0013 — Node subpath imports, not tsconfig path aliases

**Status:** Accepted · 2026-09-10

## Context

Relative import chains (`../../clock.js`) are unreadable and break on every
file move. The usual remedy in the TypeScript world is a `paths` alias in
`tsconfig.json`, conventionally `@/*`.

## Decision

Each package declares `"imports": { "#/*": "./src/*" }` in its
`package.json`. Intra-package imports use `#/clock.js`. Relative specifiers
are forbidden in `packages/*/src` and `apps/*/src`, enforced by
`dependency-cruiser`. Cross-package imports use the package name and resolve
through that package's `index.ts`.

The `tests/boundaries/fixtures` tree keeps its relative imports — they exist
precisely to trigger boundary violations, and the `boundaries` CLI run never
scans `tests/`, so they cannot fail the gate.

## Rationale

Node resolves the `imports` field natively. TypeScript, Vitest, tsup and
Vite all understand it. There is no loader, no bundler alias table, and no
runtime shim, so the same specifier resolves identically whether the code
runs under `node src/main.ts` via type stripping, under Vitest, or inside a
bundle.

The decisive property is scoping. A `#` specifier resolves only within the
package that declares it: `@odudu/db` cannot write `#/clock.js` and reach
into `packages/kernel/src/clock.ts`. TypeScript `paths` are global to the
whole monorepo, so an alias would resolve across package boundaries and
straight past the `index.ts` public surface — opening a hole underneath the
boundary rules of ADR 0010, which exist to prevent exactly that.

The prefixes also end up carrying meaning: `#/` is always "inside this
package", `@odudu/*` is always "another package's public surface". Since
`@odudu` already occupies the `@` prefix here, `@/` alongside it would have
read worse, not better.

## Consequences

- Every new package must declare the `imports` field. A package that forgets
  it fails loudly on the first `#/` import rather than resolving oddly.
- Specifiers keep their `.js` extension, as ESM requires.
- Same-directory imports are written `#/clock.js` rather than `./clock.js`.
  Marginally longer, but it makes the rule absolute and the
  `dependency-cruiser` check trivial: no relative specifiers at all.

## Alternatives rejected

**`@/*` via tsconfig `paths`.** The familiar Vite and Next.js convention. It
is compile-time only — Node does not resolve `paths` at runtime, so
`node src/main.ts` would need a loader such as `tsx`, and every consumer
(bundler, test runner, dependency-cruiser) would need its own copy of the
alias table. Worse, being monorepo-global, it would let `@/` bypass package
public surfaces, defeating ADR 0010.

**Self-referencing the package name** (`@odudu/kernel/clock.js` from inside
kernel). Native and needs no aliases, but it requires `exports` to publish
`./*`, which would expose every internal module to every other package —
the opposite of what ADR 0010 wants.
