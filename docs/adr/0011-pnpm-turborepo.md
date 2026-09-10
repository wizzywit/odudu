# 0011 — pnpm workspaces with Turborepo

**Status:** Accepted · 2026-09-10

## Decision

pnpm workspaces for the monorepo, Turborepo for task orchestration and
caching.

## Rationale

With pnpm workspaces a package can only import what its own
`package.json` declares. Architectural boundaries are therefore enforced by
the package manager itself — no lint plugin to configure, no honour system.
Turborepo adds task-graph caching, which is the part that matters.

## Alternatives rejected

**Nx.** More orchestration power and code generators, at the cost of a
heavier conceptual model that would be fought more often than used.

**npm or yarn workspaces.** Neither gives pnpm's strict isolation of
undeclared dependencies, which is the property being bought.
