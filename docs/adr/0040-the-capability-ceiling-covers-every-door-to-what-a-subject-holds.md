# 0040 — The capability ceiling covers every door to what a subject holds

**Status:** Accepted · 2026-09-28

## Context

The admin API authorises each route by a capability. A capability says which
kind of change a caller may make. It does not say whose authority the change
can reach. P4d's Part 1 found that gap one route at a time:

- A caller with `manage-users` could issue a password to a tenant
  administrator, which would let them sign in as that administrator.
- A caller with `manage-clients` could rotate the secret of a client whose
  service account holds `tenant-admin`, then act as that service account.
- A caller with `manage-tenant` could remove another administrator's
  capabilities, either by editing a group or role that administrator
  reaches, or by deleting it.

Each of these was fixed at a different time. Each fix closed its own route,
and each time the next route was found by review, not by rule. Every one of
them has the same shape: a change to a row that decides who authenticates as
a subject, or what that subject holds.

## Decision

**Any mutation that can change who authenticates as a subject, or which admin
capabilities a subject holds, is held to the caller's own capabilities.** The
helpers in `packages/protocol-admin/src/service/capability-ceiling.ts` are the
only computation of this rule. It applies at three doors:

1. **The subject itself.** Every non-GET route under `/subjects/:id` is
   refused `403` with a `refused` row when the target's admin capabilities
   are not a subset of the caller's (`targetOverreach`).
2. **A client's service account.** Every client mutation is refused on the
   same terms. That includes secret rotation, `jwks`, metadata, delete, and
   scope assignment. The target is the client's service subject, since
   changing the client changes who can authenticate as that subject.
3. **What an edit adds or removes.** A group, role or scope edit is judged by
   its delta. Anything it adds must be within the caller's capabilities
   (`replacementOverreach`, `capabilitiesReachableFrom`). Anything it removes,
   whether by removing an edge, deleting a row, or reparenting a group, must
   not take away a capability the caller lacks (`capabilitiesOfSubtree`).

The shape of the built-in capability roles is closed. Nothing can be nested
under them, and nothing provisioned can be removed from them, whether through
the API or through an import.

A route that mutates any of these rows and does not go through a ceiling
helper is a defect. Every new admin route is reviewed against this list.

## Consequences

- A system administrator who lacks a capability that the target holds is
  refused like anyone else. The ceiling is a strict subset test, not a
  seniority test.
- A caller with `manage-sessions` alone cannot end a tenant administrator's
  sessions. This is the accepted cost of keeping one uniform rule instead of
  a per-route judgement.
- The rule is conservative on removal. An edit is refused if it removes an
  edge that reaches a capability the caller lacks, even when every member
  keeps that capability through another path.
