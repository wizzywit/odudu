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

## Correction, 2026-09-10

This ADR's implementation notes assumed `current_setting('app.realm_id', true)`
returns `NULL` whenever the setting is absent. It does so only until a backend
first touches the GUC; after `set_config` has run once on a connection, the
value reverts to the empty string at transaction end for the remainder of that
connection's life. Casting `''` to `uuid` raises `22P02`, so the policy as
first written would have failed with an error rather than filtering to zero
rows.

The policy therefore wraps the lookup in `nullif(…, '')`. The decision is
unchanged; only the predicate needed writing correctly. Found by executing the
policy against a real PostgreSQL container in task 7, not by reasoning from
the documentation.

## Amendment, 2026-09-13

Resolving `{realm}` from a request path is the one read that cannot be made
under realm context: it runs _before_ any realm id exists to
`SET LOCAL app.realm_id` into. `realms`' own isolation policy keys on `id`,
and `FORCE ROW LEVEL SECURITY` binds every non-bypass role including the
table owner — verified against a real container, where an unscoped `SELECT`
from the ordinary serving role (`odudu_svc`) returns zero rows regardless of
name.

The realm lookup (`packages/protocol-oidc/src/repository/realm-lookup.ts`)
therefore takes the owner connection (`AppDeps.ownerDatabase`), already used
for migrations and bootstrap, not the RLS-scoped serving connection. The
query selects `id`, `enabled`, `verify_email` and the two SSO session
lifespans — realm settings a client learns one realm at a time anyway by
fetching its discovery document or completing a login. Realm creation by the
seed command runs on the same connection for the same reason: it is the
other side of the same gap, and the policy carries no separate `WITH CHECK`,
so it gates the insert too.

**The owner connection does not bypass RLS by virtue of owning the tables.**
`FORCE` binds the owner as well, so this gap is closed only by the owner
role being `SUPERUSER` or `BYPASSRLS` — a deployment requirement, recorded
in `README.md`, and not a property of ownership. An owner without it
resolves no realm and the server answers every request with an unknown
realm; it cannot seed one either. Two narrower ways to close the gap remain
open: a `SECURITY DEFINER` resolver owned by an exempt role, or a policy
permitting an unscoped read of the columns above. Either would let the owner
be least-privilege, and either is a change to this decision rather than to
its implementation.

The decision is unchanged: every request-serving query still runs RLS-scoped
under `SET LOCAL`. This records the one lookup that structurally cannot, and
why it is safe.
