# 0035 — The admin API may import the OIDC package

**Status:** Accepted · 2026-09-24

## Context

`no-protocol-to-protocol` (`.dependency-cruiser.cjs`) forbids any
`packages/protocol-*` package from importing another. The rule exists to
keep _peer_ protocol surfaces independently testable and independently
deletable: OIDC and a future SAML implementation (P8) must never couple,
so removing one can never break the other.

`@odudu/protocol-admin`, added by this change, is not a peer. It
administers the protocol surface rather than standing beside it — listing,
creating and updating OAuth clients — and that work reads and writes
`client_oidc_config` and `token_grants`, whose Drizzle schemas live in
`packages/protocol-oidc/src/repository/`. Applying the rule literally would
force the admin API to either duplicate those schemas or reach around the
boundary with raw SQL, both worse than naming the one edge that is actually
downstream by definition.

## Decision

`protocol-admin` is excluded as a **source** of `no-protocol-to-protocol`
(`pathNot: '(^|/)packages/protocol-admin/'` on the rule's `from`). A second
rule, `no-protocol-to-admin`, forbids the reverse: no `packages/protocol-*`
package other than `protocol-admin` itself may import `protocol-admin`.
Without the second rule the first would be a two-way door — any protocol
package could import the admin API and reach every other protocol package
through it, exactly the coupling the original rule exists to prevent.

`protocol-admin → protocol-oidc` is the only edge this permits.
`protocol-oidc → protocol-admin`, `protocol-admin → <a future protocol-saml>`
without the same justification, and any edge between two peer protocols all
remain forbidden, unchanged. The exemption is edge-specific, not a blanket
release of `protocol-admin` from `no-protocol-to-protocol`: a third rule,
`no-admin-to-other-protocol`, forbids `protocol-admin` from importing any
protocol package other than `protocol-oidc`, so the claim above is
something a reader can check against `.dependency-cruiser.cjs` rather than
trust.

## Consequences

- `protocol-admin` can import `client_oidc_config` and `token_grants`'s
  repositories directly from `@odudu/protocol-oidc`, with no schema
  duplication and no boundary worked around informally.
- `protocol-oidc` still cannot see `protocol-admin` — deleting the admin
  API cannot break OIDC, only the reverse.
- A future protocol package (SAML, P8) gets no exemption from this ADR; it
  would need its own, argued the same way, not inherited from this one.
- `tests/boundaries/boundaries.test.ts` and its fixtures under
  `tests/boundaries/fixtures/packages/protocol-admin/` and
  `.../protocol-oidc/` assert both directions, so a change that widens or
  narrows the exemption is caught the same way any other boundary is.

## Alternatives rejected

**Moving `client_oidc_config` and `token_grants` into `domain-tenant`.**
Client metadata and grant state are arguably not wire format, so this is
where they would belong on a green field. Rejected for now: it is a
schema-ownership refactor across two packages and every test that touches
either table, not a task this increment's scope covers. A later phase may
still do it — at which point this exception is exactly what that refactor
removes, since the admin API would then depend on `domain-tenant` like any
other consumer instead of reaching into a peer protocol package.

**Reaching `client_oidc_config` and `token_grants` through raw SQL or a
duplicated schema**, avoiding the dependency-cruiser exception entirely.
Rejected: it recreates the two tables' shape a second time with no
mechanism keeping the copies in sync, or bypasses Drizzle's typing for the
tables the admin API most needs to get right. Both are worse than naming
the edge and forbidding its reverse.
