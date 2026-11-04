# P4j: a public address of its own for each tenant (a custom domain)

Phase spec. The umbrella decisions are in
[the design spec](2026-09-10-odudu-design.md), section 11, row P4j; the move
out of P4b is in section 3 of the P4b spec. Written 2026-11-04.

## 1. Intent

An operator runs one Odudu. Today every tenant is reached under the operator's
one base address, `ODUDU_PUBLIC_BASE_URL`, as `/tenants/<name>`, and a tenant's
issuer is that base plus its name. A customer who wants its sign-in to live at
its own address (`login.acme.com`) cannot have that. P4j gives a tenant that,
and lets it go back.

The owner's rule, which governs every decision below: **a tenant that does no
branding of its address behaves exactly as it does today, and a tenant that
moves to a domain can return to the default at any moment, including when it has
lost the domain.**

## 2. Goals, non-goals, anti-goals

**Goals**

- A table of verified domains; a tenant resolved from `Host`; the tenant's routes
  served at the root of its domain; a refused host reaches nothing.
- The operator's reverse proxy asks Odudu whether a host is registered, in the
  shape of on-demand TLS, so certificates stay the proxy's work.
- The issuer, the cookie scope, the WebAuthn RP ID, the links in mail and the
  brand asset addresses follow the tenant's canonical address.
- Switch to a domain and back, at any time, from the base address.
- A tenant with no domain is byte-for-byte unchanged, shown by the existing suites
  passing without edits.

**Non-goals** (each named against where it goes)

- Certificates issued inside Odudu, ACME and renewal: P11 (section 3 of the P4b spec).
- An operator-wide scheme such as `<tenant>.idp.example` for every tenant: not
  placed; it is a different feature (wildcard certificates, no ownership proof).
- The admin API and the admin console on a tenant's domain: they stay on the base
  address, which is what makes switching back possible without the domain.
- More than one domain live at once for a tenant. A tenant has any number of
  registered domains but one canonical address.
- Related Origin Requests to share passkeys across domains: browsers count about
  five registrable-domain labels across the whole operator, which does not reach
  10,000 tenants, and Firefox support is unsettled.

**Anti-goals** (a failure even if it technically works)

- A switch that strands a tenant: the way back needs nothing from the domain.
- A host header that selects a tenant without a verified row.
- An `ask` answer that tells a stranger which tenant owns a domain.
- A domain whose owner has lost it still serving the tenant's sign-in.

## 3. How it works

### 3.1 The canonical address

A tenant has exactly one **canonical address**: either the path address
(`<base>/tenants/<name>`, the default and the state of every existing tenant) or
one verified domain (`https://login.acme.com`, routes at the root). Four things
follow the canonical address: the issuer string, the RP ID and origin, the
cookie names and paths, and the links Odudu writes (redirects, form actions, mail
links, brand assets).

### 3.2 The domain table

A `tenant_domains` row: tenant, host, state (`pending`, `verified`, `failed`), a
verification token, `verified_at`, `last_checked_at`, `canonical` (at most one
per tenant). Among **verified** rows a host is unique across the whole deployment (a partial unique index); `pending` rows from several tenants may coexist, each with its own challenge, and the first to prove ownership wins, so nobody can squat a host by registering it. A `pending` row older than a retention window (default 7 days) is deleted by `reap`, and a `failed` row holds nothing. Lookup by host runs
before tenant context exists, like the tenant-name lookup does today, so the
table's read path is the one deliberate exception to row-level security and is
bounded by an index on host. Writes go through the tenant's own admin
capability and are probed with a foreign `tenant_id`.

Refused at registration: the operator's own host, an IP literal, `localhost`
and the reserved test names, a host another tenant has verified, and
anything that is not a lowercase, punycode-canonical DNS name. Matching is on the
canonical spelling, as `view/issuer.ts` already treats `Host`.

### 3.3 Ownership

The admin API hands back a token; the tenant publishes it as a DNS TXT record
under `_odudu-challenge.<host>`; verification resolves the record. A recheck
runs for every canonical domain on a schedule: a command first, a timer second
(CLAUDE.md, "Background work"), `odudu domains recheck`, with the loop a thin
file beside `scheduler.ts`. A lookup that answers _no such name_ or _no matching record_ counts as a failure; a resolver error or timeout is indeterminate and counts as nothing, and a pass in which more than half the lookups are indeterminate counts nothing at all, so a resolver outage cannot disable every custom domain. A pass is bounded: a per-lookup timeout, a concurrency limit, and a keyset walk in pages, so a pass over tens of thousands of domains neither runs serially nor holds its lock for hours. A domain that fails its recheck for a set number of
consecutive passes goes to `failed`, the `ask` endpoint stops approving it, the
host resolves to nothing, and the tenant's canonical address returns to the path
address, with an audit row. This is the lost-domain case closing by itself: an
expired domain bought by somebody else cannot keep serving a tenant's sign-in.
The number of passes and the interval are configuration with defaults.

