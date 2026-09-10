# 0003 — Agents: hybrid type-as-client, instance-as-principal

**Status:** Accepted · 2026-09-10

## Context

Delegated authority and per-agent guardrails are the product
differentiator. Both require an identity to delegate to and to attach
budgets to. What kind of object an agent is determines the P0 data model.

## Decision

An agent _type_ is a registered OAuth client. An agent _instance_ is an
ephemeral first-class principal minted at delegation time, carrying owner,
type, parent, granted scopes, budget, and expiry, and reaped on TTL.

## Consequences

- `subjects` needs a type dimension and an instance table from P0, even
  though nothing consumes it until P5. Cheap now, expensive to retrofit.
- On the wire everything is RFC 8693: `sub` is the instance, `act` names
  the actor, nested `act` expresses the chain. A relying party that
  understands RFC 8693 needs no knowledge of the model.
- Instances are ephemeral by design, so a TTL reaper is required. This
  matches how agents actually behave and avoids unbounded growth.
- The agent layer touches only stage 4 of the token pipeline. If it ever
  requires a forked pipeline, this decision was wrong.

## Alternatives rejected

**Agent is an OAuth client** (what Keycloak's model forces). Entirely
standards-native and fastest to build, but clients are configuration rather
than directory entries: one `client_id` per agent _type_, so a specific
session spawned by a specific user at a specific time is
indistinguishable from every other. No owner edge, no per-instance
revocation, coarse audit. Registering a client per instance means unbounded
table growth and a garbage-collection problem. This gives up most of the
differentiation.

**Agent is a persistent first-class principal.** Cleanest mental model and
maximum product depth, but more invented surface where the standards are
silent, and persistent instances reintroduce the growth problem that
ephemerality solves.
