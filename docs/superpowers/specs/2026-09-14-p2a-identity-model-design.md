# P2a — Identity model: roles, groups, client scopes, web origins, profile, email

Status: accepted, 2026-09-14. Supersedes nothing; extends
`docs/superpowers/specs/2026-09-10-odudu-design.md` section 11 for one phase.

P1 delivered the OAuth 2.1 / OpenID Connect core. It did so with one
authorization primitive — a scope string drawn from a frozen three-element
constant — and one identity primitive — a username. This phase builds the
identity model underneath both: roles, groups, client scopes, a user profile,
per-client web origins, and the email delivery every account-lifecycle
feature waits on.

It comes before P2b because **it changes the token contract**. Every phase
after this one reads a token that this phase reshapes.

## 1. What P2a delivers

In build order. Each numbered item is several increments; the order is a
dependency order, not a preference.

1. **Per-client web origins.** CORS on the endpoints a browser calls, with a
   per-client allowlist.
2. **Realm-owned client scopes.** The entity `resolveScope` was written for,
   replacing the `SUPPORTED_SCOPES` constant.
3. **Roles.** Realm roles, client roles, composite roles, default roles,
   scope mappings, and the `roles` claim.
4. **Groups.** Hierarchical, path-identified, with inherited role mappings
   and the `groups` claim.
5. **User profile.** OIDC Core section 5.1's standard claims, stored and
   mapped.
6. **Email.** An `EmailSender` port, an SMTP adapter, and a capturing adapter.
7. **Account lifecycle.** Address verification, self-registration, password
   reset — in that order.

Web origins lead, against the order `docs/NEXT.md` suggests, for one reason:
it is the only item that touches no other item. It gets the branch, the draft
pull request and the documentation discipline working on a self-contained
change before the token contract starts moving.

## 2. What P2a does not deliver

Named here so that "we could just also…" is answered by a document rather
than by a judgement call mid-increment.

| Not in P2a                                                 | Owner | Why                                                                                                                                                                                        |
| ---------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin API or console for roles, groups, scopes, attributes | P4    | Provisioning in P2a is the seed CLI, the same path P1 used for users. P4 is 135–200 hours; "roles exist" must not become "roles are manageable".                                           |
| Admin-configurable protocol mappers                        | P4    | P2a owns the attributes and the claims they produce. P4 owns reconfiguring the mapping. A mapper here is code registered in `ClaimMapperRegistry`, gated by scope data.                    |
| Consent                                                    | P3    | Client scopes carry a `default`/`optional` distinction, which is the data a consent screen will read. Nothing asks the user anything; `resolveScope`'s `consented` parameter stays `null`. |
| Policy evaluation, UMA 2.0                                 | P9    | P2a emits roles. It decides nothing with them.                                                                                                                                             |
| Password policies, brute-force protection, MFA             | P2b   | Password _reset_ is here because it is an email flow. The rules a new password must satisfy are not.                                                                                       |
| Per-realm SMTP configuration                               | P4    | ADR 0015 puts credentials in the environment. Per-realm SMTP needs an encrypted secret at rest and a surface to edit it.                                                                   |
| A `user_attributes` (EAV) table                            | P4    | Nothing in P2a emits a non-standard attribute into any claim. A table with no consumer has no test beyond "it stores what it was given". It arrives with the mappers that read it.         |
| The `entitlements` claim                                   | —     | Registered alongside `roles` and `groups`, but Odudu has no entitlement concept. Recorded as a deliberate omission in `docs/protocols/rfc9068.md`, not left silent.                        |
| Reaping expired `action_tokens` rows                       | P2b   | ADR 0021. Nothing is deleted; retention is decided once, for every table that carries `expires_at`.                                                                                        |

## 3. The token contract

The central decision of the phase, and the one every later phase inherits.

### 3.1 Claim names: RFC 9068 section 2.2.3.1, not vendor claims

`groups`, `roles` and `entitlements` are **IANA-registered JWT claims**,
referenced to RFC 7643 section 4.1.2 and RFC 9068 section 2.2.3.1. RFC 9068
states that an authorization server wanting to include such attributes in a
JWT access token SHOULD use them. Keycloak's `realm_access` and
`resource_access` appear nowhere in the IANA JWT claims registry and have no
defining document.

