# P1 — OAuth 2.1 / OpenID Connect core

**Date:** 2026-09-11
**Status:** Approved
**Phase:** P1 of the roadmap in `2026-09-10-odudu-design.md` section 11
**Predecessor:** P0 (foundation), complete and merged

## 1. What this is

The phase that turns Odudu from a booting server into an identity
provider. It delivers an authorization server: five endpoints, three
grant types, signed tokens, a persisted login, and the traceability
apparatus that makes conformance countable.

The umbrella design fixes the decisions that span every phase. This
document fixes only P1's, and records what was rejected.

### In scope

| Endpoint                            | Purpose                |
| ----------------------------------- | ---------------------- |
| `/.well-known/openid-configuration` | discovery              |
| `/authorize`                        | authorization requests |
| `/token`                            | token issuance         |
| `/userinfo`                         | claims                 |
| `/jwks`                             | key publication        |

Grants: `authorization_code` with mandatory PKCE (`S256` only),
`refresh_token` with rotation and family revocation, and
`client_credentials`.

### Out of scope, deliberately

Device authorization, CIBA, token exchange (RFC 8693), introspection
(RFC 7662), the revocation endpoint (RFC 7009), RP-initiated logout,
pushed authorization requests, and DPoP.

Token exchange belongs to P5 with the agent layer. Device and CIBA carry
their own specifications and their own conformance plans. The revocation
_endpoint_ is deferred; refresh-token family revocation on reuse is a
pipeline invariant and is in scope, tested by the adversarial suite.

### The bar

Feature parity with Keycloak is the floor, not the target. Where a
specification permits a weaker configuration than it requires and
Keycloak takes it, Odudu takes the stricter reading. Section 12 lists
where this phase does so.

## 2. Decisions

### 2.1 Clients move forward from P3; users stay thin

P1's exit criterion requires an end-to-end authorization code flow, which
needs a resolvable client and an authenticatable end-user. Clients and
consent are nominally P3; credentials and the flow engine are P2.

**Decision.** Client records move into P1. Users get a minimal real slice.
Dynamic client registration, consent screens, MFA and passkeys stay in
P2/P3.

A stored client is not a P3 concern in the first place: stage 1 of the
token pipeline is client authentication, which is meaningless without one.
P3 owns _dynamic_ registration and consent, and those genuinely remain
there.

**Rejected — thin real slices of both.** Equivalent for users, but leaves
clients underspecified, which is the half that blocks everything.

**Rejected — seeded fixtures only.** Provisioning would exist only as test
helpers, so nothing ships and the conformance suite cannot be pointed at
the compose stack the way section 10 of the umbrella spec requires.

### 2.2 Trace stable RFCs; record OAuth 2.1 as deviations

OAuth 2.1 is an Internet-Draft — `draft-ietf-oauth-v2-1-15`, published
2 March 2026, expired 3 September 2026. It obsoletes RFC 6749 and RFC
6750, mandates PKCE and exact `redirect_uri` matching, and removes the
implicit and resource-owner-password grants. It has no stable clause
numbering across revisions.

verified: `WebSearch "draft-ietf-oauth-v2-1 OAuth 2.1 current status 2026
RFC"`, 2026-09-11, returning draft -15 with those dates and status.

**Decision.** Clause tables are keyed to stable RFCs and to the OpenID
Connect specifications. Where OAuth 2.1 is stricter, the affected clause
carries an `n/a` row citing the draft. Odudu _implements_ OAuth 2.1's
strictness; it _traces_ against documents whose numbering does not move.

**Rejected — trace the draft directly.** Most faithful to the phase title,
but every table would be rewritten when `-16` lands, for no gain in
correctness.

**Rejected — a separate delta document.** The deviations are few enough to
sit as rows. A second document is a second thing to keep in sync.

### 2.3 Traced set

Full clause tables: **RFC 6749**, **RFC 7636**, **RFC 6750**,
**RFC 9068**, **OIDC Core 1.0**, **OIDC Discovery 1.0**. A short table for
**RFC 9207**.

A thin `jose.md` covers only the clauses of RFC 7515/7517/7518/7519 that
Odudu depends on directly — `alg` handling, `kid` selection, validation
order. Those are consumed through a library, not implemented, so full
coverage would be tracing someone else's work.

