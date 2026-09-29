# 0039 — Names relying parties match on are identifiers

**Status:** Accepted · 2026-09-27

## Context

OIDC Core 1.0 §5.7 (Claim Stability and Uniqueness) makes `iss` together
with `sub` the only claim combination guaranteed stable and unique for an
End-User, and warns a relying party against using `email`, `preferred_username`
or `name` to key on. Odudu's `sub` is the subject's id
(`packages/protocol-oidc/src/service/claims.ts:31`), a value nothing in the
admin API ever changes. Role, scope and group names carry no such
protection: they are the literal strings a relying party reads out of the
`roles` claim, a requested `scope`, and the `groups` claim and its paths,
and a tenant's name is its issuer. `role-patch.ts`, `group-patch.ts`,
`scope-patch.ts` and `tenant-patch.ts` already refuse a rename as needing
"its own operation"; P4d's scan of what the admin API cannot yet do (spec
§4.7) found no operation waiting to be built behind that refusal — it names
a decision that had not been written down.

## Decision

**Role, scope, group and tenant names are identifiers a relying party
matches on, and are immutable after creation.** A rename would change what
new tokens carry while tokens already issued, and any policy already
written against the old value, keep the value it had — a relying party's
check would then pass or fail depending on a token's age, which is not a
distinction anything can be built to test for. The console shows such a
name as fixed, with that reason, and offers "create a copy" for roles and
scopes rather than a rename.

**A username is not** such an identifier, and is renamable behind a new
tenant setting, `username_editable`, off by default. Nothing a relying
party is entitled to key on changes when it does: `sub` is untouched,
sessions and grants hold `sub`, and `preferred_username` simply carries the
new value on the next token issued. Keycloak's realm setting "Edit
username" — off by default — is the precedent for both the toggle and its
default, and Keycloak and Okta each make the rename part of the ordinary
user-update operation rather than a dedicated one, which is the shape
`PATCH …/subjects/{id}` follows here.

Microsoft Entra ID's app roles are the precedent from the other side: an
app role's `value` is the string written into a token's `roles` claim, and
Microsoft's own guidance is not to change it once client applications rely
on it — a client matching on the old value stops being recognised the
moment the value moves, which is the same failure this decision exists to
rule out for a role, scope, group or tenant name here.

## Consequences

- `PATCH …/subjects/{id}` accepts `username` only when the tenant's
  `username_editable` setting is on, checked by the same validation
  creation runs, and requires `If-Match` whenever `username` is in the
  body — a rename silently undoing another administrator's is exactly what
  that precondition exists to stop. A username another subject already
  holds refuses the whole request with `409`.
- Nothing keyed on the subject moves with a rename: brute-force counters
  are keyed by subject id, not by the submitted name
  (`packages/domain-identity/src/schema/login-failures.ts`), and a password
  equal to the new username is not re-checked against
  `password_not_username` until it is next changed.
- Renaming a role, group, scope or tenant stays refused, permanently rather
  than provisionally: the console never offers it, and an administrator who
  needs a different name creates a new role or scope and migrates
  assignments to it.

## Alternatives rejected

- **Allow the rename and accept the token-age inconsistency.** Rejected:
  the inconsistency is exactly what OIDC Core 1.0 §5.7 exists to keep a
  relying party from having to detect, and nothing short of forcing every
  outstanding token to expire first would close it.
- **Allow the rename and force re-issuance of every outstanding token.**
  Would restore consistency but revokes every session holding the old
  claim, including ones the rename has nothing to do with; disproportionate
  to the case of correcting a typo in a role name.
- **Treat a username the same way, as immutable.** Rejected on the same
  §5.7 basis this ADR reads the other names against: a username is not
  what a relying party is entitled to key on, so there is no consistency
  requirement to protect it from a rename in the first place.
