# 0002 — Self-hostable: one container plus PostgreSQL

**Status:** Accepted · 2026-09-10

## Context

The deployment shape determines the caching and clustering design and
weighs heavily on nearly every other choice.

## Decision

One container image plus PostgreSQL, runnable on a laptop with
`docker compose up`, scaling to a few stateless replicas behind a load
balancer with a shared cache.

## Consequences

- Both consoles compile to static assets served by `apps/server`. Without
  this the product quietly becomes three deployables.
- Caching and sessions are PostgreSQL-backed initially, behind an interface
  in `kernel`, so Valkey drops in at P11 for multi-replica deployments.
- Nodes stay stateless from the first commit, so horizontal scaling is a
  later addition rather than a rewrite.
- Realms resolve from the URL path rather than subdomains, because wildcard
  DNS and certificates would break the laptop-friendly promise. See the
  spec for the cookie-isolation cost this incurs.

## Alternatives rejected

**Kubernetes-native from day one.** More realistic for enterprise use, but
it adds Helm, an operator, and multi-replica concerns to every early
increment, for value that does not exist until P11.

**Multi-tenant SaaS.** Highest architectural rigor, but it diverges from
the Keycloak self-host model that is the parity target.