### 2.4 Real persisted flow executor, one authenticator

`/authorize` must authenticate an end-user, but the flow engine —
persisted execution tree, requirement types, save-time validation — is
P2's headline deliverable.

**Decision.** P1 builds the real `authentication_sessions` table and the
real executor state machine, and registers exactly one authenticator
(password). No tree semantics, no `ALTERNATIVE`/`CONDITIONAL`, no
save-time validation. P2 grows what exists rather than replacing it.

The split follows retrofit cost. Persisted, resumable authentication state
is load-bearing now: a password → OTP → consent journey spans several HTTP
round trips and must survive landing on a different replica. Designing
that persistence around a single-step login means P2 pays to redo it. Tree
semantics are self-contained and cost nothing to defer.

**Rejected — hardcoded login with a real session.** Cheaper in P1, and the
specific undo the phase is trying to avoid.

**Rejected — no interactive login.** Cannot satisfy the Basic OP plan.

**Consequence.** `@node-rs/argon2` arrives in P1 rather than P2, and with
it the bundling constraint `docs/NEXT.md` carries: a native `.node` binary
cannot be inlined into an ESM bundle, so it must be marked external in
`tsup.config.ts` regardless of the bundling path in use.

### 2.5 JWT access tokens under RFC 9068

**Decision.** Access tokens are JWTs carrying `typ: at+jwt` and RFC 9068's
required claims, signed by the realm key and verifiable offline against
`/jwks`. Refresh tokens are opaque handles.

Opaque access tokens can only be validated through introspection, which is
out of scope — that combination would issue tokens nothing can verify.
Refresh tokens stay opaque because they are consumed only by Odudu, and
family revocation requires a database row regardless.

`typ: at+jwt` exists to prevent token-type confusion: without a
distinguishing type, a resource server validating "a JWT signed by the
issuer" can be handed an ID token and accept it as an access token, since
both carry the same issuer and signature. Keycloak predates RFC 9068 and
emits `typ: JWT`.

**Consequence.** RFC 9068 requires `aud`, so a minimal audience concept
enters P1. Audience _configuration_ remains P3's.

**Rejected — opaque plus introspection.** Pulls RFC 7662 into P1 and makes
every resource-server call a round trip.

### 2.6 A bootstrap seed CLI

Clients are now P1's, but the admin API is P4 and dynamic registration is
P3. Something must create the first realm, client and user.

**Decision.** A seed subcommand in `apps/server`, running through the real
repository layer, usable in compose, in CI, and by a self-hoster.

**Rejected — testkit-only fixtures.** Cannot support running the
conformance suite against the compose stack.

**Rejected — declarative bootstrap from config at boot.** Creates two
writers for the same rows, one of which runs on every boot, and P4's admin
API would then contend with it for ownership.

A bootstrap path is permanent, not scaffolding: every self-hosted identity
provider needs one.

### 2.7 Multi-key shape now, rotation operation later

**Decision.** `signing_keys` carries `status` and `not_after` from its
first migration. JWKS publishes every non-retired key; signing selects the
active key; validation resolves by `kid`. Private keys are encrypted at
rest under a KEK supplied by environment variable, behind an interface a
KMS adapter can replace. The operation that promotes and retires keys is
deferred.

The expensive half to retrofit is the shape — a JWKS that publishes a set
rather than a singleton, and call sites that select rather than fetch. If
P1 ships a single key, every call site assumes a singleton and no relying
party is ever exercised against a multi-key JWKS. The operation is
self-contained, guarded by the injectable clock, and has nothing to
trigger it before P4.

Encryption at rest is not deferred: it is far harder to introduce once
keys exist in the field.

### 2.8 Conformance: Config OP automated, Basic OP reproducible

The OpenID Foundation suite is self-hostable — a Java application and
MongoDB under Docker Compose, UI on `https://localhost:8443`. Reaching an
OP on the host requires adding `extra_hosts: - "localhost:host-gateway"`
to the services.

verified: `WebSearch "OpenID Foundation conformance suite self-hosted
docker run locally against localhost OP"`, 2026-09-11.

**Decision.** `infra/conformance/` ships a pinned suite version, a
committed test configuration, and a documented procedure. The **Config OP**
plan is automated in CI — it is a discovery test and needs no browser. The
**Basic OP** plan is a reproducible run whose results export is committed.
Unattended automation of the interactive plan waits for P4, when Playwright
and a real login UI arrive.

