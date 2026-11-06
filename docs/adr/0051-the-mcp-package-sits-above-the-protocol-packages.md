# 0051 — The MCP package sits above the protocol packages and may import them

**Status:** Accepted · 2026-11-06

## Context

`@odudu/mcp` serves the MCP endpoint. To act for a person it needs the OIDC
package's scope constants and `mintAgentToken`, and the admin API's route
table, its agent scope rules and its problem types (ADR 0050). It is not a
protocol: it defines no wire format of its own for users or clients to sign in
with, and a second agent surface would not be its peer.

`no-protocol-to-protocol` matches only sources named `protocol-*`, so a package
called `mcp` was unguarded in either direction: nothing stopped it importing a
database package, and nothing stopped a protocol package importing it.

## Decision

`mcp` is a package that sits above `protocol-oidc` and `protocol-admin`. Three
rules in `.dependency-cruiser.cjs` name the edges:

- `mcp-allowlist`: `packages/mcp/src` may import the kernel, the contracts,
  `protocol-oidc` and `protocol-admin`, and nothing else in the workspace. It
  has no database, crypto or domain import: it reaches the admin API through
  its HTTP surface, and what it needs from a database is handed to it.
- `no-protocol-to-mcp`: no `protocol-*` package imports `mcp`.
- `mcp-imported-only-by-server`: nothing but `apps/server` imports `mcp`.

`tests/boundaries/boundaries.test.ts` asserts each against fixtures.

## Consequences

- Deleting the MCP surface cannot break OIDC or the admin API; the reverse
  edges are forbidden.
- The two protocol packages stay peers under ADR 0035 and are not coupled
  through `mcp`: it imports them, they do not import each other more.
- A new domain or crypto dependency in `mcp` fails the build until the
  allowlist is amended in a reviewed change.

## Alternatives rejected

**`mcp` as a directory inside `protocol-admin`.** The admin API would then own
a second front door whose tokens it must also refuse (ADR 0050 keeps the
narrowing in the admin API so the MCP layer is never the only line). Rejected:
the layer that enforces would hold the thing it enforces against, and the MCP
SDK would become a dependency of every admin API consumer.

**`mcp` calling the admin API over HTTP loopback.** It would need no import of
`protocol-admin` at all. Rejected: a call would leave the process and need a
listening address, a Host the tenant accepts and a network credential path,
where an in-process `inject` with a minted token takes the same door a request
does with none of those. The route table and agent scope rules are read from
`protocol-admin` either way, so the import edge would remain.
