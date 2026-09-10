# 0005 — PostgreSQL only

**Status:** Accepted · 2026-09-10

## Context

Keycloak supports many databases and pays for it continuously in
dialect-specific migration pain.

## Decision

PostgreSQL 17, exclusively. The repository layer keeps a second engine
possible later; nothing is built to make it easy now.

## Rationale

Committing to one engine buys `JSONB` for flexible client configuration,
`SKIP LOCKED` for reaping expired sessions and agent instances, real check
constraints, partial indexes, and row-level security for tenant isolation.
A portable design would forgo or special-case every one of these.

## Consequences

- Row-level security as a tenancy defense becomes available. See ADR 0009.
- Self-hosters wanting MySQL are unserved. That is a P11-or-later
  conversation informed by real demand, not a day-one guess.
- Every migration is written once, not once per dialect.