**Amended 2026-09-12, after standing the suite up.** Basic OP cannot pass
against a server that requires PKCE of every client, and mandatory PKCE
stays. The Basic OP run is therefore evidence rather than a gate: it proves
the only divergence is the intended one, which holds only while every
module's cause is individually confirmed. ADR 0016 carries the full
reasoning and the rejected alternatives.

**Rejected — automated nightly for both.** Depends entirely on how
unattended browser automation of the interactive plan lands, which is the
least predictable item in the budget, for a capability P4 supplies anyway.

**Rejected — manual for both.** Config OP is free to automate; declining
is waste.

## 3. Package topology

P1 creates six of the packages named in umbrella spec section 3:

```
kernel <- contracts, crypto, db <- domain-realm, domain-identity
                                        ^
                     authn-flows, protocol-oidc <- server
```

| Package           | Contains                                                   |
| ----------------- | ---------------------------------------------------------- |
| `contracts`       | Zod schemas and types for the API boundary                 |
| `crypto`          | JWS, JWKS, `kid` resolution, KEK-wrapped keys, Argon2id    |
| `domain-realm`    | realms, clients                                            |
| `domain-identity` | subjects, users, credentials                               |
| `authn-flows`     | the persisted executor and the password authenticator      |
| `protocol-oidc`   | five endpoints, the eight-stage pipeline, its schema slice |

### Who owns a client

A client carries `redirect_uris`, `grant_types` and
`token_endpoint_auth_method` — OAuth vocabulary. But umbrella spec section
3 makes it absolute that domain packages never import protocol packages,
which is what allows SAML to arrive in P8 without touching the identity
model.

**Decision.** Split. `domain-realm` owns a protocol-agnostic `clients`
row; `protocol-oidc` owns `client_oidc_config` keyed to it. At P8,
`protocol-saml` adds a parallel configuration table and the identity model
is untouched.

**Rejected — one wide table in `domain-realm`.** Cheaper now, makes the
domain package protocol-aware, and is the specific outcome the rule exists
to prevent. It is also Keycloak's shape: one `client` table with a
`protocol` discriminator.

**Rejected — the whole client in `protocol-oidc`.** Honest about the
vocabulary, but P4's realm administration could then not list clients
without importing a protocol package.

Cost of the split: one join, one extra table.

## 4. Data model

Eleven new tables. Every one carries `ENABLE` and `FORCE ROW LEVEL
SECURITY`, a policy, and a foreign-`realm_id` probe in the adversarial
suite — the standing obligation `docs/NEXT.md` records from P0, which P1
is the first phase to owe.

**`domain-realm`**

- `clients` — `(id, realm_id, client_id, name, enabled, type, secret_hash,
created_at)`, `type` in `{ public, confidential }`, unique on
  `(realm_id, client_id)`

**`protocol-oidc`**

- `client_oidc_config` — redirect URIs, grant types, response types,
  `token_endpoint_auth_method`, audiences, token lifetimes
- `authorization_codes` — `code_hash`, client, subject, `redirect_uri`,
  scope, `nonce`, `code_challenge`, `code_challenge_method`, `auth_time`,
  `expires_at`, `consumed_at`
- `token_grants` — the durable grant: client, subject, scope, audience
- `refresh_tokens` — `token_hash`, `grant_id`, `expires_at`, `used_at`,
  `replaced_by`

**`domain-identity`**

- `subjects` — as umbrella spec section 5, with all three `type` values
  present from the start
- `users` — `subject_id` PK/FK, `username`, `email`, `email_verified`
- `user_credentials` — `(subject_id, type, secret_data, created_at)`

**`crypto`**

- `signing_keys` — as umbrella spec section 5, with `status` and
  `not_after` from the first migration

**`authn-flows`**

- `authentication_sessions` — resumable executor state
- `sessions` — the browser SSO session behind `__Host-<realm>-session`

### Three decisions inside the model

**`realm_id` on every table, even where derivable.** `client_oidc_config`
could reach its realm through `clients`, and `refresh_tokens` through
`token_grants`. Carrying the column anyway keeps every policy predicate
identical and join-free. A policy containing a join is a policy that gets
written wrong. Cost: one denormalized column, and foreign keys that
include it.

