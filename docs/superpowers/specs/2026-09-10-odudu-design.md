# Odudu — Design

**Date:** 2026-09-10
**Status:** Approved

_Odudu_ means power or authority in Ibibio (Akwa Ibom, Nigeria).

## 1. What this is

An identity and access management platform with feature parity to Keycloak,
plus a first-class agent identity layer that Keycloak lacks.

Self-hostable as one container plus PostgreSQL. Written in TypeScript on
Node 24.

### Goals

- Full Keycloak feature parity: OIDC/OAuth provider, SAML IdP, user
  federation, identity brokering, authorization services, admin and account
  consoles, an extensibility system, and high availability.
- Production quality. Real deployments, real users.
- Delegated authority for AI agents, with guardrails and an MCP admin
  surface. This is the differentiator.
- Deep protocol understanding for the author. The specifications are the
  learning target; the code is how that learning is verified.

### Non-goals

- Purchasing OpenID Foundation certification. The conformance suite is used
  as an engineering quality bar, not to obtain a badge.
- Supporting databases other than PostgreSQL, initially.
- Operating Odudu as a hosted service. Realms provide logical multi-tenancy
  within one deployment, but the delivery model is self-hosting.

### Constraints

- Development happens in bursts, with gaps of weeks. Every increment must
  end resumable.
- Effort is budgeted in hours, never calendar dates.

This document is the umbrella design. Each phase in section 11 gets its
own specification and implementation plan before it is built; this one
fixes the decisions that span all of them.

## 2. Decisions

Each of these has an ADR in `docs/adr/` recording the alternatives and why
they were rejected.

| Area               | Decision                                                     | ADR  |
| ------------------ | ------------------------------------------------------------ | ---- |
| Runtime            | TypeScript on Node 24                                        | 0001 |
| Deployment         | Self-hostable: one container + PostgreSQL                    | 0002 |
| Agent model        | Hybrid: type is a client, instance is an ephemeral principal | 0003 |
| HTTP               | Fastify 5                                                    | 0004 |
| Database           | PostgreSQL 17 only                                           | 0005 |
| DB access          | Drizzle ORM                                                  | 0006 |
| Schemas            | Zod 4 authored, compiled to JSON Schema                      | 0007 |
| Lint               | ESLint 10 flat with type-aware rules                         | 0008 |
| Tenancy            | Shared tables keyed by realm, with row-level security        | 0009 |
| Code structure     | Five functional layers, enforced                             | 0010 |
| Monorepo           | pnpm workspaces + Turborepo                                  | 0011 |
| TypeScript version | Pinned to 6.x, not 7.x                                       | 0012 |
| Imports            | Node subpath imports (`#/*`), not path aliases               | 0013 |
| Dev credentials    | Environment-driven (`.env`, gitignored), loopback-bound      | 0015 |

The runtime choice rests on precedent: `node-oidc-provider` is an officially
OpenID-certified provider written in JavaScript, and Logto ships the full
product shape in TypeScript. Node is a demonstrated platform for this
domain, not a gamble.

We do not depend on `node-oidc-provider`. The provider is built here; that
is the point. `jose` is used for cryptographic primitives.

## 3. Repository topology

```
odudu/
├─ apps/
│  ├─ server/              # the deployable; composes modules
│  ├─ admin-console/
│  └─ account-console/
├─ packages/
│  ├─ kernel/              # module registry, config, lifecycle, errors, clock, IDs
│  ├─ contracts/           # schemas and types shared across the API boundary
│  ├─ crypto/              # JWS/JWE, JWKS, key rotation, password hashing
│  ├─ db/                  # connection, migration runner, schema aggregation
│  ├─ domain-realm/
│  ├─ domain-identity/
│  ├─ authn-flows/
│  ├─ protocol-oidc/
│  ├─ protocol-saml/       # P8
│  ├─ authz/
│  ├─ agents/
│  ├─ admin-api/
│  ├─ mcp/
│  ├─ federation-ldap/     # P7
│  └─ testkit/
├─ docs/{superpowers/specs,adr,protocols}
└─ infra/{docker,conformance}
```

Dependency direction, enforced by workspace manifests and
`dependency-cruiser`:

```
kernel ← contracts, crypto, db ← domain-* ← protocol-*, authn-flows,
                                            authz, agents, admin-api ← server
```

Two rules are absolute:

- Domain packages never import protocol packages. Users do not know what
  OIDC is. This is what allows SAML to arrive in P8 without touching the
  identity model.
- Protocol packages never import each other.

Each domain package owns its own Drizzle schema slice. The `db` package
aggregates them so there is exactly one ordered migration timeline.

The `kernel` module registry is the plugin system. Because the server
composes itself from registered modules from day one, third-party
extensibility (P10) is additive rather than a rewrite.

Both consoles compile to static assets served by `apps/server`, which is
what keeps the single-container promise honest.

## 4. Code structure: five functional layers

Applies to the consoles and the server alike.

