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
- Operating Odudu as a hosted service. Tenants provide logical multi-tenancy
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
| Tenancy            | Shared tables keyed by tenant, with row-level security       | 0009 |
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
│  ├─ domain-tenant/
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

Shared tables keyed by `tenant_id`, with two independent defenses against
cross-tenant leakage:

1. The repository layer cannot construct a query without a tenant context.
   This is a type-level requirement, so omitting it fails to compile.
2. PostgreSQL row-level security. The application connects as a
   non-superuser role; tenant tables use `FORCE ROW LEVEL SECURITY`; each
   transaction issues `SET LOCAL app.tenant_id`.

`SET LOCAL` is required rather than `SET`: a session-scoped setting leaks
tenant context between requests sharing a pooled connection. This has an
explicit test.

The policy predicate wraps the setting in `nullif(…, '')` before casting.
`current_setting(name, true)` yields `NULL` only until a backend first touches
the GUC; afterwards it reverts to the empty string at transaction end, and
casting `''` to `uuid` raises an error rather than filtering. With `nullif`,
missing tenant context yields zero rows rather than an exception — the policy
fails closed either way.

A `system` tenant exists and is structurally identical to every other tenant.
Cross-tenant administration is an explicit permission, not a property of
living in a particular tenant. This avoids Keycloak's `master` realm
confusion.

### Subjects