Odudu emits `roles` and `groups`. Not `realm_access`, not `resource_access`,
and no per-client compatibility flag that would emit both — two claim
contracts is two things to test, two things to document, and a client-level
configuration switch, which is P3 and P4 surface arriving early.

**Rejected: Keycloak-shaped claims.** Every existing Keycloak adapter parses
them for free, and realm-versus-client roles are structurally distinct rather
than distinguished by convention. Rejected because the names are
unregistered and undocumented outside one vendor's source, and because
`docs/protocols/rfc9068.md` section 4's row would stay `n/a:` forever — the
phase would add authorization claims that no clause table could describe.

**Rejected: both, with an opt-in flag.** Maximum interoperability, and the
right answer for a migration tool. Rejected on cost: the opt-in is per-client
configuration, and the split this roadmap draws puts client configuration in
P3 and P4.

### 3.2 Claim encoding: string arrays, and the divergence is deliberate

RFC 7643 defines `groups` as a **multi-valued complex** attribute — read-only,
with `value`, `$ref`, `display` and `type` sub-attributes. Almost nothing
consumes it that way. Kubernetes requires the claim named by
`--oidc-groups-claim` to be a list of strings _even when there is one value_;
ArgoCD, Grafana, Vault and Argo Workflows all assume string arrays, and the
recurring ecosystem bug report is against providers that emit anything else.

Odudu emits `groups` as an array of strings. `roles` and `entitlements` are
simple multi-valued in RFC 7643 already, so only `groups` diverges. The
divergence is recorded as a reading note in `docs/protocols/rfc9068.md` — the
shape ADR 0016 uses for a deliberate divergence — rather than left as an
unexplained difference from the referenced schema.

Both arrays are **sorted and de-duplicated**. A token is then reproducible
for a given state, and its tests are not order-flaky.

### 3.3 Realm roles and client roles in one flat array

A realm role appears bare: `admin`. A client role appears qualified by its
owning client: `reports-api:reader`.

The convention is enforced by the database, not by the code that formats the
claim: a CHECK constraint refuses `:` in any role name, so no role can exist
whose qualified form is ambiguous. A reader of a token needs no configuration
to tell the two apart, and no second claim carries the distinction.

**Rejected: emit only the roles relevant to this token's `aud`, unqualified.**
Reads most naturally for a resource server. Rejected because the same token
would mean different things to different audiences, and P3's `resource`
indicators would have to re-derive the claim per audience.

**Rejected: realm roles only, client roles deferred to P3.** Smallest
contract. Rejected because the phase's exit criterion names client roles; a
phase that closes without meeting its own criterion is the failure mode
section 11 of the umbrella spec was amended to prevent.

### 3.4 Where the claims go, and what gates them

| Surface      | `roles` / `groups`                     | Gate                                                                                                                  |
| ------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Access token | yes                                    | the `roles` / `groups` client scope is assigned to the client and granted on the request                              |
| UserInfo     | yes                                    | same                                                                                                                  |
| ID token     | only when the scope definition says so | the scope is granted **and** `client_scopes.include_in_id_token` is set, which ships **off** for `roles` and `groups` |

The access token is the surface RFC 9068 section 2.2.3.1 is actually about,
and it is where a resource server reads authorization data. The ID token is
kept small deliberately: it reaches the browser, and a full role list in every
ID token is size and disclosure a client cannot opt out of.

A scope is granted per request, so "the client asks for it" cannot by itself
distinguish the two token types. The distinction is therefore **data**:
`client_scopes.include_in_id_token`, a column on the realm's scope definition
(section 4, migration 0016), which ships off for `roles` and `groups` and on
for `profile`, `email`, `address` and `phone`. A realm that wants roles in its
ID tokens turns it on for the realm, not per client — refining that to
per-client, per-mapper control is exactly the configurable-mapper work P4
owns.

This requires a change to a P1 invariant. `mintAccessToken`
(`packages/protocol-oidc/src/usecase/token-issuance.ts`) today builds a
**fixed** claim set; the `ClaimMapperRegistry` has only ever fed the ID token
and `/userinfo`. P2a extends the registry to the access token. That is a new
assembly site, gated on granted scope exactly as the ID token's is, and
`claims_supported` must stay honest across all three surfaces — which is a
test, not a convention.