| Layer      | Responsibility                                             | Business logic          |
| ---------- | ---------------------------------------------------------- | ----------------------- |
| view       | render; integration code only                              | no                      |
| usecase    | orchestrate one journey; arrange a view model              | no                      |
| repository | maintain state; decide when to refetch                     | no                      |
| adapter    | talk to the network or the database; own the wire contract | API-contract logic only |
| service    | domain and application logic; side effects                 | yes                     |

Permitted imports:

| Layer      | May import                       | Never imports             |
| ---------- | -------------------------------- | ------------------------- |
| view       | own model, `shared/view`         | repository, adapter       |
| usecase    | repository, service, view models | adapter                   |
| repository | adapter, service                 | view, usecase             |
| adapter    | transport, service               | view, usecase, repository |
| service    | nothing                          | everything else           |

Features expose a single `index.ts`; no feature reaches into another's
internals.

`service` is the sole home of domain rules. `adapter` owns endpoints, DTO
shapes, pagination, retry, and error translation — but no domain rules.

On the server the layers map to: route handler, flow orchestrator,
repository, Drizzle/LDAP/SMTP client, domain service.

Folder-level boundaries are enforced by `dependency-cruiser` in CI. A
convention without mechanical enforcement decays in weeks.

### Imports

Intra-package imports use Node subpath imports, never relative paths. Each
package declares:

```json
{ "imports": { "#/*": "./src/*.ts" } }
```

and code inside it imports as `#/clock`. Relative specifiers are
forbidden in package and app source and tests, enforced by ESLint's
`no-restricted-imports`.

Cross-package imports use the package name — `@odudu/kernel` — and resolve
only through that package's `index.ts`.

Specifiers carry no file extension: the mapping targets `./src/*.ts`, so
`#/clock` resolves to the real `clock.ts` rather than to an emitted filename
that does not exist on disk.

The two prefixes therefore carry meaning: `#/` is always "inside this
package", `@odudu/*` is always "another package's public surface". Node
scopes `#` specifiers to the package that declares them, so no package can
reach another's internals even by accident. Layer and package boundaries
stop being rules we police and become properties of the resolver.

### Comments

Comments carry only what the code cannot. No restating the obvious, no
ceremony. Where no comment is needed, none is written.

## 5. Data model

### Tenancy

Shared tables keyed by `realm_id`, with two independent defenses against
cross-tenant leakage:

1. The repository layer cannot construct a query without a realm context.
   This is a type-level requirement, so omitting it fails to compile.
2. PostgreSQL row-level security. The application connects as a
   non-superuser role; tenant tables use `FORCE ROW LEVEL SECURITY`; each
   transaction issues `SET LOCAL app.realm_id`.

`SET LOCAL` is required rather than `SET`: a session-scoped setting leaks
realm context between requests sharing a pooled connection. This has an
explicit test.

The policy predicate wraps the setting in `nullif(…, '')` before casting.
`current_setting(name, true)` yields `NULL` only until a backend first touches
the GUC; afterwards it reverts to the empty string at transaction end, and
casting `''` to `uuid` raises an error rather than filtering. With `nullif`,
missing realm context yields zero rows rather than an exception — the policy
fails closed either way.

A `system` realm exists and is structurally identical to every other realm.
Cross-realm administration is an explicit permission, not a property of
living in a particular realm. This avoids Keycloak's `master` realm
confusion.

### Subjects

```
subjects (id UUIDv7 PK, realm_id, type, disabled_at, created_at)
   type ∈ { user, service, agent_instance }
   ├── users           (subject_id PK/FK, username, email, email_verified, …)
   ├── service_accts   (subject_id PK/FK, client_id)
   └── agent_instances (subject_id PK/FK, agent_type_client_id,
                        owner_subject_id, parent_instance_id,
                        granted_scopes, max_depth, expires_at,
                        budget_*, approval_policy)
```

Class-table inheritance, chosen so that sessions, consents, role
assignments, audit events, and token grants all have one uniform foreign-key
target. Agent instances inherit that machinery rather than duplicating it,
and revocation has a single home. The cost is one join on user lookup,
mitigated by a covering index.

UUIDv7 for all primary keys: time-ordered so index inserts stay at the right
edge, and non-enumerable, which matters because IDs appear in tokens and
admin URLs.

### Keys

```
signing_keys (id, realm_id, kid, alg, status, public_jwk,
              private_jwk_encrypted, created_at, not_after)
              status ∈ { active, rotating, retired }
```

Rotation uses an overlap window: the new key signs immediately, the retired
key remains published in JWKS until every token bearing its `kid` has
expired. Retiring a key early breaks every relying party at once, so
`crypto` has an isolated test suite driven by an injectable clock.

Private keys are encrypted at rest under a key-encryption key supplied by
environment variable, behind an interface so a KMS adapter can replace it.
Keycloak stores realm private keys in plaintext; this is a cheap
improvement.

### Migrations

One forward-only ordered timeline. Expand/contract discipline from the first
migration — add, backfill, switch reads, drop — so in-place upgrades never
require downtime. This cannot be retrofitted onto a schema already running
in the field.

## 6. Request and token pipeline

