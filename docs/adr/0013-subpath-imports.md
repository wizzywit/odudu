# 0013 — Node subpath imports, not tsconfig path aliases

**Status:** Accepted · 2026-09-10

## Context

Relative import chains (`../../clock.js`) are unreadable and break on every
file move. The usual remedy in the TypeScript world is a `paths` alias in
`tsconfig.json`, conventionally `@/*`.

## Decision

Each package declares `"imports": { "#/*": "./src/*.ts" }` in its
`package.json`. Intra-package imports use `#/clock`. Relative specifiers
are forbidden in `packages/*/src`, `apps/*/src`, `packages/*/tests` and
`apps/*/tests`, enforced by ESLint's `no-restricted-imports`. Cross-package
imports use the package name and resolve through that package's
`index.ts`.

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
package that declares it: `@odudu/db` cannot write `#/clock` and reach
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
- Same-directory imports are written `#/clock` rather than `./clock`.
  Marginally longer, but it makes the rule absolute and the ESLint check
  trivial: no relative specifiers at all.

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

## Correction, 2026-09-10

This ADR originally specified the mapping `"#/*": "./src/*"`. That mapping
does not work under Node's native type stripping: `#/clock.js` resolves to
`src/clock.js`, and the file on disk is `clock.ts`. Node does not rewrite the
extension. Vitest's resolver does, which is why every test passed and nothing
caught it until Task 8 first ran `node src/main.ts` directly — the exact
command this ADR's rationale claimed would work.

The mapping is therefore `"#/*.js": "./src/*.ts"`, which makes the extension
rewrite part of the mapping itself. Verified empirically under both Node 24
type stripping and `tsc` with `nodenext`; the specifier written in source is
unchanged.

The lesson is narrower than the decision: the reasoning about `#` scoping and
about avoiding a monorepo-global alias table was sound, but "resolves
identically everywhere" was asserted from documentation rather than executed.
A claim about resolution should be run before it is written down.

## Amendment, 2026-09-10 (extensionless)

`"#/*.js": "./src/*.ts"` worked, but it made the specifier lie: `#/clock.js`
names a file, `clock.js`, that does not exist on disk — only `clock.ts`
does. The `.js` was carried over from `nodenext`'s expectation that a
_relative_ specifier names the emitted file, which does not apply here: a
subpath import is resolved through the `imports` map, not by Node reading
the specifier's own extension, so the map can perform the `.ts` translation
without the specifier needing to say `.js` at all.

The mapping is now `"#/*": "./src/*.ts"`, and specifiers drop the extension:
`#/clock`, `#/schema/index`. Verified empirically across the same three
resolvers as the correction above — `node` with native type stripping,
`tsc` with `nodenext`, and esbuild (tsup's engine, including running the
produced bundle) — with nested paths, before this amendment was applied to
the codebase. Running it first was the explicit lesson of the Correction
above.
