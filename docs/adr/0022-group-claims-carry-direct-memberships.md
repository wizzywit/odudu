# 0022 — Group claims carry direct memberships, not the ancestor chain

**Status:** Accepted · 2026-09-14

## Context

The `groups` migration (`packages/db/drizzle/0018_groups.sql`) gave groups
a path (`/engineering/platform`), and role mappings inherit downward: a
role mapped to `/engineering` reaches every subject in `/engineering` and
every descendant group, including a subject whose only membership is
`/engineering/platform`. `effectiveRoles`
(`packages/domain-authz/src/repository/effective-roles.ts`) implements
this with a `group_closure` CTE that walks child → parent before
collecting `group_roles`.

`effectiveGroupPaths(tx, subjectId)` is the separate, narrower query that
the `groups` claim mapper reads from: it returns the paths of the groups a
subject **directly** belongs to. For a subject in
`/engineering/platform`, it returns `['/engineering/platform']` only —
`/engineering` does not appear, even though that subject's roles do include
whatever `/engineering` grants.

That asymmetry is real and worth naming precisely: **role inheritance and
group-claim membership do not agree on what a subject "belongs to."** A
subject can hold a role granted by an ancestor group while the token's
`groups` claim never mentions that ancestor.

### What Keycloak does

`verified:` fetched Keycloak's own source, `main` branch, September 2026 —
`services/src/main/java/org/keycloak/protocol/oidc/mappers/GroupMembershipMapper.java`.
It builds the claim from `userSession.getUser().getGroupsStream()` — the
user's **direct** memberships, with no walk to parent or ancestor groups —
and renders each with `ModelToRepresentation::buildGroupPath` when the
mapper's `full.path` setting is on (the default), which is exactly the
`/parent/child` shape Odudu's `path` column already produces. The claim
lists only the groups the user is actually a member of; a member of a
child group gets that child's path and nothing above it.

That the same server still inherits _role_ mappings from ancestor groups
(the behaviour `effectiveRoles`' `group_closure` CTE matches) while its
`groups` claim does not walk ancestors is asserted by this ADR from
Odudu's own design symmetry, not independently re-verified against
Keycloak's role-resolution code in this pass — the direct-membership
behaviour of the claim mapper itself is what was fetched and read.

## Decision

**`effectiveGroupPaths` returns direct memberships only.** This matches
Keycloak's default `groups` claim mapper exactly, is the smaller and more
predictable claim (its size is bounded by how many groups a subject was
actually added to, not by tree depth), and does not require a consumer to
already know the tree shape to interpret it.

This is a decision about what the _claim_ contains, not about role
inheritance, which is unaffected: `effectiveRoles` keeps walking ancestors
for role resolution regardless of what `effectiveGroupPaths` reports.

## Consequences

**A consumer that authorizes against the `groups` claim, rather than
against roles, will under-match relative to what Odudu itself grants.**
Kubernetes RBAC group bindings, ArgoCD project/RBAC policies, and Grafana
team-sync rules all commonly key authorization off an OIDC `groups` claim
directly, matched by exact string or prefix — not off a `roles` claim. A
rule written as `groups contains "/engineering"` will **not** match a
subject who is only in `/engineering/platform`, even though that same
subject holds every role Odudu maps to `/engineering`. An operator wiring
up such a downstream consumer must either match on the path prefix (`groups
some starts-with "/engineering"`) or add each subject directly to every
ancestor group whose access they need — the claim will not do the tree walk
for them. This trap is exactly why it is being written down here rather
than left for the next integration to discover on its own.

The `groups` claim mapper (`groupsMapper` in
`packages/protocol-oidc/src/service/claims.ts`) reads `effectiveGroupPaths`
as-is; this ADR is what a reader reaches when they ask why it doesn't walk
ancestors, or when a downstream RBAC rule silently under-matches.

## Alternatives rejected

- **Emit the full ancestor chain in the `groups` claim** (i.e., a subject
  in `/engineering/platform` also gets `/engineering` listed). Fixes the
  prefix-matching trap directly, at the cost of diverging from Keycloak's
  well-established default behaviour and making the claim's size scale
  with tree depth rather than with actual membership count. Also
  ambiguous about what a consumer should infer from an ancestor path
  appearing in `groups` — that a subject actually joined it, or merely
  that it dominates something the subject joined — which a direct-only
  claim does not have to answer.
- **Emit both,** a `groups` claim with direct memberships and a separate
  `groupsWithAncestors` or similar claim with the full closure. Solves the
  RBAC-prefix case for a consumer willing to opt into a nonstandard claim,
  but adds a second claim to specify, document and keep consistent with
  `effectiveRoles`' own closure, for a problem an operator can already work
  around with a prefix match. Nothing in this phase's brief calls for it;
  worth reopening if a concrete downstream integration needs it.