Realms resolve from the path: `/realms/{realm}/protocol/openid-connect/…`.
Subdomain-per-realm would give free cookie isolation but demands wildcard
DNS and certificates from every self-hoster. Cookies are therefore
namespaced per realm (`__Host-<realm>-session`). This is weaker than host
isolation and realm separation in the browser rests on our own discipline.
Subdomain mode remains available later as configuration.

Every request carries a context built at the edge: correlation ID, resolved
realm, a database transaction bound to `app.realm_id`, and an injectable
clock.

Token issuance funnels every grant type through eight stages. Only stage 3
is grant-specific.

1. Client resolution and authentication — `client_secret_basic`,
   `client_secret_post`, `private_key_jwt`, `tls_client_auth`, or none with
   PKCE required.
2. Structural validation, by ajv compiled from the Zod schema.
3. Grant-specific validation — code with PKCE, refresh, client credentials,
   token exchange (RFC 8693), device, CIBA.
4. Scope resolution — requested ∩ client-allowed ∩ consented ∩ delegated.
5. Claims assembly, via registered claim mappers.
6. Signing.
7. Grant persistence and refresh rotation.
8. Audit event emission.

The agent layer plugs into stage 4 alone: for an agent instance, the
delegated intersection is the attenuation check. No forked pipeline. That
this is possible is the test that the hybrid agent model was correct.

Claim mappers are the first consumer of the plugin system, in P1, so
extensibility is exercised early rather than designed in the abstract.

## 7. Authentication flow engine

A flow is a persisted tree of executions, each carrying a requirement of
`REQUIRED`, `ALTERNATIVE`, `CONDITIONAL`, or `DISABLED`. Each execution is
an `Authenticator` module returning `success`, `challenge(form)`,
`attempted`, or `failure`.

The executor is a state machine persisted in an `authentication_sessions`
row, never in memory: a password → OTP → consent journey spans several HTTP
round trips and must survive landing on a different replica.

Keycloak's tree model is adopted because linear step lists cannot express
"password or passkey, then OTP if enrolled", and a rules DSL is
unconfigurable by non-programmers.

One correction to Keycloak: flow configurations are validated at save time
and ambiguous trees are rejected with a specific error. Keycloak permits
saving structurally broken flows that fail only at runtime, when a user
cannot log in.

## 8. Extensibility

`kernel` exposes typed registries for `Authenticator`, `ClaimMapper`,
`CredentialProvider`, `EventListener`, `UserStorageProvider`,
`PolicyProvider`, and `ThemeProvider`.

Through P5 all providers are compiled in and registered at boot. Dynamic
third-party loading arrives in P10, in-process, matching Keycloak. The
registry API is deliberately call-boundary-shaped — asynchronous,
serializable arguments, no live object handles — so that relocating a
provider into a worker thread for isolation later is a configuration change
rather than an API redesign.

## 9. Agent identity layer

An agent _type_ is a registered OAuth client. An agent _instance_ is an
ephemeral first-class principal minted at delegation time, carrying its
owner, type, parent, granted scopes, budget, and expiry, and reaped on TTL.

This keeps the wire format standards-native while providing per-instance
revocation, budgets, and audit lineage. A relying party that understands
RFC 8693 needs no knowledge of the model.

Invariants enforced by the `agents` service:

- child scopes ⊆ parent scopes; strictly attenuating, never widening
- child TTL ≤ parent TTL, and never beyond the root user session
- chain depth ≤ `max_depth`
- revoking any link transitively revokes everything below it

On the wire: `sub` is the agent instance, `act` names the actor, nested
`act` claims express the chain, and `may_act` on the owner's token declares
who may act for them.

Budgets are counters decremented atomically with `UPDATE … RETURNING`.
Read-modify-write would allow concurrent agent calls to overspend, and
concurrency is the normal case for agents.

Human-in-the-loop approval is structurally identical to CIBA: the agent
calls a backchannel endpoint, the owner is notified out of band and
approves, the agent polls or is notified. Approvals therefore reuse the CIBA
machinery rather than inventing a protocol, and implementing CIBA serves two
goals at once.

The MCP server exposes the admin API so that assistants can author policy,
audit configuration, and explain authorization decisions.

## 10. Testing

| Level       | Scope                               | Infrastructure            | Frequency          |
| ----------- | ----------------------------------- | ------------------------- | ------------------ |
| Unit        | service packages                    | none                      | every save         |
| Contract    | repository and adapter              | Testcontainers PostgreSQL | every PR           |
| Flow        | full grant journeys over HTTP       | app + database            | every PR           |
| Adversarial | attacks that must fail              | app + database            | every PR           |
| Conformance | OpenID Foundation suite             | full compose stack        | nightly, on demand |
| Load        | token endpoint, Argon2id throughput | k6                        | per phase          |
| Console     | Playwright                          | app + seeded realm        | every PR           |

Unit tests sit beside the code they cover, so a module with no test
alongside it is visibly untested. Container-backed integration tests live in
a per-package `tests/` directory instead: they are slow, need Docker, and run
as a separate Vitest project.

Integration tests run against real PostgreSQL, never a mock. The bugs that
matter in an identity provider live in transaction boundaries, unique
constraints, and concurrent refresh — precisely the class a mocked database
hides.

