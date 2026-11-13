# 0052 — The me package sits above protocol-oidc and is composed only by the server

**Status:** Accepted · 2026-11-11

## Context

`@odudu/me` serves the signed-in person's own account: what they may read and
change about themselves with their own access token, rather than what an
administrator may do to them. It needs the OIDC package's token verification
and scope constants, and the identity, tenant and audit domain packages for
the records it reads and writes. It is not a protocol: it defines no wire
format a user or client signs in with.

`no-protocol-to-protocol` matches only sources named `protocol-*`, so a package
called `me` is unguarded in either direction (the same gap ADR 0051 closed for
`mcp`): nothing would stop it importing a crypto or database package, and
nothing would stop a protocol package importing it.

## Decision

`me` is a package that sits above `protocol-oidc`. Two rules in
`.dependency-cruiser.cjs` name the edges:

- `me-allowlist`: `packages/me/src` may import the kernel, the contracts,
  `domain-identity`, `domain-tenant`, `domain-audit` and `protocol-oidc`, and no
  other workspace package. Only direct imports are checked, so the rule bounds
  what `me` names, not what those packages reach.
- `me-imported-only-by-server`: nothing but `apps/server` imports `me`. This
  also keeps every `protocol-*` package from importing it, so no separate rule
  says so.

`tests/boundaries/boundaries.test.ts` asserts each against fixtures. The
fixtures use relative paths; a bare package import is caught once the package
resolves, which its `package.json` decides, so declaring dependencies there is
the second gate. The model is ADR 0051.

## Consequences

- Deleting the me surface cannot break OIDC or the admin API; nothing but
  `apps/server` imports it.
- A new dependency in `me` (the admin API, `authn-flows`, a crypto package)
  fails the build until the allowlist is amended in a reviewed change.

## Alternatives rejected

**Naming it `protocol-me`.** It would sit under `no-protocol-to-protocol`, which
forbids importing a peer, so the rule would need an exemption for it as ADR
0035 made one for the admin API. Rejected: `me` defines no sign-in wire format
and is not a peer of OIDC; it is a client of one protocol package, and the name
would claim a symmetry it does not have.

**A directory inside `protocol-oidc`.** The token verifier would then sit next
to the routes that depend on it with no boundary between them, and every OIDC
consumer would carry the self-service surface. Rejected: the layer that issues
and checks tokens should not hold the surface it is checked against.

## Amendment, 2026-11-11: no adapter layer in `me`

The package has no `adapter` folder. The layering rules let a view and a
usecase import neither an adapter nor `@odudu/db`, and `me` may not import
`@odudu/db` at all, so a database adapter inside it could not be reached. The
wire shapes are pure mappings in `service/wire.ts`. The reads are a port,
`MeReads` in `repository/reads.ts`, implemented in `apps/server/src/me-deps.ts`,
where the database is already in reach.
