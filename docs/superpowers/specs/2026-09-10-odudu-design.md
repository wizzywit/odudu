# Odudu — Design

**Date:** 2026-09-10
**Status:** Approved

*Odudu* means power or authority in Ibibio (Akwa Ibom, Nigeria).

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
- Multi-tenant SaaS hosting. The deployment model is self-hosted.

### Constraints

- Development happens in bursts, with gaps of weeks. Every increment must
  end resumable.
- Effort is budgeted in hours, never calendar dates.

## 2. Decisions

Each of these has an ADR in `docs/adr/` recording the alternatives and why
they were rejected.

| Area | Decision | ADR |
|---|---|---|
| Runtime | TypeScript on Node 24 | 0001 |
| Deployment | Self-hostable: one container + PostgreSQL | 0002 |
| Agent model | Hybrid: type is a client, instance is an ephemeral principal | 0003 |
| HTTP | Fastify 5 | 0004 |
| Database | PostgreSQL 17 only | 0005 |
| DB access | Drizzle ORM | 0006 |
| Schemas | Zod 4 authored, compiled to JSON Schema | 0007 |
| Lint | ESLint 9 flat with type-aware rules | 0008 |
| Tenancy | Shared tables keyed by realm, with row-level security | 0009 |
| Code structure | Five functional layers, enforced | 0010 |
| Monorepo | pnpm workspaces + Turborepo | 0011 |

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

| Layer | Responsibility | Business logic |
|---|---|---|
| view | render; integration code only | no |
| usecase | orchestrate one journey; arrange a view model | no |
| repository | maintain state; decide when to refetch | no |
| adapter | talk to the network or the database; own the wire contract | API-contract logic only |
| service | domain and application logic; side effects | yes |

Permitted imports:

| Layer | May import | Never imports |
|---|---|---|
| view | own model, `shared/view` | repository, adapter |
| usecase | repository, service, view models | adapter |
| repository | adapter, service | view, usecase |
| adapter | transport, service | view, usecase, repository |
| service | nothing | everything else |

Features expose a single `index.ts`; no feature reaches into another's
internals.

`service` is the sole home of domain rules. `adapter` owns endpoints, DTO
shapes, pagination, retry, and error translation — but no domain rules.

On the server the layers map to: route handler, flow orchestrator,
repository, Drizzle/LDAP/SMTP client, domain service.

Folder-level boundaries are enforced by `dependency-cruiser` in CI. A
convention without mechanical enforcement decays in weeks.

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

An agent *type* is a registered OAuth client. An agent *instance* is an
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

| Level | Scope | Infrastructure | Frequency |
|---|---|---|---|
| Unit | service packages | none | every save |
| Contract | repository and adapter | Testcontainers PostgreSQL | every PR |
| Flow | full grant journeys over HTTP | app + database | every PR |
| Adversarial | attacks that must fail | app + database | every PR |
| Conformance | OpenID Foundation suite | full compose stack | nightly, on demand |
| Load | token endpoint, Argon2id throughput | k6 | per phase |
| Console | Playwright | app + seeded realm | every PR |

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

| # | Phase | Effort | Exit criterion |
|---|---|---|---|
| P0 | Foundation | 20–30 h | `pnpm verify` green in CI; server boots in a container; migration runner proven; ADRs committed; boundaries enforced |
| P1 | OAuth 2.1 / OIDC core | 60–100 h | OIDF Basic OP and Config OP plans pass; every in-scope MUST traced to a test |
| P2 | Identity and credentials | 60–80 h | password, TOTP and passkey login through the flow engine; adversarial suite green |
| P3 | Realms, clients, consent, dynamic registration | 40–60 h | OIDF Dynamic OP plan passes; cross-realm RLS probes green |
| P4 | Admin API and consoles | 100–150 h | full lifecycle manageable from the UI; Playwright green; OpenAPI published |
| P5 | Agent identity layer | 80–120 h | property-based attenuation tests pass; budgets atomic under concurrency; CIBA approvals end to end |
| P6 | Identity brokering | 40–60 h | login via Google and an upstream OIDC IdP; mix-up tests green |
| P7 | User federation (LDAP) | 60–100 h | LDAP-backed authentication, write-back and sync |
| P8 | SAML 2.0 IdP | 100–150 h | interop with a real SP; signature-wrapping corpus green |
| P9 | Authorization services | 100–150 h | policy evaluation and UMA 2.0 |
| P10 | Extensibility and theming | 60–100 h | a third-party provider loads without a rebuild |
| P11 | HA, clustering, performance | 60–100 h | three replicas behind a load balancer; documented p99 |

Total: roughly 800–1200 hours.

After P4, at roughly 300 hours, Odudu is usable behind real applications.
Everything beyond is breadth, and each phase is independently valuable and
independently abandonable.

### Open decision, deferred deliberately

Node's XML-DSig ecosystem is weak and has a history of signature-wrapping
vulnerabilities. At P8 the SAML implementation is re-evaluated: either a
hardened implementation with an adversarial corpus, or SAML as a separate
JVM module using OpenSAML. Deciding roughly 600 hours early would be
guessing. Kerberos is likewise deferred; it is the least-used Keycloak
feature and Node's support is poor.

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