### Adversarial corpus

A permanently growing suite asserting that the wrong things fail. Each entry
corresponds to a real vulnerability class:

- authorization code replay, and substitution across clients
- PKCE downgrade on a public client
- `redirect_uri` mismatch and open redirect through loose matching
- algorithm confusion: `alg: none`, and RS256 → HS256 with the public key
  as the HMAC secret
- `kid` path traversal in JWT headers
- audience confusion between clients
- refresh token reuse, which must revoke the entire token family
- session fixation, CSRF on `/authorize`, mix-up attacks
- cross-realm leakage, probed on every repository method
- attenuation widening by an agent instance

Attenuation is covered by property-based tests over randomly generated
delegation chains, not only hand-written cases. Mutation testing (Stryker)
runs on `crypto` and `agents` only, where invariant density justifies it.

### Specification traceability

Each specification gets a file in `docs/protocols/` holding reading notes
and a requirement table mapping clause to requirement level to test
identifier. This makes the learning goal and the conformance goal the same
activity, and gives a countable definition of phase completion: every MUST
in the in-scope specifications has a passing test.

Implementation follows test-driven development.

## 11. Roadmap

| #   | Phase                                                            | Effort    | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Foundation                                                       | 20–30 h   | `pnpm verify` green in CI; server boots in a container; migration runner proven; ADRs committed; boundaries enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P1  | OAuth 2.1 / OIDC core                                            | 60–100 h  | OIDF Config OP plan passes; Basic OP runs reproducibly with every divergence confirmed as a recorded decision (ADR 0016); every in-scope MUST traced to a test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2a | Identity model: roles, groups, client scopes, web origins, email | 90–130 h  | realm and client roles, composite roles, groups and client scopes emitted into tokens; a user profile beyond the username — attributes, their storage, and the standard OIDC claims mapped out of them; per-client web origins so a browser client completes the flow; email delivered, with self-registration, address verification and password reset on top of it                                                                                                                                                                                                                                                                                      |
| P2b | Credentials, MFA and the session lifecycle                       | 95–130 h  | password, TOTP, passkey and recovery-code login through the flow tree; password policies and brute-force protection; an SSO session that is read as well as written, with idle and maximum lifespans, ended by RP-initiated logout; offline access; mail sent off the request path; expired state reaped on a stated retention window, with a test that fails if reaping breaks code or refresh-token reuse detection; adversarial suite green                                                                                                                                                                                                            |
| P3  | Realms, clients, consent, dynamic registration                   | 75–110 h  | OIDF Dynamic OP plan passes; a consent screen a user can refuse, with the per-client scope allowlist that decides what it asks for and a recorded grant it can be asked against again; RFC 8707 `resource` indicators, with the per-client audience configuration that makes `aud` derived rather than asserted; signed and encrypted UserInfo responses, selected by client registration; front-channel and back-channel logout against registered per-client logout URIs; token introspection and revocation; `private_key_jwt` and mTLS client authentication, with a rate limit on `client_secret` attempts at `/token`; cross-realm RLS probes green |
| P4  | Admin API and consoles                                           | 135–200 h | full lifecycle manageable from the UI, including listing a subject's sessions and ending one, and promoting a new signing key and retiring the one it replaces on the overlap window §5 states, with JWKS proven to publish both for its duration; another application able to provision users through the admin API as a service account holding admin roles; an account console for self-service; audit events persisted and queryable; realm import and export; Playwright green; OpenAPI published                                                                                                                                                    |
| P5  | Agent identity layer                                             | 80–120 h  | property-based attenuation tests pass; budgets atomic under concurrency; CIBA approvals end to end                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P6  | Identity brokering                                               | 50–70 h   | login via Google and an upstream OIDC IdP; a user provisioned just in time on first brokered login, with the account-linking decision that implies; mix-up tests green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P7  | User federation and inbound provisioning                         | 80–130 h  | LDAP-backed authentication, write-back and sync; SCIM 2.0 inbound provisioning, including deprovisioning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P8  | SAML 2.0 IdP                                                     | 100–150 h | interop with a real SP; signature-wrapping corpus green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P9  | Authorization services                                           | 100–150 h | policy evaluation and UMA 2.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P10 | Extensibility and theming                                        | 60–100 h  | a third-party provider loads without a rebuild                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P11 | HA, clustering, performance                                      | 60–100 h  | three replicas behind a load balancer; documented p99                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P12 | Operational readiness                                            | 40–70 h   | a versioned image published from a tagged release, with the release process written down; secrets sourced from somewhere other than the process environment, through the interface §5 already puts the key-encryption key behind; backup and restore guidance proven by restoring into an empty database and completing a login against the restore                                                                                                                                                                                                                                                                                                       |

Total: roughly 1045–1590 hours.

After P4, at roughly 475–700 hours, Odudu is usable behind real
applications. Everything beyond is breadth, and each phase is independently
valuable and independently abandonable.

That figure said "roughly 300 hours" until 2026-09-14, which was the sum
before P2 became two phases and before the rows below were added to P2a, P3
and P4. It is a sum of the six rows above it, not an estimate of its own.