**Codes and refresh tokens are stored hashed.** A backup, a log, or a SQL
injection elsewhere then yields nothing replayable.

**`user_credentials` is a typed row, not a column on `users`.** P2's TOTP
and passkeys become additional rows rather than a migration on the user
table.

### Consequence

`subjects` arriving with all three type values means P5's agent instances
inherit sessions, grants and revocation rather than duplicating them, as
umbrella spec section 5 intends. It also puts the class-table join in the
hot path of every token issuance from day one, so the covering index that
spec mentions is a P1 obligation rather than a later optimization.

## 5. The pipeline and the five layers

Umbrella spec section 4 maps the layers on the server: **view** is the
route handler, **usecase** the flow orchestrator, **repository** state,
**adapter** the Drizzle client, **service** the domain rules. Inbound HTTP
is therefore `view`; outbound database access is `adapter`; `view` touches
neither repository nor adapter.

Within `protocol-oidc`:

| Layer      | Holds                                                       | Stages |
| ---------- | ----------------------------------------------------------- | ------ |
| view       | five route handlers, ajv validation, response serialization | 2      |
| usecase    | `AuthorizationRequest` and `TokenIssuance` orchestrators    | 1–8    |
| service    | PKCE, exact redirect match, scope intersection, grant rules | 3,4,5  |
| repository | codes, grants, refresh families, realm-bound transactions   | 7      |
| adapter    | Drizzle                                                     | —      |

Stage 6 (signing) is `crypto`'s service. Stage 8 (audit) goes through
`kernel`'s `EventListener` registry.

### Claim mappers are the first plugin consumer

Umbrella spec sections 6 and 8 place this in P1 deliberately, so
extensibility is exercised rather than designed in the abstract. `kernel`
gains a `ClaimMapper` registry, and the standard OIDC claims — `sub`,
`name`, `email`, `email_verified` and the rest — are built as registered
mappers, not a hardcoded switch.

This is a deliberate cost. The first mapper is more expensive as a plugin
than as a function, and the return arrives in P10.

### Error routing is security-critical

RFC 6749 section 4.1.2.1 splits `/authorize` failures in two:

- an invalid `redirect_uri` or `client_id` is rendered to the user;
  redirecting here **is** the open-redirect vulnerability
- every other failure redirects to the already-validated `redirect_uri`
  with `error` and the original `state`

Validation order is therefore a service concern with its own unit tests,
not an emergent property of a route handler's early returns. A handler
that validates in a convenient order rather than the specified one is the
bug.

### Request context

Every request runs inside a transaction with `SET LOCAL app.realm_id`,
realm resolved from the path, on P0's machinery.

## 6. Specification traceability

Eight files in `docs/protocols/`: clause tables for `rfc6749.md`,
`rfc7636.md`, `rfc6750.md`, `rfc9068.md`, `rfc9207.md`, `oidc-core.md`
and `oidc-discovery.md`, plus the thin `jose.md` of decision 2.3. Each
holds reading notes and one table:

| Clause  | Level  | Requirement                              | Test ID              | Status                     |
| ------- | ------ | ---------------------------------------- | -------------------- | -------------------------- |
| 4.1.2.1 | MUST   | invalid `redirect_uri` must not redirect | `RFC6749-4.1.2.1-01` | covered                    |
| 4.1.3   | MUST   | authorization code is single-use         | `RFC6749-4.1.3-02`   | covered                    |
| 4.2     | MUST   | implicit grant response                  | —                    | n/a — removed in OAuth 2.1 |
| 3.1.2   | SHOULD | …                                        | `RFC6749-3.1.2-01`   | deferred — P3              |

Status takes exactly five forms: `covered`, `deferred: <phase> —
<reason>`, `n/a: <reason>`, `documented: "<heading>" <reason>`, and `gap`.
The `n/a` rows carry OAuth 2.1's deviations, which is how decision 2.2
stays honest without a second document. `documented:` holds the clauses
that oblige an authorization server to _state_ something rather than to do
it, which no test can observe and which `n/a` would misfile as
inapplicable; its reference quotes a reading-note heading, and `pnpm
trace` checks the heading is still there.

Test IDs appear verbatim in test titles, so a row and a test are greppable
from either direction.

### Enforcement

