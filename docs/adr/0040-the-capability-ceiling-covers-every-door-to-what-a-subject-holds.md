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
   That includes a removal made by a cascade: deleting a client takes its
   roles with it, and deleting a scope takes its role mappings, so each is
   judged by what the cascade removes.

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

## Amendment, 2026-09-29 — the last administrator

The ceiling stops a caller handing out or taking away what it does not hold.
It does not stop a caller who holds everything from removing the last
subject that does, which leaves a tenant administrable only through `psql`.
So the doors that can take an administrator away also refuse a write that
would leave no enabled subject holding `tenant-admin` (`manage-tenants` in
the system tenant, whose holders reach every other one), with a `409` of
type `about:blank#last-administrator`, the kebab-case fragment every
problem type here uses. The doors are a subject's roles, groups, disabling and
deletion; a group's roles, reparenting and deletion; a role's deletion and
the removal of a composite; and a client's deletion, which takes its roles.
Holders are counted effectively, through groups, their ancestors and
composites (`holdersOf`, `service/capability-ceiling.ts`), after the write
and inside a savepoint, under a per-tenant lock taken before anything else,
so two concurrent removals cannot each leave the other as the last. A
tenant with no holder to begin with is not refused: there is nothing to
lose. Every new door to these rows is reviewed against this list too.

## Amendment, 2026-09-30 — doors over the whole tenant

Three doors act on every subject of a tenant at once rather than one:
`DELETE …/sessions`, `DELETE …/lockouts` and `DELETE …/clients/{id}/grants`.
Each is held to the target ceiling as a set: `subjectsBeyond`
(`service/capability-ceiling.ts`) is the only computation of it, the union of
every holder of an admin capability the caller lacks, excluded from the write
in the same statement that makes it. A subject it excludes is not refused but
**left as it was and counted**, under `beyond_ceiling` in the response and in
the one `allowed` row the door writes; the lockout clear's row also names the
subjects it cleared. The subjects skipped are exactly those the per-subject
door would refuse, so nothing the single door forbids is reached.

Refusing the whole request instead was rejected. Every tenant has a holder of
`tenant-admin`, so a refusal would leave these doors to callers holding every
capability, which is the opposite of what `manage-sessions` exists for in an
incident. Who was left alone stays readable through the doors the caller
already has: `GET …/sessions`, `?locked=true` and `GET …/subjects/{id}/grants`.
A new door over the whole tenant takes this outcome, not a refusal.