### What the roadmap did not name

This roadmap was written outward from the protocol, which is why it is
strong on protocol depth and was thin on the identity model and the
administrative surface around it. The following were found missing on
2026-09-13 by reading Keycloak's surface against all twelve phases, and
checked against the code rather than assumed. They are recorded here so the
gap is a decision rather than a discovery made twice.

**Three moved to the top of P2, because they change other phases rather
than merely adding to them.**

_Roles, groups and client scopes._ The largest single omission. Realm roles,
client roles, composite roles, groups, default roles and scope mappings are
the model every application integrating with an identity provider expects,
and nothing in twelve phases named any of it — P9's authorization services
is UMA 2.0 and policy evaluation, which sits **on top of** roles rather than
supplying them. Odudu's only authorization primitive today is a scope
string. This changes the token contract, so it belongs before the phases
that consume it, and it is most of why P2's estimate moved from 60–80 to
140–200 hours.

_Per-client web origins._ There is no CORS handling anywhere in the server.
A public single-page client — the exact shape `docs/request-paths.md` walks
a reader through — cannot call `/token` or `/userinfo` from a browser,
because the preflight fails. The flow is documented and tested end to end
with `curl`, and does not work from the user agent it was designed for.

_Email delivery, and the account lifecycle downstream of it._ No SMTP, no
templates. That silently blocks self-registration, password reset, address
verification, and makes `email_verified` a stored boolean nothing can ever
set honestly. It is a prerequisite shared by several features rather than a
feature, which is how it went unnamed.

**Placed in the phase that already owns the surface.** Password policies,
brute-force protection, session idle and maximum lifespans, and offline
access join P2. Token introspection (RFC 7662) and revocation (RFC 7009),
and the `private_key_jwt` and mTLS client authentication methods, join P3
with the rest of the client-facing surface. A self-service account console,
persisted and queryable audit events, realm import and export, and
admin-configurable protocol mappers join P4 — P1 emits events into a
registry that nothing stores, and the claim mappers are code-only.

**Nothing is ever deleted, and the roadmap named no phase to fix it.**
Found on 2026-09-14 by reading the four tables that carry `expires_at`
against the repositories that write them. `sessions`,
`authentication_sessions`, `authorization_codes` and `refresh_tokens` all
enforce expiry **at read time** — `WHERE … AND expires_at > now()` plus
explicit checks — so an expired row can never be used. There is no `DELETE`
statement in any repository in the codebase. Every row any of those tables
has ever held is still there.

What that costs, measured against P1's code rather than guessed. P1 never
reuses a session, so **every** `/authorize` request writes an
`authentication_sessions` row — abandoned or completed alike — and it stays,
holding `client_id`, `redirect_uri`, `scope`, `state`, `nonce` and
`code_challenge`. Every login writes an `authorization_codes` row that is
dead 60 seconds later. Every refresh rotation writes a `refresh_tokens` row;
a client refreshing every five minutes leaves about 288 rows per session per
day, for good. That is unbounded growth on the hot path of the busiest
endpoints, and a durable record of who logged in to what, kept for no stated
reason and for no stated period.

It went unnamed because the roadmap was written outward from the protocol
and **no OAuth or OpenID Connect specification says anything about
retention** — verified by reading them, not recalled: RFC 9700 and
`draft-ietf-oauth-v2-1-13` contain zero occurrences of "retention",
"purge" or any form of "delete", and OIDC Core's three uses of "retain" are
all about decommissioned signing keys. Storage is left to the
implementation, so a roadmap that tracks clauses will never grow this row by
itself.

**It belongs in P2b, and the reason is that a lifespan is half a rule.**
P2b already owns session idle and maximum lifespans; a lifespan says when
something stops working and says nothing about when it stops existing. The
phase that decides how long a session lives is the phase that should decide
how long its wreckage is kept.

**What makes it a design question rather than a cron job:** the dead rows
are load-bearing. Refresh-token reuse detection
(`packages/protocol-oidc/src/usecase/refresh-rotation.ts`) finds the
already-used row and revokes the whole family; delete it and a replayed
token reads as _unknown_ instead of _reused_, so it is still refused with
`invalid_grant` — identically, to the client — while family revocation
silently never fires. The same holds for a consumed `authorization_codes`
row, which is what RFC 6749 §4.1.2's "SHOULD revoke (when possible) all
tokens previously issued based on that authorization code" is reached
through. So retention is bounded below by the **detection window**, which is
the life of the grant family, not the life of the token: a refresh token's
TTL can be minutes while the family it belongs to lives for weeks. Deleting
on `expires_at` alone would disable the phase's own headline security
property and leave every test green. ADR 0021 carries the decision, the
alternatives, and what Keycloak does instead.

**Deliberately left unplaced, and why.** PAR (RFC 9126), DPoP, mTLS-bound
tokens, the device authorization grant, and step-up authentication with
`acr`/`amr` have no phase. Naming one now would be guessing: DPoP and PAR
are the prerequisites for the FAPI 2.0 profiles that ADR 0016 identifies as
the certification Odudu could actually hold, so they should be scoped
together with that decision rather than scattered. These are the only
unplaced items left; the signing-key rotation operation was one of them
until 2026-09-14, and is settled below.