A `pnpm trace` step joins `pnpm verify`. It parses the tables, runs the
suite with a JSON reporter, and fails when any in-scope MUST is `gap`,
when a referenced ID matches no test, or when a matched test failed.

**Rejected — a reporting-only artifact**, and **rejected — prose
maintained by discipline.** An unenforced table is stale within two
phases, and this project is explicitly built to survive gaps of weeks
(umbrella spec section 12). The cost is honest: a small tool to maintain,
which will sometimes fail CI for a documentation reason — precisely the
annoyance that tempts people to weaken it.

This is also where Odudu exceeds Keycloak, which is extensively
conformance-tested but offers no per-clause traceability readable from the
repository.

## 7. Testing

Levels follow umbrella spec section 10 unchanged.

Nine of the corpus's ten entries become live in P1 — every one except
attenuation widening, which belongs to P5. Expanded into the cases they
cover:

- authorization code replay
- code substitution across clients
- PKCE downgrade on a public client
- `redirect_uri` mismatch and open redirect through loose matching
- algorithm confusion: `alg: none`, and RS256 → HS256 with the public key
  as the HMAC secret
- `kid` path traversal in JWT headers
- audience confusion between clients
- refresh token reuse, revoking the entire family
- session fixation and CSRF on `/authorize`
- cross-realm leakage, probed on every new repository method

Full mix-up belongs to P6; RFC 9207's
`iss` parameter in authorization responses, and
`authorization_response_iss_parameter_supported` in discovery, are in
scope here as its standard defense.

Mutation testing (Stryker) runs on `crypto` only; `agents` does not yet
exist.

## 8. Exit criteria

1. `pnpm verify` green in CI, now including `pnpm trace`
2. Zero `gap` rows across all clause tables; every in-scope MUST `covered`
3. OIDF **Config OP** plan green, automated in CI against the compose
   stack
4. OIDF **Basic OP** plan run reproducibly, with a committed results
   export, and every divergence from it individually confirmed — not
   sampled — as a consequence of mandatory PKCE. The plan cannot pass:
   Basic OP predates PKCE being mandatory and sends plain authorization
   requests in every module but its own PKCE one. ADR 0016 records the
   ruling and what was given up for it.
5. `client_credentials` proven by flow tests and by adversarial cases —
   scope escalation beyond client-allowed, and rejection for a public
   client. The Basic OP plan does not exercise this grant, so without an
   explicit criterion it would be the one grant with no external proof.
6. All P1 adversarial corpus entries green
7. Every new table carries an RLS policy and a foreign-`realm_id` probe
8. `infra/docker/smoke.sh` green and extended: the seed CLI provisions a
   realm, client and user, and a full code+PKCE exchange completes against
   the running stack

**Criterion 2 amended 2026-09-12, after counting the rows it quantifies
over.** As written it is false, and was false on the day the tables were
first filled in. The honest criterion is: **no MUST row is `gap` or
`documented:` in any clause table, and every MUST that is not `covered`
carries one of the three statuses that say why, whose totals are recorded
and checked.** As the phase closes that is 358 MUST rows — 229 `covered`,
18 `accepted:`, 27 `deferred:`, 84 `n/a:`, none `gap`.

Two things were wrong with the original. "Zero `gap` rows across all clause
tables" quantified over every row, and 94 remain — 56 SHOULD and 38 MAY.
That was never the intent: strict mode errors on a MUST `gap` only, so the
build has been green the whole time the criterion's first clause was false,
which is precisely the arrangement a criterion is supposed to prevent. And
"every in-scope MUST `covered`" leaned on "in-scope" to do work nothing ever
defined — 129 MUSTs are not `covered`, and whether each is out of scope is
the judgment written into its status cell, not something the phrase settles.