**The mapper invariant is preserved, not bent.** `claims.ts` states that a
claim mapper never runs a query: service is a leaf, and the usecase does the
one lookup. Resolving effective roles needs a recursive CTE, so the **usecase**
resolves roles and group paths and passes them in. `ClaimContext` grows from
`{ subjectId, user }` to `{ subjectId, user, roles, groups }`, and every mapper
stays pure. The expensive query then happens once per issuance rather than
once per mapper.

### 3.5 Scope mappings, and `full_scope_allowed` defaulting off

A role reaches a token only if the requesting client is entitled to see it.
`client_scope_roles` attaches roles to a client scope, and the effective role
set in a token is:

> the subject's effective roles ∩ the roles reachable through the scopes
> granted on this request

Without this, every access token in a realm with 300 roles carries 300 roles,
and any client learns the realm's entire role vocabulary from one login.

`clients.full_scope_allowed` bypasses the intersection and **defaults to
off**. A new client's tokens carry no roles until an operator maps them.

**Rejected: defaulting on, as Keycloak does.** Roles work the moment they are
created and a Keycloak migration behaves identically. Rejected because the
insecure configuration would be the one an operator gets by doing nothing,
and because the disclosure and bloat problems would then be live in every
default deployment. The cost is real and is paid elsewhere: "I created a role
and it is not in the token" is the predictable first support question, so the
seed CLI maps scopes when it creates a client, and `docs/request-paths.md`
states the rule where a reader will hit it.

**Rejected: no bypass flag at all.** Smallest surface. Rejected because
re-adding it later would be a token-contract change in a phase that is not
P2a.

## 4. Data model

Eight migrations, 0015 through 0022. Every table carries `realm_id`, RLS
enabled and forced, and an isolation policy on
`current_setting('app.realm_id')` — the pattern established in migration 0001
and repeated since. Every repository method is probed with a foreign
`realm_id`.

### 0015 — web origins

`client_oidc_config.web_origins text[] NOT NULL DEFAULT '{}'`.

A CHECK constrains each entry to a bare origin — scheme, host, optional port,
no path, no trailing slash — or the literal `+`, meaning _derive from this
client's `redirect_uris`_. **`*` is refused by the constraint.** An
allow-any-origin is a per-client footgun that a client registration should
never be able to express, and no legitimate use for it survives P3's consent
work.

### 0016 — client scopes

```
client_scopes (id, realm_id, name, description,
               include_in_id_token)
  UNIQUE (realm_id, name), UNIQUE (realm_id, id)
  CHECK name is a valid RFC 6749 section 3.3 scope-token

client_scope_assignments (realm_id, client_id, client_scope_id, assignment)
  assignment IN ('default', 'optional')
  composite FKs on (realm_id, client_id) and (realm_id, client_scope_id)
```

`include_in_id_token` is section 3.4's gate.

Migration 0016 also shipped `include_in_token_scope`, meant to drop a
scope's own name from the issued `scope` claim while still letting it carry
claims. Migration 0025 removes it: `/userinfo` receives only an access
token and reconstructs granted scope from that token's `scope` claim, so a
client whose name is missing from the claim loses both the claims and the
roles that scope would otherwise reach at `/userinfo`. Hiding a scope's
name from the client and keeping it legible to the resource server are not
independently choosable while the access token is the only thing carrying
granted scope; the column asserted they were.

`assignment` is stored and enforced (the CHECK above) but not yet
**consumed**: `resolveScope` intersects a request's `scope` against every
scope `client_scope_assignments` names for that client, `default` and
`optional` alike, so in P2a a scope reaches a token only when it is both
assigned and explicitly requested, regardless of which kind it is assigned
as. That is not Keycloak's behaviour, which the row above is easy to
misread as matching: there, a `default` client scope is granted whether or
not the client asks for it, and an `optional` one only when it does. Here
the column is P3's consent screen reading material — "would this scope be
pre-checked or opt-in" — not a second gate `resolveScope` already applies.
A future consent implementer should not assume `default` currently does
anything a request's own `scope` parameter does not already do.

**No mapper table.** A mapper declares its own `scopes: ['roles']` in code, as
`claims.ts` does today. This is what leaves P4's job — making mappers
configurable — whole rather than half-done.

