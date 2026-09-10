# 0009 — Shared-table tenancy with row-level security

**Status:** Accepted · 2026-09-10

## Context

Shared-table tenancy has one catastrophic failure mode: a forgotten
`WHERE realm_id = ?` leaks one tenant's data into another's. In an identity
product this is the worst bug shippable.

## Decision

Shared tables keyed by `realm_id`, with two independent defenses:

1. The repository layer cannot construct a query without a realm context —
   a type-level requirement, so omitting it fails to compile.
2. PostgreSQL row-level security. The application connects as a
   non-superuser role, tenant tables use `FORCE ROW LEVEL SECURITY`, and
   each transaction issues `SET LOCAL app.realm_id`.

If defense 1 is ever breached by a bug, the database returns zero rows
rather than another tenant's users.

## Consequences

- A policy per tenant table, and disciplined transaction setup.
- A few percent cost on query planning.
- `SET LOCAL` is mandatory. A session-scoped `SET` leaks realm context
  between requests sharing a pooled connection. This gets an explicit
  regression test.
- Every repository method is probed with a foreign `realm_id` in the
  adversarial suite.

Keycloak has no equivalent defense. For a security product the cost is
justified.

## Alternatives rejected

**Database per realm.** Strongest isolation; kills the single-container
story and scales migration cost with tenant count.

**Schema per realm.** Strong isolation, but every migration runs N times
and `search_path` management is error-prone with pooling.