This is weaker than what was promised, and worth saying so rather than
reading the words to fit. 129 MUST rows are held by an argument rather than
by a test, and 111 of those (`deferred:` and `n/a:`) print nothing on a
normal run. What the phase actually guarantees is that each of the 129 was
looked at, that none can be added without the count that makes it visible
being raised in a reviewed diff (ADR 0017's 2026-09-12 amendment), and that
the remaining SHOULD and MAY gaps are recorded as gaps rather than dressed
up. It does not guarantee that any of the 129 arguments is true; a tool can
check that prose exists and that a number matches, never that either is
right.

Criterion 8 exists because of P0's lesson. A smoke test that only probed
`/health/ready` passed identically before and after the RLS grant existed
— it could not distinguish working from broken. The equivalent trap here
is a smoke test that proves the server boots but never issues a token.

## 9. Assumptions and spikes

`CLAUDE.md` requires every claim about third-party behaviour to carry
`verified:` or `assumption:`, and every `assumption:` on a load-bearing
path to get a spike before the task depending on it.

| #   | Assumption                                                    | Spike                                              |
| --- | ------------------------------------------------------------- | -------------------------------------------------- |
| 1   | `@node-rs/argon2` must be external to tsup; bundle still runs | build the image, run Argon2id inside the container |
| 2   | Basic OP accepts an `http://` issuer for a local OP           | stand the suite up, run discovery against compose  |
| 3   | Config OP can be driven unattended                            | drive one plan through the suite's API, no browser |
| 4   | `jose` rejects `alg: none` and confused algorithms            | feed it the adversarial corpus directly            |
| 5   | Zod→ajv handles `/token`'s form-encoded body                  | one endpoint, one round trip                       |
| 6   | Vitest's JSON reporter exposes titles `trace` can key on      | parse one real run                                 |

If spike 2 finds that TLS is required, P1 needs a certificate story it
does not currently have, and that lands before the conformance increment.

### The known landmine

`docs/NEXT.md` defers this explicitly: `meta/0002_snapshot.json` records
`policies: {}` while `realms_isolation` exists in every migrated database,
so declaring `pgPolicy(...)` makes `drizzle-kit generate` emit a
`CREATE POLICY` that fails with 42710 against an existing database. P1
adds eleven policies. The divergence is resolved before the first new
table's migration, not discovered during it.

## 10. Increment shape

Thirteen groups of work, roughly fifteen increments of two to six hours,
each independently mergeable and each ending green.

1. the `trace` tool, with `rfc7636.md` — the smallest table proves the
   tool
2. the remaining clause tables — several increments
3. resolve the snapshot divergence; establish the RLS pattern for new
   tables
4. `crypto` — keys, KEK, JWKS, `kid`, signing
5. `domain-realm` clients; `domain-identity` subjects, users, credentials,
   Argon2id
6. `authn-flows` — executor, password authenticator, sessions
7. discovery and `/jwks`
8. `/authorize` and `/token` for code + PKCE
9. refresh rotation and family revocation; `client_credentials`;
   `/userinfo`
10. the claim mapper registry
11. the seed CLI
12. the adversarial suite
13. the conformance harness

Clause tables come first so the gaps they expose drive task order, which
is what `docs/NEXT.md` asks for.

The largest unknown in the budget is item 2. Reading OIDC Core and RFC
6749 closely enough to table every MUST is the phase's single biggest
uncertainty, and it is also the learning goal — an overrun there is the
good kind.

## 11. Carried into later phases

- Consent, dynamic client registration and audience configuration — P3
- The key rotation operation and its overlap window — P3 or P4, whichever
  first has a caller
- MFA, passkeys, flow tree semantics and save-time validation — P2
- Unattended conformance automation for interactive plans — P4, with
  Playwright
- Introspection, revocation endpoint, RP-initiated logout, device, CIBA,
  token exchange, PAR, DPoP

## 12. Where this phase exceeds Keycloak

Each of these is a place where the specification permits a weaker
configuration, Keycloak offers it, and Odudu does not.

- **PKCE is mandatory and `S256` only.** Keycloak makes it a per-client
  setting, and permits `plain`.
- **`redirect_uri` matching is exact.** Keycloak supports wildcard
  patterns, which is the loose matching that produces open redirects.
- **Access tokens carry `typ: at+jwt`.** Keycloak predates RFC 9068 and
  emits `typ: JWT`, leaving resource servers open to token-type confusion.
- **`iss` is returned in authorization responses** (RFC 9207).
- **Authorization codes and refresh tokens are stored hashed.**
- **Signing keys are encrypted at rest** under a replaceable KEK. Keycloak
  stores realm private keys in plaintext.
- **Client configuration is split** along the protocol boundary rather
  than collected in one wide table with a protocol discriminator.
- **Per-clause traceability is enforced by CI.**