### Exit criteria that omitted work their phase already owned

Also 2026-09-14, and a different failure from the one below: these were
never unplaced, they were placed everywhere except in the sentence that
decides when the phase is finished. A phase is done when its criterion is
met, so work named only in prose is work that can be skipped without
anything going red.

- **P3 did not name consent**, which is in the phase's own title. It now
  names a consent screen a user can refuse, the per-client scope allowlist
  that decides what it asks for, and a recorded grant.
- **P3 did not name RFC 8707 `resource` indicators**, though the
  `deferred:` rows in `docs/protocols/rfc9068.md` send audience derivation
  there and `docs/NEXT.md` counts them among P3's rows. Without them `aud`
  is an operator assertion rather than something the server derives.
- **P3 did not name signed or encrypted UserInfo responses**, whose six
  clause rows in `docs/protocols/oidc-core.md` carry `deferred: P3` for a
  precise reason — §5.3.2's obligations only become expressible once a
  client can request one at registration, which is P3's to build.
- **P2a named self-registration and address verification but not password
  reset**, which appeared only in this section's prose as one more thing
  email blocks. It is now in the criterion with the other two.
- **Nothing named a rate limit on `client_secret` attempts at `/token`.**
  RFC 6749 §2.3.1's MUST is "any endpoint using password authentication",
  and client-secret authentication is password authentication of a client —
  so the clause has two endpoints, not one. P2b's account lockout and its
  per-IP throttle both protect the end-user login; neither touches `/token`.
  `docs/protocols/rfc6749.md` carries it as `deferred: P3`, which P3 now
  names, because P3 already reworks client authentication for
  `private_key_jwt` and mTLS and that is where per-client limits belong.

P3's estimate moves from 60–90 to 75–110 hours: consent was always costed,
being in the title, and resource indicators and JWE/JWS UserInfo were not.
The `/token` rate limit is inside that range rather than adding to it — it
is a limiter beside one that P2b will already have built, applied to a
different key.

### Four things the roadmap had no phase for, and where they went

Found on 2026-09-14, reading `docs/request-paths.md`'s "what is not
implemented" list against the roadmap rather than against the code. Each was
either genuinely unplaced or placed only in prose, which is the same thing
to anybody reading the table.

**The signing-key rotation operation lands in P4**, and P4's exit criterion
now says so. The shape exists and the operation does not: `signing_keys`
carries `status` and `not_after`, `signing_keys_one_active` permits exactly
one active key, JWKS publishes every non-retired key and signing selects the
active one — but `packages/crypto`'s repository offers `create`, `active`
and `listPublishable`, and nothing that promotes or retires. The prose has
said P3 and P4 at different times, and the tie-breaker is that rotation has
no protocol client. Nothing a relying party sends triggers it. It is an
operator pressing a button, and it needs three things P3 does not have and
P4's exit criterion already names: an authenticated administrator, an audit
event recording who rotated what and when, and a surface to trigger it from.
P3 is client-facing throughout — registration, consent, introspection,
logout URIs — and giving it rotation would mean building an administrative
path there with nowhere to put it. Nothing forbids an earlier CLI if a
deployment needs one before P4; the phase that must prove rotation works is
P4.

**A user profile beyond the four claims lands in P2a**, and P2a's exit
criterion now names it. Today `sub`, `name`, `email` and `email_verified`
are all there is, and `name` is the username because no display name exists.
Emitting the standard OIDC claims needs user attributes, their storage and
their mapping, and that is the identity model P2a was reopened to build —
the same phase as roles, groups and client scopes, for the reason that
phase gives for itself: **it changes the token contract, so it belongs
before the phases that consume it.** P4's admin-configurable protocol
mappers are the argument's other half; a mapper maps an attribute, and P4
would otherwise be building configuration over a thing that does not exist.
The split is that P2a owns the attributes and the claims they produce, and
P4 owns letting an administrator reconfigure that mapping. P2a's estimate
moves from 70–100 to 90–130 hours.

**Published images and a release process, secret management beyond
environment variables, and backup and restore guidance become P12,
Operational readiness.** They read as three gaps and are one: nothing in
twelve phases was addressed to the person running this rather than the
person integrating with it, because the roadmap was written outward from the
protocol and no specification has a clause about a tag, a secret store or a
`pg_dump`. ADR 0015 settles where credentials live for the local stack and
says nothing about how a deployment manages them; ADR 0002 fixes the
single-container shape without saying how that container reaches anybody.

The alternative was widening P11 and renaming it. P11's audience is the same
— operators — but its work is not, and folding four unrelated items into
"three replicas behind a load balancer; documented p99" would trade a
criterion that can be failed for a list that can only be argued about. The
roadmap's own reason for splitting P2 applies: a phase nobody can finish is
a phase nobody starts. Appending is also the safe move where inserting is
not, for the reason the P2 note gives — roughly 150 `deferred:` rows carry
an intent rather than a digit, `pnpm trace` skips them, and ADRs 0016 and
0017 cite phase numbers. **Nothing is renumbered.**