Seeds ship `openid`, `profile`, `email`, `address`, `phone`, `roles` and
`groups` per realm, so P1's behaviour is preserved by data rather than by a
constant.

Consequences for existing code:

- `scopes_supported` in discovery becomes a realm query, not
  `SUPPORTED_SCOPES`.
- `/authorize` validates against realm data. A scope unknown to the realm and
  a scope known but not assigned to the client are **both `invalid_scope`** —
  refused rather than silently dropped, which is what `/authorize` does today.
- `resolveScope`'s `clientAllowed` argument is finally fed real data instead
  of `[...SUPPORTED_SCOPES]`.

### 0017 — roles

```
roles (id, realm_id, client_id NULL, name, description)
  client_id NULL  => realm role
  UNIQUE INDEX (realm_id, name) WHERE client_id IS NULL
  UNIQUE INDEX (client_id, name) WHERE client_id IS NOT NULL
  CHECK (name !~ ':')          -- makes clientId:roleName unambiguous
  default_for_new_subjects boolean NOT NULL DEFAULT false

role_composites (realm_id, parent_role_id, child_role_id)
  CHECK (parent_role_id <> child_role_id)

subject_roles (realm_id, subject_id, role_id)
client_scope_roles (realm_id, client_scope_id, role_id)
```

This migration also adds `clients.full_scope_allowed boolean NOT NULL DEFAULT
false` (section 3.5) — it belongs here rather than in 0016 because the flag
bypasses a role intersection, and there are no roles to intersect until this
migration runs.

Deeper cycles than self-reference cannot be expressed as a constraint; they
are refused in the service on write, by walking the existing closure. The
resolving recursive CTE uses `UNION` rather than `UNION ALL` so that a cycle
which got in by another route terminates rather than hanging. **That
termination behaviour is an `assumption:` until a spike proves it against
real PostgreSQL** (section 8).

**Default roles are applied at subject creation.** Raising
`default_for_new_subjects` later does **not** retroactively grant the role.
Keycloak's alternative — a composite `default-roles-<realm>` role assigned to
everyone, so editing its children is retroactive — is more powerful and needs
an admin surface to be worth having, which is P4.

### 0018 — groups

```
groups (id, realm_id, parent_id NULL, name, path)
  UNIQUE (realm_id, path), UNIQUE (realm_id, id)
  CHECK (name !~ '/')
  CHECK (path LIKE '/%')

group_roles   (realm_id, group_id, role_id)
subject_groups (realm_id, subject_id, group_id)
```

`path` is denormalized and maintained in **one repository method**, which is
its only writer — not by trigger, so the invariant is testable in the same
language as the code that depends on it. Parent cycles are refused the same
way composite cycles are.

Effective roles for a subject are the union of:

- roles assigned directly to the subject,
- roles assigned to every group the subject belongs to,
- roles assigned to those groups' ancestors,
- the composite closure of all of the above.

One recursive CTE, in `@odudu/domain-authz`.

### 0019 — user profile

OIDC Core section 5.1's standard claims become typed columns on `users`:
`name`, `given_name`, `family_name`, `middle_name`, `nickname`,
`preferred_username`, `profile`, `picture`, `website`, `gender`, `birthdate`,
`zoneinfo`, `locale`, `phone_number`, `phone_number_verified`, `updated_at`,
and the `address` claim as six flat columns (`address_formatted`,
`address_street_address`, `address_locality`, `address_region`,
`address_postal_code`, `address_country`) rather than JSONB.

CHECK constraints go **on the column the claim is emitted from**, following
migration 0012's precedent — but only where section 5.1 actually specifies a
format:

- `birthdate` — `YYYY-MM-DD` or `YYYY`. Section 5.1 permits the year alone,
  and `0000` for a withheld year; a constraint demanding a full date would
  refuse a conformant value.
- `zoneinfo` — an IANA time-zone name, by shape.
- `locale` — BCP 47, by shape.
- `phone_number` — **no constraint.** Section 5.1 says E.164 is RECOMMENDED,
  not required. A CHECK enforcing it would be a bug dressed as rigour.

`name` becomes a real column. The `profile` mapper emits it and **falls back
to `username` when it is null**, which keeps P1's tested behaviour true for
every existing user rather than silently dropping the claim.

`users_lookup`'s `INCLUDE` list is reconsidered in this migration, not after
it: it is a covering index on the hot path of every token issuance, and a
wider profile changes what belongs in it.

