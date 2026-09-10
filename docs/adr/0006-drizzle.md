# 0006 — Drizzle ORM

**Status:** Accepted · 2026-09-10

## Decision

Drizzle ORM, with each domain package owning its schema slice and the `db`
package aggregating them into one migration timeline.

## Rationale

Drizzle defines schemas in plain TypeScript across multiple files, which is
exactly what per-domain schema ownership requires. Migrations are generated
as editable SQL — leverage without losing control, which matters for a
system upgraded in place.

## Consequences

- Generated migrations sometimes need hand-editing. Accepted.
- Drizzle's relational query API is less polished than Prisma's. Accepted;
  hot paths are hand-written SQL-like queries anyway.

## Alternatives rejected

**Kysely.** The honourable runner-up and arguably purer, but every
migration is hand-written. Reconsider if Drizzle's generation proves
unreliable.

**Prisma.** Best CRUD ergonomics, but its separate schema language cannot
express per-domain ownership at all, and its query engine gives up SQL
control on hot paths.