**P12 is last in the table and is not last in dependency order, and the
table cannot say that on its own.** Publishing an image depends on nothing
in P3 through P11. It is a prerequisite for anybody deploying this at all,
and the honest reading is that it should be pulled forward the moment there
is a version worth tagging — arguably now. Secret management is nearly as
free: §5 already puts the key-encryption key behind an interface so a KMS
adapter can replace it, and writing that adapter needs no phase's output,
only a decision about which store to target. Backup and restore guidance is
the one with a real dependency, and it is not on clustering either: a
restore is only worth documenting once what must be restored consistently
has stopped moving, which means after P2b adds credentials and reaping and
after P4 adds realm export. What P12 genuinely cannot precede is nothing.
Its position records that no phase before it had a reason to stop and do
this work, not that the work waits on them.

### How a user gets into a realm

An identity provider that can only be populated by an administrator is not
one anybody deploys. There are four ways in, they are not alternatives to
each other, and a realm typically has several enabled at once. Recording
them here because the roadmap named endpoints and phases without ever saying
which of these it was building.

**Self-registration.** A "Register" link beside the login form; the user
creates their own account in Odudu's own UI, and the application never sees
a credential. It is a per-realm setting and a registration flow, and it is
the reason email is a **P2a** prerequisite rather than a nicety — an
unverified self-registered address is an account-takeover primitive, so the
verification path has to exist before the registration path is useful.

**The admin API, called by another application.** The relying party's
backend authenticates as a service account holding admin roles and creates
the user itself. This is how most business-to-business integrations work:
the application owns its signup form and its own onboarding, Odudu owns the
account. It needs **P2a**'s roles to exist before **P4**'s API can be
authorised by them, which is one more reason roles come first.

**Just-in-time provisioning.** The user authenticates against Google or an
upstream provider and the local account is created from that assertion on
first login. Nobody registers at all. It belongs with brokering at **P6**,
and it carries a decision that is easy to miss: what happens when the
asserted address matches an existing local account — link, refuse, or
challenge. Getting that wrong is an account-takeover path, so it is named in
the exit criterion rather than left to implementation.

**SCIM 2.0 inbound provisioning.** A directory or an HR system pushes users
and groups continuously, and — the half people forget — **deprovisions**
them. This is the standard answer when an enterprise asks how their
directory stays in sync, and Keycloak does not ship it natively, which makes
it a place to be better rather than a place to match. It joins **P7**, where
the other directory-synchronisation machinery lives.

Today none of these exists: the seed CLI is the only way to create a user,
which is why it can look as though accounts must be made by hand before
anyone can log in. That is a property of P1, not of the design.

**The console framework is not chosen.** `apps/admin-console/` and
`apps/account-console/` are in the structure, compile to static assets
served by `apps/server`, and are exercised by Playwright — but no ADR picks
what they are built with. React appears once in ADR 0001 as an aside and is
not a decision. **P4 owes that ADR before its first line of console code**,
with the deferred-until-informed reasoning that ADR carries for everything
else.

**P2 is two phases sharing a number, not one.** It was a single 60–80 hour
phase until the identity model was found missing from the roadmap
altogether; adding roles, groups, client scopes, web origins and email
doubled it, and a phase nobody can finish is a phase nobody starts. P2a and
P2b each get their own spec, plan and exit criteria, and P2a comes first
because roles change the token contract that P2b's sessions and everything
after them read.

They share the number **deliberately**. Renumbering the tail of the roadmap
would rewrite roughly 150 `deferred:` rows in the clause tables whose intent
is a phase rather than a digit — and `pnpm trace` skips `deferred:` rows
entirely, so a row renumbered wrongly would be invisible for good. ADRs 0016
and 0017 also cite phase numbers, and an accepted ADR is corrected by
appending, not by editing what it said. An existing `deferred: P2` row means
**P2b** unless it concerns roles, groups, web origins or email.

**Logout, and why it is split across three phases.** This roadmap named no
phase for logout until 2026-09-13, which was an omission rather than a
decision: a provider with no way to end a session is not at parity with the
incumbents, whatever else it does. It is split because the three logouts
need different things and become possible at different times.

_RP-initiated logout_ (`end_session_endpoint`, OpenID Connect RP-Initiated
Logout 1.0) lands in **P2**, because that is where the SSO session becomes
real. P1 writes a session cookie and never reads it, and an endpoint that
ends a session nothing consults would be theatre — the tests could only
assert a row changed. P2 makes the session load-bearing, so the same phase
should make it endable.

_Front-channel and back-channel logout_ land in **P3**, because both are
addressed to a client rather than to a browser: they need per-client
`frontchannel_logout_uri` / `backchannel_logout_uri` registered, which is
client-registration metadata. Back-channel additionally issues a **logout
token** — a second token type with its own claim rules, which means its own
clause table under `docs/protocols/` rather than a footnote in an existing
one.