### 3.4 Host resolution

A request whose `Host` (read as `ODUDU_TRUST_PROXY` allows, never from a header
the client controls otherwise) matches a verified domain is served as that
tenant at the root. The mechanism is a rewrite at the edge: the request URL
`/protocol/openid-connect/auth` becomes `/tenants/<name>/protocol/openid-connect/auth`
before routing, so none of the 86 route declarations that take `:tenant` change.
A host with no row at all is left alone and routed exactly as today (the issuer comes from configuration, so a host selects nothing), which is what keeps the loopback health checks, the conformance scripts and a deployment reached by IP unchanged; at a root path such a host reaches nothing because no route lives there. A host that has a row but is not live (`pending`, `failed`, idle) receives the same bare refusal an unknown path does, for every path. Host resolution is skipped for the base host, for `/health*` and for `/internal/domain-check`, so a probe whose `Host` is `127.0.0.1` or an internal name costs no lookup. Requests
already under `/tenants/` on a domain host are refused: a domain serves its own
tenant at the root and nothing else.

Every place that writes an address uses one address service instead of
concatenating `base + /tenants/ + name`. The service takes the tenant and
returns its canonical base; the issuer, the cookie `Path`, the sign-in handle,
the mail links and the asset URLs read it. Finding every concatenation is the
plan's first task, by grep, and a lint holds it afterwards.

### 3.5 Switching

**Activate** sets the domain canonical in one transaction and records the previous
issuer with the switch time. **Deactivate** (switch back) is the same operation
toward the path address. Both are admin API and console actions on the base
address, need no call to the domain, and write an audit row.

**What each side serves after a switch.** For the transition window below, the
previous address keeps serving token, userinfo, introspection, revocation, jwks
and logout, so what was already issued keeps working. It refuses authorization
requests, registration and password-reset pages with a pointer to the canonical
address. Discovery states the issuer of the address it is read at, which must
equal that address; a token minted at the previous address in the window carries
that address's issuer. When the window ends the previous address refuses
everything for that tenant, and a refresh token is then used at the canonical
address (it is bound to the tenant, not to an address).

**The transition window** is fixed at the ceiling the token endpoint enforces on
an access token's lifetime. For that long after a switch the tenant accepts the
previous issuer on `/userinfo` and introspection, and the previous issuer's
signature check uses the same keys, because keys belong to the tenant. After the
window only the canonical issuer is accepted. Refresh tokens are bound to the
tenant and survive a switch. A resource server that verifies JWTs locally must
accept both issuers for the window; the guide says so.

**What a switch ends.** Browser SSO sessions: the session cookie is host-only
(`__Host-<tenant>-session`), so people sign in once more at the new address, and
the docs say so. **Passkeys:** a credential is bound to the RP ID it was
registered under. Each credential row records its RP ID (a new column,
back-filled with the base host's RP ID, since every existing passkey was
registered under it). Authentication offers only credentials whose RP ID is the
canonical one, so a switch hides the others instead of leaving the browser to
fail silently, and a switch back brings them back. The console warns, before a
switch, how many subjects have passkeys that will be hidden.

### 3.6 The proxy's question