### 0020 — action tokens

One table serves verification and reset:

```
action_tokens (id, realm_id, subject_id, type, token_hash, email,
               created_at, expires_at, consumed_at)
  type IN ('verify_email', 'reset_password')
  UNIQUE (token_hash)
```

An opaque 256-bit random token, **SHA-256 hashed at rest**, single-use via one
`UPDATE … WHERE consumed_at IS NULL AND expires_at > now() RETURNING *` — the
`authorization_codes` precedent exactly, including that **nothing is deleted**
(ADR 0021).

The `email` column records the address the token was minted for. Changing the
address therefore invalidates an outstanding verification, rather than
letting it verify a value the user no longer holds.

### 0021 — realm settings

`realms.registration_allowed`, `realms.verify_email`,
`realms.reset_password_allowed`. All default **off**. A realm does not
silently acquire a public registration endpoint because it was upgraded.

### 0022 — conditional uniqueness on `users.email`

Self-registration makes "is this address already taken?" a live question for
the first time. A partial unique index on `(realm_id, email) WHERE email IS
NOT NULL` is required for registration to be safe. It **can fail against
existing data**, and the migration is written knowing that and says so rather
than assuming a clean database.

## 5. Web origins and the preflight problem

**A CORS preflight carries no client identity.** An `OPTIONS` request sends no
body and no `Authorization` header — only `Origin`,
`Access-Control-Request-Method` and `Access-Control-Request-Headers`. On
`/token` there is therefore no `client_id` to look up; on `/userinfo` there is
no bearer token to read one from. A per-client allowlist is **unevaluable at
the moment the browser asks**. This is not hypothetical: KEYCLOAK-8006 is
this exact bug on `/userinfo`.

The design follows the constraint rather than fighting it:

- **Preflight is answered against the realm's union.** An `Origin` is allowed
  if it appears in any enabled client's `web_origins` in that realm, with `+`
  expanded to that client's `redirect_uris` origins. This discloses only
  "some client in this realm accepts this origin" — about an origin the
  caller supplied.
- **The real request is enforced per client.** On `/token` the `client_id` is
  in the body; on `/userinfo` it is the `client_id` claim of the presented
  access token. If `Origin` is not in _that_ client's list, the response
  carries no `Access-Control-Allow-*` header and the browser discards it. The
  security decision is taken where the identity exists.

Endpoint scope:

| Endpoint                            | CORS                                                |
| ----------------------------------- | --------------------------------------------------- |
| `/protocol/openid-connect/token`    | per-client on the request, realm union on preflight |
| `/protocol/openid-connect/userinfo` | same                                                |
| `/protocol/openid-connect/certs`    | `Access-Control-Allow-Origin: *`                    |
| `/.well-known/openid-configuration` | `Access-Control-Allow-Origin: *`                    |
| `/protocol/openid-connect/auth`     | none                                                |
| `/login-actions/*`                  | none                                                |

`/certs` and the discovery document are unauthenticated, non-credentialed
public documents; `*` is correct for them and simpler than pretending
otherwise. `/auth` and the login actions are **top-level navigations, not
XHR** — a CORS header there would grant browser script read access to a login
page.

**No `Access-Control-Allow-Credentials`.** Nothing in these flows is
cookie-authenticated cross-origin, and `true` alongside a reflected origin is
the classic misconfiguration.

Every allowed origin is **echoed explicitly**, never reflected unchecked, and
`Vary: Origin` is set so no cache can serve one origin's response to another.

## 6. Email and the account lifecycle

### 6.1 The seam

An `EmailSender` port in `@odudu/email`, with two adapters:

- **SMTP**, for real use.
- **Capturing**, recording sent messages in memory for tests and writing them
  to the log for the compose stack — so neither `pnpm verify` nor a developer
  needs a mail server.

Sending happens **after the transaction commits**, and is awaited. A failure
after commit means the user exists and the mail did not arrive, which is why
**resend is a first-class action from the start** rather than an afterthought.

**Rejected: an outbox table with an in-process poller.** Atomic with the
user creation, retryable, and survives a dead SMTP server. Rejected because it
introduces the first background loop in the codebase — which P11's
three-replicas story would then have to make safe — and a second table nothing
deletes from, which is the problem ADR 0021 exists about.

