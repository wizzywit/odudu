# Next

**Position:** design approved and committed. No code yet.

**Next increment:** P0.1 — workspace scaffolding.

- pnpm workspaces + Turborepo, TypeScript project references
- ESLint 9 flat config with type-aware rules, Prettier
- `dependency-cruiser` with the package and layer rules from ADR 0010
- Vitest
- `pnpm verify` running typecheck, lint, boundaries, and tests
- GitHub Actions running `pnpm verify` on every push

**Verify:** `pnpm verify` exits zero locally and in CI.

**Blocked on:** nothing.

**Note:** corepack on this machine failed to fetch pnpm (missing binary in
the corepack cache). Fix before scaffolding.