`GET /internal/domain-check?domain=<host>` (answered whatever the request's `Host`, since the proxy calls it by an internal name) answers `200` for a verified, unfailed
host and `404` otherwise, with an empty body in both, one indexed lookup and no
tenant detail. It is rate-limited per caller and takes no shared secret: all it can reveal is which hosts are registered, which certificate transparency logs and DNS already show; the guide tells the operator to keep it off the public network. How an operator points Caddy's `on_demand_tls { ask }` at it, and why the
route must not be public, are in the deployment guide.

### 3.7 Calls settled in review

Questions a reader of this document asked, answered here as the author's calls.

- **What a domain host serves.** Only what `/tenants/:tenant/…` serves today
  (protocol, login actions, account pages, brand assets), rewritten to the
  tenant's path, plus `/.well-known/openid-configuration` mapped to the tenant's
  discovery document, so the issuer `https://login.acme.com` has its discovery at
  the URL the specification derives from it. Everything else on a domain host
  (`/admin`, `/console`, `/docs`, `/internal`, health, metrics) gets the bare
  refusal; those live on the base host, and a proxy health check targets it.
- **Which header.** Fastify's `request.host`, which honours `X-Forwarded-Host`
  only when `ODUDU_TRUST_PROXY` is on and is the `Host` header otherwise. Behind
  a proxy that preserves `Host` (Caddy's default) it works with trust off; a
  client-set `X-Forwarded-Host` never selects a tenant when trust is off. The
  check endpoint's per-caller rate limit is keyed as the existing origin
  throttle is (ADR 0023).
- **The lookup seam.** The plan's first task greps how the tenant-name lookup
  reaches the database before tenant context exists, and the host lookup uses
  that same seam and returns only tenant id, name, state and canonical flag.
  The recheck command runs on the connection `odudu reap` uses. Writes to the
  table are tenant-scoped and probed with a foreign tenant.
- **Issuer checks in the window.** The sites that compare an issuer are
  `/userinfo`, introspection, `id_token_hint` at authorization and logout, and
  the `aud` of a client assertion; each accepts the canonical issuer and any
  retired one still inside its window. A tenant keeps a short list of retired
  issuers, each with its own expiry. A switch removes the new canonical from the
  list and adds the old one with `now + ceiling`, so a second switch inside the
  window leaves both valid. The plan lists the sites by grep and a test drives
  each.
- **Passkeys.** Registration and sign-in happen only at the canonical address
  (the previous address refuses sign-in pages), so a passkey ceremony verifies
  against the canonical origin and RP ID alone. Two tenants on the path address
  share the base host's RP ID, as they do today.
- **Off switch and compatibility.** There is no feature flag: a tenant with no
  verified domain row changes nothing, and a request for the base host does no
  domain lookup. `/internal/domain-check` always exists and answers 404 when
  nothing is registered. The recheck loop has a switch named in the loader like
  the others, so it can be turned off for a deployment that schedules
  `odudu domains recheck` externally. Nothing here is pre-1.0 frozen: the admin
  shapes are new.
- **Which domains serve.** A verified domain serves, and is approved by the
  check endpoint, only while it is its tenant's canonical address or inside a
  window after being so. A verified domain that is neither is idle: it resolves
  to nothing and is not approved. The recheck covers every verified domain, and
  one that fails is marked `failed`; if it was canonical the tenant falls back as
  in 3.3.
- **Capability.** A new capability pair for domains, named and wired as
  branding's is, with the console area, admin-path and docs tests that follows;
  the plan finds those by grep.
- **Mail links and brand assets** always use the tenant's canonical address,
  whichever address the request arrived at.
- **A host-to-tenant cache** is not required. One indexed read per request on a
  non-base host is the design; a cache comes only where a measurement asks for
  it, and then states its bound and its invalidation on a switch.

## 4. Constraints

- Volume (ADR 0041): 10,000 tenants and so tens of thousands of domains; the host
  lookup is one indexed read, a list endpoint makes a constant number of queries,
  and any in-process cache of host to tenant states its bound and its
  invalidation on a switch.
- The layering of CLAUDE.md holds: the address rule is a pure `service` function;
  the recheck is a usecase taking `now`; no logic in a repository.
- Every user-facing string is a catalogue entry (ADR 0043), including the
  "this address no longer signs people in" page, with Arabic.
- Every new table and method is probed with a foreign tenant.
- No `any`, tests first, integration tests on real PostgreSQL.

## 5. Approaches considered

**A. A rewrite at the edge plus one address service (chosen).** Host to tenant to
a rewritten URL before routing; every address written by one service. Trades:
the 86 routes stay untouched and existing tests keep proving the default; the
cost is finding every place that builds an address by hand.

**B. Register every route a second time at the root.** The tenant comes from the
host inside each handler. Trades: no rewrite trick, but 86 duplicated routes and
a second set of tests that will drift from the first.

**C. A separate listener per domain.** Rejected: it breaks the one-process,
one-port deployment the quick start ships and does nothing for host lookup.

On whether a switch replaces the path address or sits beside it, the owner chose
the refined "both serve, one is canonical" model (replace, both live, or an alias
were the alternatives; an alias is impossible, since an issuer is one string).
On the window, a fixed one was chosen over a per-tenant "keep both fully live"
setting, which doubles the issuers and RP IDs to test for no gain refresh tokens
do not already give.

## 6. Left to the builder

The column and index names, the exact audit action names, the recheck's default
count and interval, the wording of each page and message, whether the address
service lives in `kernel` or in each package behind an interface, and the order
of increments, provided the address-service task comes first.

## 7. Documentation this phase owes

The roadmap's "Next" bullet moves to "Shipped" and its "What is not implemented"
line is rewritten; section 11's P4j row gets "As built"; `docs/NEXT.md` drops
the P4j inheritance; the landing page, README and `questions.md` lose their
"follows in P4j" lines; a guide for operators (proxy, DNS, the switch and its
costs) with runnable blocks where it can have them; the transcripts for the
domain routes and the check endpoint re-run on a live stack; `CHANGELOG.md`
under `Unreleased`; a phase note in the P4j note under `docs/phases/`; an ADR for the
canonical address and the transition window.