_Administrative session termination_ — listing a subject's sessions and
ending one on their behalf — lands in **P4** with the rest of the admin
surface, because until there is an admin API there is nowhere to put it.

### Open decision, deferred deliberately

Node's XML-DSig ecosystem is weak and has a history of signature-wrapping
vulnerabilities. At P8 the SAML implementation is re-evaluated: either a
hardened implementation with an adversarial corpus, or SAML as a separate
JVM module using OpenSAML. Deciding roughly 600 hours early would be
guessing. Kerberos is likewise deferred; it is the least-used Keycloak
feature and Node's support is poor.

### P2a closed against its own exit criterion, 2026-09-15

The row's four clauses were checked one at a time against a running stack
at phase close, not assumed from the code: realm and client roles,
composite roles, groups and client scopes reach a token — verified through
a live `authorization_code` exchange carrying `"roles":
["reports-api:reader", "reviewer"]` and `"groups": ["/engineering"]`,
qualified client-scoped names included; the user profile's attributes are
stored and mapped — `claims_supported` carries all twenty-two standard
claim names, up from the four the phase inherited; per-client web origins
let a browser client complete the flow — the CORS preflight-versus-request
split in `docs/request-paths.md` runs against a live realm; and email is
delivered with self-registration, address verification and password reset
all working end to end, each gated by its own realm setting, off by
default. **Every clause the row names was delivered.**

That is not the same as saying P2a leaves nothing for P2b to inherit.
`docs/NEXT.md`'s "Start here" section records what P2b needs and the
criterion never asked for: `user_credentials.type` still constrained to
`password` alone, the SSO-cookie read `/authorize` does not yet do (and the
login-verification gate that read will need to re-check), and the absence
of any rate limit — a gap this phase's own self-registration endpoint
widened by adding an unauthenticated Argon2id hash to what it protects.
None of those were in the sentence that decides when P2a is finished, so
their absence does not reopen the row; they are named here so a phase
closing cleanly is not read as a phase closing completely.

### P2b's scope, amended at its brainstorm, 2026-09-15

`docs/superpowers/specs/2026-09-15-p2b-credentials-mfa-sessions-design.md`
is the phase spec. Four amendments, appended rather than edited in place,
because that is how this document corrects itself.

**The email outbox is P2b's, and P2b's exit criterion says so.** P2a stated
its password-reset endpoint awaits the SMTP send, making an existing address
measurably slower to answer than an unknown one — a timing oracle whose
visible channel is closed. P2a's spec rejected the outbox that would close
it on the grounds that it needed the first background loop in the codebase.
P2b builds that loop anyway, for reaping, so the outbox costs a table and a
sender rather than new infrastructure. This is section 11's own retention
argument applied a second time: the phase that builds the mechanism owns
what depends on it. Until 2026-09-15 no phase owned this at all — it was
recorded as a judgment call in `docs/NEXT.md` and nowhere in the roadmap.

**Recovery codes are P2b's.** `docs/NEXT.md` named them among the credential
types widening `user_credentials.type`, and no roadmap row carried them. A
realm that enforces TOTP with no recovery path locks a user out permanently:
administrative credential reset arrives with the admin API in P4, two phases
later. The migration and the enrolment surface are being built in P2b
regardless, so this is a fourth credential type rather than a mechanism.

**Nested authentication subflows are P4's.** P2b ships a flat ordered list
of executions per realm with `REQUIRED` / `ALTERNATIVE` / `CONDITIONAL` /
`DISABLED` semantics, where consecutive alternatives form one group. Nesting
is not built because nothing can author it: P4 owns the API and console that
would. A flat flow is a valid single-level tree, so P4 extends the schema
and existing rows migrate rather than convert.

**`prompt=select_account` is P3's.** Its three clause rows in
`docs/protocols/oidc-core.md` — §3.1.2.1's SHOULD and MUST, §3.1.2.6's MAY
— read `deferred: P2` on the assumption that flow-tree semantics were what
they needed. They are not: account selection needs several concurrent
sessions per browser, which reshapes the single-session cookie read P2b
invents. P3 already renders a user-choice page during `/authorize` for
consent, which is the same surface. The rows move to `deferred: P3`.
`pnpm trace` prints nothing for a `deferred:` row in either state, so the
move is invisible to the build and was made deliberately, in a diff a
reviewer sees, rather than discovered later by whoever wondered why P2b
closed without them.

**P2b's estimate rises to 95–130 h** from 80–110. The difference is the
outbox and the recovery codes named above, not scope discovered inside the
original sentence. The roadmap total moves with it.

## 12. Working protocol

Development happens in bursts with gaps of weeks. The following is binding.

1. Phases decompose into increments of 2–6 hours, each independently
   mergeable. No work item may be unfinishable in one sitting.
2. Every increment ends with CI green, the branch merged, and nothing
   half-done on disk.
3. `pnpm verify` is the single command that proves repository health:
   typecheck, lint, boundaries, unit, integration.
4. `docs/NEXT.md` is updated before every merge: where work stopped, what
   comes next, why, and how to verify it. It is the handoff note to a future
   session with no memory of this one.
5. Progress is counted in increments closed, never in calendar dates.