**Rejected: inline send with an outbox only for failures.** Retry timing
would be arbitrary and untestable as a schedule, which makes the guarantee
impossible to state honestly in `docs/request-paths.md`.

Configuration is server-level environment variables, per ADR 0015:
`ODUDU_SMTP_HOST`, `_PORT`, `_FROM`, `_USERNAME`, `_PASSWORD`, `_STARTTLS`.

### 6.2 The three flows

All under the existing `/realms/:realm/login-actions/…` family.

**Address verification** — `login-actions/action-token?key=…`. This sets
`email_verified` honestly for the first time in the project's life; until now
it has been a stored boolean nothing could set truthfully.

**Self-registration** — a form rendered only when `registration_allowed`.
Creates the subject, applies default roles, and, when `verify_email` is set,
**the account cannot complete a login until the address is verified**. An
unverified self-registered address is an account-takeover primitive, which is
why verification ships before registration; that ordering is a security
property of the phase, not a convenience.

**Password reset** — request form, mailed token, new-password form.
**Enumeration-safe: the response is identical whether or not the address
exists.** The rules a new password must satisfy are P2b's; this flow sets
whatever P2b later constrains.

## 7. Packaging

Three new packages, because the alternative breaks the layering rules rather
than following them:

- **`@odudu/domain-authz`** — roles, composites, groups, assignments, and
  effective-role resolution. Depends on nothing: its schema references ids,
  not entities, so "domain packages never import protocol packages" holds
  trivially and it does not import `@odudu/domain-realm` either.
- **`@odudu/email`** — the `EmailSender` port, the SMTP and capturing
  adapters, the templates.
- **`@odudu/account`** — registration, verification and reset usecases and
  views. These are not protocol. Keeping them out of `@odudu/protocol-oidc` is
  what stops that package becoming "everything served under `/realms/:realm/`".

Client scopes, scope mappings and web origins are client configuration and go
in **`@odudu/domain-realm`**. The profile columns go in
**`@odudu/domain-identity`**.

`tests/boundaries` and the `dependency-cruiser` rules are updated in the
increment that introduces each package. The P0 decision log's warning applies
directly: a dead `dependency-cruiser` rule is one of the defects it records.

## 8. Spikes

Per `CLAUDE.md`: a claim about third-party behaviour carries either
`verified: <command>` or `assumption:`, and every `assumption:` on a
load-bearing path gets a spike **before** the task that depends on it.