```
subjects (id UUIDv7 PK, tenant_id, type, disabled_at, created_at)
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
signing_keys (id, tenant_id, kid, alg, status, public_jwk,
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

Tenants resolve from the path: `/tenants/{tenant}/protocol/openid-connect/…`.
Subdomain-per-tenant would give free cookie isolation but demands wildcard
DNS and certificates from every self-hoster. Cookies are therefore
namespaced per tenant (`__Host-<tenant>-session`). This is weaker than host
isolation and tenant separation in the browser rests on our own discipline.
Subdomain mode remains available later as configuration.

Every request carries a context built at the edge: correlation ID, resolved
tenant, a database transaction bound to `app.tenant_id`, and an injectable
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
| Console     | Playwright                          | app + seeded tenant       | every PR           |

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
- cross-tenant leakage, probed on every repository method
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

| #   | Phase                                                            | Effort    | Exit criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ---------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Foundation                                                       | 20–30 h   | `pnpm verify` green in CI; server boots in a container; migration runner proven; ADRs committed; boundaries enforced                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P1  | OAuth 2.1 / OIDC core                                            | 60–100 h  | OIDF Config OP plan passes; Basic OP runs reproducibly with every divergence confirmed as a recorded decision (ADR 0016); every in-scope MUST traced to a test                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2a | Identity model: roles, groups, client scopes, web origins, email | 90–130 h  | tenant and client roles, composite roles, groups and client scopes emitted into tokens; a user profile beyond the username — attributes, their storage, and the standard OIDC claims mapped out of them; per-client web origins so a browser client completes the flow; email delivered, with self-registration, address verification and password reset on top of it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P2b | Credentials, MFA and the session lifecycle                       | 95–130 h  | password, TOTP, passkey and recovery-code login through the flow tree; password policies and brute-force protection; an SSO session that is read as well as written, with idle and maximum lifespans, ended by RP-initiated logout; offline access; mail sent off the request path; expired state reaped on a stated retention window, with a test that fails if reaping breaks code or refresh-token reuse detection; adversarial suite green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P3a | Clients, registration and consent                                | 55–80 h   | the OIDF Dynamic OP plan runs reproducibly with every divergence confirmed as a recorded decision — its discovery check demands the `id_token` and `token id_token` response types OAuth 2.1 removes, so it cannot pass, and this is the treatment P1's criterion already gives Basic OP; dynamic client registration (RFC 7591) behind a per-tenant setting closed by default, with initial access tokens and a per-tenant client cap; the client metadata later clauses read — `jwks` or `jwks_uri` with a stated and tested boundary on what the server will fetch, front- and back-channel logout URIs, audiences, a consent flag — registered and validated but advertised nowhere in discovery; a consent screen a user can refuse, with per-scope choice over the client's `optional` scopes and a recorded grant it can be asked against again; a rate limit on `client_secret` attempts at `/token`, keyed by client; a single authority for a page's headers, enforced by a test, with every renderer returning the contract P4b will theme; cross-tenant RLS probes green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P3b | Sessions, logout and the token surface                           | 135–165 h | concurrent sessions per browser, with `prompt=select_account` choosing among them; a tenant's "remember me", offered as a choice on the login form, carrying a cookie that outlives the browser session and the second pair of idle and maximum lifespans it selects; front-channel and back-channel logout delivered against the URIs P3a registers, with a front-channel clause table and the `frontchannel_logout_session_required` metadata P3a left unregistered, back-channel through a queue and a command rather than on the request path; token introspection (RFC 7662) scoped by audience and revocation (RFC 7009); RFC 8707 `resource` indicators, single-valued against the per-client audience allowlist, making `aud` derived rather than asserted, with `id_token_hint`'s `AUDIENCE_UNCHECKED` closed at `/authorize` and `/logout`'s own audience comparison pinned where RP-Initiated Logout §4 needs it; signed and encrypted UserInfo responses, selected by client registration; the `claims` request parameter, honoring an Essential `auth_time` claim and a `sub` requested with a specific value; `private_key_jwt` and proxy-header mTLS client authentication; the consent section of `docs/request-paths.md` replaced by a real transcript; cross-tenant RLS probes green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P4  | Admin API and consoles                                           | 155–230 h | full lifecycle manageable from the UI, including a tenant's own settings — registration, email verification, password policy and OTP among them, none of which can be changed today without writing the database directly, and per-tenant SMTP, whose credential goes behind the same key-encryption interface as a signing key — and a tenant's authentication flow, whose `authentication_executions` rows have an insert and nothing else today, and the claim mappers a scope reaches, which are code-only; disabling a client, with what becomes of a token already issued to it decided rather than inherited — `/userinfo` and `/introspect` reading `client.enabled` as `resolveRoleReach` does, or recording why they do not — and with whether an existing client may be amended at all settled on purpose, since `seed tenant --set` amends a tenant and `seed client` refuses to amend a client; listing a subject's sessions and ending one, and promoting a new signing key and retiring the one it replaces on the overlap window §5 states, with JWKS proven to publish both for its duration, including a rotation to a key whose algorithm differs from the one it replaces, which strands every client registered against the old one at `/userinfo` until that case has an answer; another application able to provision users through the admin API as a service account holding admin roles; an account console for self-service, including a fresh set of recovery codes the subject can ask for before the old set is spent and a warning when fewer than a configured number remain; audit events persisted and queryable; tenant import and export; token exchange (RFC 8693) as a grant at stage 3 of the token pipeline — `subject_token` and `actor_token`, audience and scope narrowing, `act` and nested `act` carrying the delegation chain, and impersonation distinguished from delegation — with the exchange permissions that decide which client may exchange for which audience configurable through the admin API this phase builds, and, since adding a grant is the next change to grant selection in `issueTokens`, `/token` refusing a grant its client is not registered for, which nothing checks today; a clause table under `docs/protocols/` that `pnpm trace` reads; Playwright green; OpenAPI published |
| P4b | Theming and client branding                                      | 55–90 h   | every page the server renders — each `*-html.ts` in a `view` layer, stated as a rule rather than as a list, because a list is one page short the next time a renderer is added — renders under a tenant's supplied theme without a rebuild, and a build check beside the view-layer walk in `packages/protocol-oidc/src/view/html-response.test.ts` fails when a renderer exists that no theme reaches; the frames a front-channel logout declares render on the redirecting branch of `/logout` too, the one session-ending path that renders no page today and so the one page no theme can reach; a client supplies its own styling and its own images, served by Odudu, under a content-security policy derived per client rather than widened for all                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P5  | Agent identity layer                                             | 80–120 h  | property-based attenuation tests pass; budgets atomic under concurrency; CIBA approvals end to end; the layer consumes the RFC 8693 exchange P4 builds at stage 4 of the token pipeline, where the delegated intersection is the attenuation check, and introduces no grant of its own                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P6  | Identity brokering                                               | 50–70 h   | login via Google and an upstream OIDC IdP; a user provisioned just in time on first brokered login, with the account-linking decision that implies; mix-up tests green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P7  | User federation and inbound provisioning                         | 80–130 h  | LDAP-backed authentication, write-back and sync; SCIM 2.0 inbound provisioning, including deprovisioning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P8  | SAML 2.0 IdP                                                     | 100–150 h | interop with a real SP; signature-wrapping corpus green                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P9  | Authorization services                                           | 100–150 h | policy evaluation and UMA 2.0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P10 | Extensibility: third-party providers                             | 40–65 h   | a third-party provider loads without a rebuild                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P11 | HA, clustering, performance                                      | 60–100 h  | three replicas behind a load balancer, with migrations taking an advisory lock so that simultaneous boots cannot race, and every bound held in one process's memory — the per-origin throttle among them — either shared or documented as multiplied by the replica count; documented p99 for `/token` and `/userinfo`, which owes a deadline to the outbound DNS lookups those two paths make and today do not bound                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P12 | Operational readiness                                            | 40–70 h   | a versioned image published from a tagged release, with the release process written down; secrets sourced from somewhere other than the process environment, through the interface §5 already puts the key-encryption key behind; backup and restore guidance proven by restoring into an empty database and completing a login against the restore                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P13 | FAPI 2.0, sender-constrained tokens and the deferred grants      | 70–110 h  | the OIDF FAPI 2.0 Security Profile plan passes, which requires pushed authorization requests (RFC 9126) and DPoP (RFC 9449) or mTLS-bound tokens; a requested `acr_values` the current session cannot satisfy forces reauthentication rather than being ignored; a device-code client (RFC 8628) completes a login on a second device; `private_key_jwt` and `tls_client_auth` accepted at `/introspect` and `/revoke`, which only the two password methods reach today; RFC 7523's clauses tracked in `docs/protocols/`, the one RFC Odudu implements whose clauses the traceability matrix cannot see                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

Total: roughly 1285–1920 hours.

After P4b, at roughly 665–955 hours, an application can adopt Odudu: every
page its users are shown can be branded, every session it opens can be
ended, and every surface it needs for the account lifecycle exists. What
remains before an **operator** can run that in production is P11's replica
story — one instance today, so every restart is a login outage for every
application at once — and P12's published image, its secret store and its
proven restore. Neither is a dependency of any phase between here and there,
and both should be pulled forward the moment a deployment is real. Everything
else beyond is breadth, and each phase is independently valuable and
independently abandonable.

That sentence said "Odudu is usable behind real applications" until
2026-09-23. It was wrong in both directions. It promised the application
more than P4b did: the criterion above themed three pages while the `view`
layers held twelve renderers, so a P4b could have passed with the
second-factor, recovery-code, passkey-enrolment, change-password,
verification, reset, account-chooser and logged-out pages still on default
HTML — the same defect that moved this milestone the first time, reproduced
inside the phase that move created. And it promised the operator something
no phase before P11 and P12 delivers, because "usable" reads as
"deployable". The criterion now names every renderer; the sentence now names
which of the two audiences it speaks for.

That milestone said "after P4" until 2026-09-17. It moved because the claim
was not true as written: every one of those real applications puts its own
users in front of Odudu's login page, and until P4b that page cannot be made
to look like the product it is signing people in to. A login screen nobody
can brand is not a solution a client can adopt, whatever the protocol
surface behind it does.

That figure said "roughly 300 hours" until 2026-09-14, which was the sum
before P2 became two phases and before the rows below were added to P2a, P3
and P4. It is a sum of the eight rows above it, not an estimate of its own.
It said "six" until 2026-09-22, when counting them found eight: P2 and P3
each became two phases and P4b was split out of P10, and the count word was
never carried forward.

Both figures moved again on 2026-09-18, when P3 became P3a and P3b. The
delta is the split's own honesty rather than new work discovered late: see
below.

Both moved a third time on 2026-09-22, and two different things moved them.
Token exchange (RFC 8693) joins P4's criterion, which is 20–30 hours at this
repository's own three-to-four hours a task; and the two figures had in any
case fallen behind the rows they sum, reading 560–835 and 1180–1800 against
rows that already came to 645–925 and 1265–1890. Recomputed rather than
adjusted, so the arithmetic can be checked against the column.

### Token exchange is P4's, not P5's

`docs/request-paths.md` placed RFC 8693 in P5, and P5's criterion named
attenuation, budgets and CIBA and never named the grant — the failure
"Exit criteria that omitted work their phase already owned" records below,
work placed in a phase whose criterion does not ask for it. The tie-breaker
is the pipeline in §6: token exchange is stage 3, grant-specific validation,
beside the code, refresh and
client-credentials grants, while ADR 0003 fixes the agent layer at stage 4
alone. The agent layer consumes the exchange; it does not introduce it. So
it belongs to the last phase before the milestone above, and the milestone
is the second reason: an identity platform behind real applications that
cannot do service-to-service delegation, downscoping or cross-audience
exchange is not usable behind them, which is the same argument that moved
the milestone from P4 to P4b for an unbrandable login page.

P4 is a large phase and a protocol grant inside a console phase is easy to
skip, which is the cost of this placement and is recorded here rather than
discovered later. What guards against it is the criterion naming the grant,
the `act` chain and the exchange permissions explicitly, and a clause table
`pnpm trace` reads.

### P3 became two phases, and the estimate was the symptom

Found on 2026-09-18, brainstorming P3. Two decisions the phase could not
avoid were not inside its 80–120 hours. Concurrent sessions per browser —
which `docs/protocols/oidc-core.md` had carried as `deferred: P3` for three
clause rows while P3's criterion never named it, the exact failure this
section's neighbour above describes. And the page contract, which
`docs/NEXT.md` had assigned to P3 to _decide_ while P4b delivered it,
where deciding it without moving the existing renderers onto it leaves P4b
retrofitting across pages that never shared a shape.

With both inside, P3 was roughly 105–160 hours — larger than P2b, the
largest phase completed so far. The precedent is P2's, and its reason
applies unchanged: **a phase nobody can finish is a phase nobody starts.**

**The seam is a dependency, not a convenience.** Every P3b clause reads
client metadata P3a registers — logout URIs, client key material,
audiences, UserInfo algorithms — and no P3a clause reads anything P3b
builds. The dependency runs one way. The headline criterion, the OIDF
Dynamic OP plan, sits wholly in P3a, so it is answered at the halfway point
rather than at the end.

**Nothing outside P3 is renumbered**, for the reason the P2 note gives:
roughly 150 `deferred:` rows carry phase numbers, `pnpm trace` skips rows
whose marker is an intent rather than a digit, and ADRs 0016 and 0017 cite
phase numbers. The 78 rows that said `deferred: P3` — 33 in
`oidc-backchannel.md`, 22 in `oidc-core.md`, 18 in `rfc6749.md`, 2 each in
`oidc-rpinitiated.md` and `rfc9068.md`, 1 in `oidc-discovery.md` — resolve
to `P3a` or `P3b` in the increment that splits the roadmap, before any
other work, so every later increment writes the right marker.

`docs/superpowers/specs/2026-09-18-p3a-clients-registration-consent-design.md`
is P3a's spec. P3b gets its own when P3a closes.

### What the roadmap did not name

This roadmap was written outward from the protocol, which is why it is
strong on protocol depth and was thin on the identity model and the
administrative surface around it. The following were found missing on
2026-09-13 by reading Keycloak's surface against all twelve phases, and
checked against the code rather than assumed. They are recorded here so the
gap is a decision rather than a discovery made twice.

**Three moved to the top of P2, because they change other phases rather
than merely adding to them.**

_Roles, groups and client scopes._ The largest single omission. Tenant roles,
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
persisted and queryable audit events, tenant import and export, and
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

**Placed on 2026-09-17 as P13, having been unplaced until then.** PAR
(RFC 9126), DPoP, mTLS-bound tokens, the device authorization grant and
step-up authentication with `acr`/`amr` had no phase, on the reasoning that
naming one would be guessing: DPoP and PAR are prerequisites for the FAPI 2.0
profiles ADR 0016 identifies as the certification Odudu could actually hold,
so they belonged together with that decision rather than scattered.

That reasoning was right and the conclusion was half a step short. **A phase
is how "scoped together" gets said in the table** — leaving them out of it
meant a reader of the roadmap saw twelve phases and no mention of the
certification the project is aiming at, and every review of this list had to
re-derive why five items were missing. So P13 carries the FAPI 2.0 profile
decision and its prerequisites, and its criterion is the OIDF FAPI 2.0 plan
passing, which cannot be met without PAR and DPoP or mTLS-bound tokens
actually working.

The device grant is in P13 for a weaker reason, and it is worth saying so:
RFC 8628 has nothing to do with FAPI. It is there because it is the last
grant the core phases deferred, its criterion is independent and testable on
its own, and a phase of its own for one grant would be scheduling theatre.
If P13 is ever split, that clause is the seam.

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

- **P4 named neither a flow editor nor the protocol mappers**, though the
  prose above sends both there and `docs/request-paths.md` places them in
  P4 by name. A tenant's `authentication_executions` rows have an insert and
  nothing else, and the claim registry is fixed by the server; an admin
  console that manages everything else and neither of those would still
  meet the criterion as it read. Both are now in it. Found closing P3b,
  2026-09-22, by the same both-directions reconciliation that found the
  five above.

P3's estimate moves from 60–90 to 75–110 hours: consent was always costed,
being in the title, and resource indicators and JWE/JWS UserInfo were not.
It moves again to 80–120 on 2026-09-17, for "remember me" — see below.
The `/token` rate limit is inside that range rather than adding to it — it
is a limiter beside one that P2b will already have built, applied to a
different key.

### "Remember me" had no phase, and is P3's

Found on 2026-09-17, and by the failure mode the check added the same day
does not catch: the item naming it in `docs/request-paths.md` already said
**P3** — for concurrent sessions and `prompt=select_account` — and then
admitted in its last sentence that "remember me" itself was named in no
phase. A marker being present is not the same as the item being placed, so
the test can only fail an item that names nothing at all; reading the
sentences is still the pass.

It lands in **P3** because every part of it is already P3's surface: a tenant
setting, which P3 configures; the login form, which P3 is rewriting for
consent; and `/authorize`'s session decision, whose `prompt` and `max_age`
handling P3 inherits from P2b. The work is a tenant toggle, a second pair of
idle and maximum lifespans for a session established with it, a checkbox on
the form, and a cookie carrying `Max-Age` — today's carries none, which is
precisely why closing the browser ends the session. Keycloak's shape is the
same and is worth copying rather than inventing.

### P3b is 135–165 hours, and stays one phase anyway

Found brainstorming P3b on 2026-09-19. The row above said 55–85 hours.
Sized against the two phases that have been built — P3a is 19 tasks for
55–80 hours, P2b is 29 tasks for 95–130, so roughly three to four hours a
task — P3b's nine deliverables come to about 42 tasks and 135–165 hours.
That is larger than P3 was when its size caused the P3a/P3b split.

The estimate was wrong for a reason worth recording: it was written before
anybody checked what the repository already had against what each
deliverable needed. Half the sizing surprise is one item. Encrypted
UserInfo responses read as a parameterisation of existing signing, and are
not: `grep -rn 'CompactEncrypt\|EncryptJWT\|JWE' packages/*/src` is empty,
so JWE is a capability this server does not have.

**Decided: it stays one phase**, with the size known rather than assumed.
The alternative was a P3b/P3c seam between the session work and the token
surface, and that seam is real — the dependency runs one way, since
introspection and §3.1.2.1's `sub`-with-a-value rule read the session model
and nothing in the session work reads the token surface. It is recorded in
P3b's own spec, section 2, as the place to cut if the phase stalls. What
makes one phase survivable is a requirement on its plan: eight increments,
each independently mergeable and each ending green, ordered outward from
the session set, so the phase can be paused between any two of them rather
than only finished.

The row's estimate is corrected above rather than left standing. A phase
whose first week disproves its own estimate teaches whoever reads the table
next that the column is decorative.

### P3a did not name the `claims` request parameter, and it moves to P3b

Found closing P3a, 2026-09-19 — the same failure the two entries above
record, caught by the same check run one phase later.
`docs/protocols/oidc-core.md` placed three `deferred:` rows on P3a on the
reasoning that the `claims` parameter needs the per-client machinery and
consent screen P3a builds; P3a's own criterion in the table above never
named the parameter, and nothing in its twenty-task plan built it — the
machinery and the consent screen shipped, the parameter that would read
them did not. `docs/NEXT.md` carried this as an open decision through the
whole phase rather than resolving it early, which is itself worth naming:
the check exists to catch a criterion silently omitting placed work, and it
still took until the phase's last task to run it.

Decided: the three rows move to **P3b**, whose criterion now names the
parameter alongside signed and encrypted UserInfo responses — the other
half of "deliver on what P3a's registration metadata stored but nothing
reads yet," which is the same shape. `docs/protocols/oidc-core.md` and
`docs/phases/p3a.md` carry the detail.

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
P11's three-replica criterion would trade a
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
after P4 adds tenant export. What P12 genuinely cannot precede is nothing.
Its position records that no phase before it had a reason to stop and do
this work, not that the work waits on them.

### How a user gets into a tenant

An identity provider that can only be populated by an administrator is not
one anybody deploys. There are four ways in, they are not alternatives to
each other, and a tenant typically has several enabled at once. Recording
them here because the roadmap named endpoints and phases without ever saying
which of these it was building.

**Self-registration.** A "Register" link beside the login form; the user
creates their own account in Odudu's own UI, and the application never sees
a credential. It is a per-tenant setting and a registration flow, and it is
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

### Theming was named but never required, and per-client branding was absent

Found on 2026-09-17, closing P2b, by asking what the roadmap promises about
pages rather than what it says about providers.

**`ThemeProvider` had a registry entry, a phase title and no criterion.**
Section 8 lists it among `kernel`'s registries, P10 is titled "Extensibility
and theming", and P10's exit criterion read "a third-party provider loads
without a rebuild" — which tests provider loading. **A P10 could have passed
that criterion with no theming capability whatsoever**, which is the defect
"Exit criteria that omitted work their phase already owned" was written
about, in the one phase whose title names the omitted work.

**Per-client branding was not in the roadmap at any phase.** Nothing named a
client supplying its own look, and nothing named assets at all: no storage,
no upload path, no serving of client-supplied images. The only occurrence of
"static assets" is the consoles compiling to them.

**P10 was also two phases wearing one title, and the halves have opposite
urgency.** Dynamic third-party provider loading is plugin infrastructure:
genuinely late, needed by nobody in order to ship. Theming is the only part
of Odudu an end user ever looks at. Bundling them meant the second inherited
the first's position.

So theming and client branding become **P4b** (55–90 h), and P10 keeps
provider loading alone (40–65 h). P4b is inserted rather than renumbering
eight phases, on the precedent of P2 becoming P2a and P2b — and because
inserting says "this was moved", where renumbering would read as though the
roadmap had always said it. Nothing in `docs/protocols/` defers a clause past
P3, so no traceability row moves with it.

**P4b sits immediately after P4 because that is the earliest coherent point,
not because it is convenient.** Per-client branding needs per-client
configuration, which is P3's; managing it needs a console, which is P4's.
Earlier than P4 there is nowhere to put the setting and no way to change it.

**Three constraints any implementation inherits, discoverable now:**

- **Client-supplied CSS on the login page is an exfiltration channel.**
  Attribute selectors can match on a field's value and leak what they match
  through a background-image request. The pages carry a password field and
  the `auth_session_id` CSRF token, so "accept a stylesheet" is not a
  styling decision, it is an authorization decision about a page with
  secrets on it.
- **A client-supplied remote image URL tells a third party that this user is
  signing in to this client, and when.** Serving assets from Odudu rather
  than hotlinking is the only form that does not leak the visit, which is
  why the criterion says "served by Odudu".
- **The policy cannot be a static header.** P2b left these pages on
  `default-src 'none'` with a per-response nonce (ADR 0018), and
  `sendHtml` already derives the header from a `RenderedPage` the renderer
  returns. Per-client assets mean deriving `img-src` and `style-src` from
  the client being rendered for — an extension of that mechanism rather
  than a replacement, and the reason the contract must be designed with the
  policy and not before it.

**The ordering consequence that prompted the split.** P4 built the consoles
at position 4 and P10 built theming at position 10, so an operator setting a
client's branding wanted a console surface six phases before the thing it
manages existed. P4b resolves it by following P4 rather than preceding it.
What remains is the contract's shape, which stays P3's to settle beside the
consent screen (`docs/NEXT.md`, "Login page theming") — decided in P3 while
the eighth page is being written, delivered in P4b. Deciding it in the phase
that delivers it would mean writing the consent screen the old way first.

### Open decision, deferred deliberately

Node's XML-DSig ecosystem is weak and has a history of signature-wrapping
vulnerabilities. At P8 the SAML implementation is re-evaluated: either a
hardened implementation with an adversarial corpus, or SAML as a separate
JVM module using OpenSAML. Deciding roughly 600 hours early would be
guessing. Kerberos is likewise deferred; it is the least-used Keycloak
feature and Node's support is poor.

### P2a closed against its own exit criterion, 2026-09-15

The row's four clauses were checked one at a time against a running stack
at phase close, not assumed from the code: tenant and client roles,
composite roles, groups and client scopes reach a token — verified through
a live `authorization_code` exchange carrying `"roles":
["reports-api:reader", "reviewer"]` and `"groups": ["/engineering"]`,
qualified client-scoped names included; the user profile's attributes are
stored and mapped — `claims_supported` carries all twenty-two standard
claim names, up from the four the phase inherited; per-client web origins
let a browser client complete the flow — the CORS preflight-versus-request
split in `docs/request-paths.md` runs against a live tenant; and email is
delivered with self-registration, address verification and password reset
all working end to end, each gated by its own tenant setting, off by
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
tenant that enforces TOTP with no recovery path locks a user out permanently:
administrative credential reset arrives with the admin API in P4, two phases
later. The migration and the enrolment surface are being built in P2b
regardless, so this is a fourth credential type rather than a mechanism.

**Nested authentication subflows are P4's.** P2b ships a flat ordered list
of executions per tenant with `REQUIRED` / `ALTERNATIVE` / `CONDITIONAL` /
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

### P2b closed against its own exit criterion, 2026-09-17

Every clause of the amended row was driven against a running compose stack
at phase close, and what follows is what was observed rather than what the
code implies.

**Password, TOTP, passkey and recovery-code login through the flow tree.**
Password and TOTP were driven end to end: a tenant with `otp_required` on
answers a correct password with the enrolment page, the submission proving a
code writes the credential, the same code replayed is refused (RFC 6238
§5.2), and the next one completes a login whose ID token carries
`amr: ["otp","pwd"]` and `acr: "2"`. A recovery code was driven the same
way — one of the ten printed codes signed in with `amr: ["pwd"]`, `acr: "2"`,
the same code typed back in lower case with a space for the hyphen was
refused _as spent_, and a code from no list was refused with no message at
all. `authentication_executions` for that tenant reads `passkey`/`password`
`alternative`, `otp`/`recovery-code` `conditional`, in that order.
**The two WebAuthn ceremonies were not driven**, and cannot be from this
repository: only `navigator.credentials.create()` and `.get()` inside a
browser can produce an attestation or an assertion. What was run instead is
`packages/authn-flows/tests/passkey-enrolment.int.test.ts`,
`packages/authn-flows/tests/passkey-login.int.test.ts` and
`packages/protocol-oidc/tests/passkey-enrolment.int.test.ts` — 38 cases,
green — which drive both ceremonies against real PostgreSQL with a software
authenticator emitting real ES256 assertions. That establishes the
server-side half: resolution by `lookup_key`, the challenge cleared by the
statement that read it, the counter compare-and-swap, the user-verification
requirement, and the CSP nonce on both scripted pages. It does **not**
establish that a real browser and a real authenticator complete the
ceremony, which needs a browser-driving test P4's Playwright suite is the
place for.

**Password policies.** Driven at three of the four writers — registration,
reset redemption and the change-password action — including every violation
listed at once, `password_not_username` and `password_not_email` tripping
independently, the password in force refused at a reset, history refused at
a change, and `password_max_age_days` parking a login on `update-password`
with `created_at` observed moving onto the new hash.

**Brute-force protection.** Eight submissions against one parked request —
five wrong passwords, a sixth during the lockout, the right password, and a
username nobody holds — hash identically at
`e90eba8ff7fcad29b7543b3c005a0090` over the whole response with four
per-response values normalised out. `login_failures` then held one row for
`ada` and none for the unknown name, at seven failures with `locked_until`
four minutes out. In a tenant of its own, five failures then the right
password refused then the same password 125 seconds later completed the
login, which is the doubling and the "an attempt during a lockout still
counts" rule together.

**The session read, with both lifespans.** A live cookie reuses its session
at `/authorize` with no form, under `prompt=none` as well; `prompt=login`
forces the form past it; a request with no cookie still gets
`login_required`. Both windows were then moved independently against the
same session — `last_active_at` backdated past
`sso_session_idle_seconds` (1800), and `expires_at` backdated with
`last_active_at` left at now, so the ceiling could not pass for the idle
window — and each turned reuse into the login form, and `prompt=none` into
`login_required`. `auth_time` on a reused session's code was the original
login's instant, 37 seconds before the `iat` of the token minted from it.

**RP-initiated logout.** Driven over `GET` and `POST`: a hint naming the
current session skips confirmation and honours an exactly registered
`post_logout_redirect_uri`, clearing the cookie and revoking the
session-bound refresh token; no hint renders the confirmation form carrying
the session id, and a `client_id` disagreeing with the hint's `aud` renders
that form with the redirect dropped entirely, ending nothing.

**Offline access.** A second code redeemed from the same live session for
`scope=openid offline_access` produced a grant with no `sid` on either
token, and the logout that revoked the session-bound refresh token left the
offline one refreshing normally.

**Mail off the request path.** Both reset answers were byte-identical for an
address with an account and one without, neither waited on a transport, and
only the first queued a message; on the default stack the capture appeared
in the container log a moment later, on the server's own schedule, and with
that schedule off `odudu send-mail` reported `{"ran":true,"sent":1,"failed":0}`
and the row recorded one attempt.

**Reaping on a stated window, with the detection test.** On a stack driven
only through Path A plus one refresh rotation, `odudu reap` deleted nothing
— the consumed code, the used refresh token and the expired authentication
session are all past their own `expires_at` and all still required.
Backdating forty days and running it again deleted exactly
`{"refresh_tokens":2,"authorization_codes":1,"token_grants":1,"authentication_sessions":1,"sessions":1}`,
and a third run nothing. The refusals were driven too: the pass declines on
a serving connection that escapes row-level security, declines with the
variable absent, reports `no tenant was enumerated` rather than a clean
sweep, and skips rather than queues behind a held advisory lock. The named
forcing function is `apps/server/tests/reap-preserves-detection.int.test.ts`,
green alongside `apps/server/tests/reap.int.test.ts`.

**Adversarial suite green.** Six integration files, 501 cases, plus
`packages/crypto/src/service/sign.adversarial.test.ts` in the unit project.

**Every clause the row names was delivered.**

#### What P2b leaves for P3, which its criterion never asked for

None of these is in the sentence that decides when P2b is finished, so none
reopens the row. They are named here so a phase closing cleanly is not read
as a phase closing completely.

- **One session per browser.** The cookie holds one session id, so a second
  login replaces the first. `prompt=select_account` therefore renders the
  ordinary form, and its three clause rows in `docs/protocols/oidc-core.md`
  are already `deferred: P3` — the amendment above moved them before the
  phase started, on exactly this reasoning.
- **No rate limit on `client_secret` attempts at `/token`.** RFC 6749
  §2.3.1's MUST was split during this phase: the end-user half is
  `covered`, the client-authentication half is a second row, `deferred: P3`,
  and P3's criterion in the table above now names the limit alongside
  `private_key_jwt` and mTLS. The filing itself is new — nothing had scoped
  it.
- **The throttle is one process's memory.** N replicas admit N times the
  budget. Accepted rather than deferred (ADR 0023) — the property that must
  hold globally is the lockout's, in Postgres — but there is no load
  balancer here to demonstrate it against, so it is a statement in
  `README.md` rather than a transcript.
- **No operator unlock for a locked account.** A lockout ends by waiting or
  by a successful login. Clearing one needs the admin API, which is P4's.
- **No self-service password change, and no way to ask for a fresh set of
  recovery codes** outside the required action that owes them. Both are the
  account console, P4's; until then an operator deletes rows to make the
  action owed again.
- **A tenant with `password` disabled and only `passkey` enabled answers
  `no_applicable_execution` and cannot be signed into.** Nothing makes the
  passkey step applicable but a submission already carrying an assertion,
  and the only page that could produce one is the password page. No tenant
  `provisionTenant` creates is in that state. The fix — letting a challenge
  name every applicable member of its group rather than the first — changes
  `nextStep` and `AuthenticatorResult`, so it is its own increment.
- **`AUDIENCE_UNCHECKED` for an `id_token_hint`'s own audience**, inherited
  from P1 and narrowed rather than closed here. At `/authorize` the hint's
  signature, issuer and `typ` are verified but its `aud` is not, so a hint
  issued to another client of the same tenant is accepted; at `logout` a
  `client_id` sent beside a hint **is** compared against that `aud`, because
  RP-Initiated Logout §2 requires it. Tightening `/authorize` the same way
  belongs with the per-client audience configuration P3's criterion names.
- **The reaper discovers a misconfigured serving role once per tick**, not
  at boot: a deployment pointing `ODUDU_APP_DATABASE_URL` at a role that
  escapes row-level security learns from an hourly log line.
- **`refresh_tokens` has no retention window of its own** and cannot be
  given one, since a refresh token is retained for the life of its grant
  family (ADR 0021's amendment).

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