| Spike                                  | The assumption                                                                                                               | Why it is load-bearing                                                                                                                                                                                                    |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@fastify/cors` per-request delegation | That the plugin can take an allow/deny decision from the database per request, for preflight as well as for the real request | Its documented model is static per-server or per-route configuration. If it cannot, the fallback is an `onRequest` hook of roughly 60 lines owning the whole thing — small enough that the dependency has to earn itself. |
| SMTP client through a container build  | That the chosen client (`nodemailer` is the candidate) builds under `tsup` and runs in the production image                  | ADR 0002's single container is exactly where `@node-rs/argon2` is already known to be waiting. Proven by building the image, not by reading a README.                                                                     |
| Recursive CTE termination on a cycle   | That `UNION` (not `UNION ALL`) in a recursive CTE terminates when the graph contains a cycle                                 | Effective-role resolution runs on the hot path of every token issuance. A hang here is an availability bug reachable from data an operator can enter.                                                                     |

## 9. Testing

Integration tests run against real PostgreSQL via Testcontainers, never a
mock. Every one of the ten new tables gets an RLS isolation probe; every
repository method is probed with a foreign `realm_id`. Tests precede
implementation.

Four tests this phase specifically needs, each written so that the broken
implementation fails it:

1. **A cycle in `role_composites` terminates.** Asserted against real
   PostgreSQL — the claim that a `UNION` recursive CTE terminates on a cycle
   is exactly the kind of third-party assertion the P0 log was written about.
2. **Scope mappings actually narrow.** A subject holding a role that the
   requesting client's scopes do not reach receives a token _without_ it. The
   failure mode is over-disclosure, so a test asserting the role _is_ present
   would pass against a broken implementation too.
3. **Changing an email invalidates an outstanding verification token.**
4. **Preflight and the real request disagree.** An origin allowed at preflight
   because it belongs to _another_ client in the realm is refused on the
   actual `/token` call. This is the test that asserts section 5's split does
   what it claims.

`tests/docs/` gains checks that `scopes_supported` equals the realm's scope
data and that `claims_supported` equals what the registry can produce — the
two places this phase can silently begin to lie.

## 10. Traceability

`docs/protocols/rfc9068.md`:

- A reading note for section 2.2.3.1 covering three things: that
  `roles`/`groups`/`entitlements` are IANA-registered to RFC 7643 section
  4.1.2 and RFC 9068 section 2.2.3.1; that Odudu emits **string arrays**
  rather than RFC 7643's complex form for `groups`, and why; and that
  `entitlements` is deliberately not emitted.
- Section 2.2.3's SHOULD row — "if the authorization request includes a
  `scope` parameter, the corresponding JWT access token includes a `scope`
  claim" — closes with a real test. `mintAccessToken` **already** emits the
  claim; the row is `gap` for want of a test, not for want of behaviour.
- **Section 4's row stays `n/a:` but its reason must be rewritten.** It reads
  "the `groups`/`roles`/`entitlements` claims … are OPTIONAL and not emitted
  by Odudu in P1", which becomes false the moment this ships. The clause
  obliges a _resource server_, which Odudu is not; that is the reason it
  should give. A row whose justification has quietly become untrue is worse
  than a gap.

`docs/protocols/oidc-core.md` gains rows for section 5.1 (standard claims),
section 5.1.1 (the address claim) and section 5.4 (scope-to-claim mapping).

Whether RFC 7643 section 4.1.2 yields normative rows worth a clause table of
its own is **decided by reading it** during the roles increment, not assumed
now.

Any new `deferred:` or `n/a:` row moves the `tools/trace/silenced-musts.json`
census in the same diff, per ADR 0017.

## 11. Documentation

`README.md` and `docs/request-paths.md` are updated **in the same commit as
the code** that changes a request, a response, a branch, an error code, an
endpoint, a command or a default. `tests/docs/` fails the build on drift.

On top of that, P2a ends with a **whole-phase documentation increment**: every
affected transcript in `docs/request-paths.md` re-run against a live stack,
and a README pass that reads both documents as a whole rather than as a
series of diffs. Per-increment edits keep each individual claim true while
letting the overall narrative drift out of shape; this increment is what
catches that. The transcripts are **re-run**, not edited to look right.

## 12. Shape and risk

Roughly **16 increments**, of which three are the spikes in section 8, placed
before the tasks that depend on them. A draft pull request opens with the
first push; CI must be green on a pushed commit at the end of every increment.

The three things most likely to go wrong:

- **Scope creep into P4.** "Roles exist" pulls hard toward "roles are
  manageable". Seed-CLI-only is the line, and an increment that adds an
  admin-shaped surface is out of scope by definition.
- **The token contract moving under P1's tests.** Replacing `SUPPORTED_SCOPES`
  with realm data touches discovery, `/authorize` and issuance at once. It is
  sequenced as its own increment, ending green, before any role work begins.
- **The final documentation increment treated as optional.** It is the only
  thing standing between `docs/request-paths.md` and the state it was written
  to escape.

## 13. Exit criteria

P2a is finished when all of the following hold:

1. Realm roles, client roles, composite roles, groups and client scopes are
   emitted into tokens as `roles` and `groups`, sorted string arrays, client
   roles qualified as `clientId:roleName`.
2. Scope mappings narrow the role set, with `full_scope_allowed` off by
   default and a test proving a role is withheld.
3. A user profile beyond the username exists: OIDC Core section 5.1's standard
   claims stored in constrained columns and mapped into `profile`, `email`,
   `address` and `phone` scopes.
4. A browser client completes the authorization code flow end to end against
   a realm's configured web origins, including preflight.
5. Email is delivered through the `EmailSender` port, with address
   verification, self-registration and password reset working on top of it,
   and `email_verified` set only by a completed verification.
6. Every MUST and SHOULD the phase introduces carries a clause row closed by a
   test id, or a recorded status whose census entry moved in the same diff.
7. `pnpm verify`, `container`, `conformance` and `commit-messages` green on a
   pushed commit with the pull request open; branch merged; `docs/NEXT.md`
   updated.
