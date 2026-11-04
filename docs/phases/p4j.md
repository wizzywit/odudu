# P4j — a public address of its own for each tenant (a custom domain)

What the phase found, in the shape `docs/phases/p2b.md` established: the running
record the spec and plan do not keep. The argument is in
[ADR 0049](../adr/0049-a-tenant-has-one-canonical-address.md); the reading note for
the host rules is in [web-security.md](../protocols/web-security.md), "Which host
selects a tenant"; how it was planned is in the
[spec](../superpowers/specs/2026-11-04-p4j-custom-domain-design.md) and the
[plan](../superpowers/plans/2026-11-04-p4j-custom-domain.md).

## What shipped

A tenant has one canonical address, its path address or one verified domain at the
root, and the issuer, the cookies, the RP ID and every link Odudu writes follow it.

- **A table of domains** (`0111_tenant_domains.sql`):
  state `pending`, `verified` or `failed`, a challenge, `canonical` at most once per tenant,
  a host unique among verified rows, twenty a tenant. `tenant_issuer_retirements` holds an
  address a tenant left, with its expiry. The `rp_id` column that gives a
  passkey the RP ID it was registered under is in the same migration, and
  `0112_user_credentials_passkey_rp_id.sql` indexes it.
- **One address service** in `@odudu/kernel` (`TenantAddress`), and a lint
  (`tests/lint/tenant-address.test.ts`) that holds every package to it: no place writes
  `base + /tenants/ + name` itself.
- **Host resolution at the edge**, as a rewrite to the tenant's path before routing, so
  none of the routes that take `:tenant` changed. A host with no verified row is routed as before.
- **`GET /internal/domain-check`** for the reverse proxy's on-demand TLS question, with its
  own limiter and no secret.
- **The admin API** under `/admin/tenants/{tenant}/domains` (register, list, read, verify,
  activate, deactivate, remove, passkey impact) behind the new `view-domains` and
  `manage-domains` capabilities, which raise the built-in roles from eight to ten; `If-Match`
  is required to switch.
- **A switch** that ends the tenant's browser sessions, records the address left as a retired
  issuer for 3600 seconds, and leaves the address left serving token, userinfo,
  introspection, revocation, keys, logout and discovery, with a `410` page for sign-in.
  Resource servers, `id_token_hint` and client assertions accept both issuers for the window.
- **Passkeys bound to the canonical address**, hidden at the other and brought back by a
  switch back; password sign-in is untouched.
- **A recheck pass** (`odudu domains recheck`, with the loop beside the scheduler) that fails
  a domain after a set number of misses, tells absent from indeterminate, skips a page in
  which most lookups were indeterminate, and returns a tenant to its path address.
- **`odudu seed domain`**, with `--assume-verified` refused in production.
- **A Domains area in the console**, and the guide
  [Custom domains](../../apps/docs/content/en/operating/custom-domains.md).

## What proves the domain path

`container`, `conformance` and `quickstart` each drive the server through the path address
only: none of them sends a request whose `Host` is a domain. They prove that a tenant that
does nothing is unchanged, which is the half of the owner's rule they can prove. The domain
path is proved by:

- `apps/server/src/host-resolution.int.test.ts`, which runs a full authorization code flow on
  a domain, the account pages, a required action, CORS, the throttles and the error pages,
  against real PostgreSQL, and compares each with a twin tenant still on its path address;
- `apps/admin-console/e2e/domains.spec.ts`, which registers, verifies, switches and removes
  a domain through the console in a browser;
- `apps/server/tests/retired-issuer.int.test.ts` for the window, and
  `packages/authn-flows/tests/passkey-address.int.test.ts` for the RP ID;
- the query-plan check, which plans every new statement at the volume of ADR 0041.

What no CI job runs is a real reverse proxy against real DNS. The Caddy block in the guide
is an illustration, tagged `text`, and the `ask` wiring was never exercised by a proxy.
The transcripts send a `Host` header to a stack's port instead.

## What each increment found

- **The address service.** The grep for the concatenation found sites in the kernel, theme,
  account, authn-flows, protocol-oidc and protocol-admin packages, and the lint now holds
  the pattern. `pathAddress` had to encode the tenant name, which the concatenations had not.
  An account helper took its origin from the request's authority, a second source for the
  address; mail links now read the canonical address from the database.
- **The table.** `lookupHost` runs on the owner connection, since the serving role cannot see a
  row before a tenant is known. A retirement matched either scheme of a host, and `http` and
  `https` of one host are different issuers, so a switch records the scheme.
- **The domain rules.** Review found that a Unicode dot or a fullwidth letter walked past the
  refusal of the operator's host and of `localhost`: hosts are now refused by their folded
  spelling.
- **Host resolution.** The ruling to read the first `X-Forwarded-Host` entry was wrong: the
  entry a client writes is the leftmost, and the proxy appends. It is the last entry, as
  Fastify's `request.host` reads it. A host's state is read in one statement. `/health*` is exempt on every host, which the spec's wording had to be
  reconciled to say. A page's operator links on a domain's 404 and 500 pages needed the same
  classification as the route.
- **The proxy's question.** Its limiter is 300 a minute from one origin, and a proxy is one
  origin: a flood of handshakes spends the budget for everyone behind it. The guide says so.
- **The admin API.** The brief's capability names did not exist; the repository's vocabulary
  is `view-x` and `manage-x`. A host that another tenant has verified cannot be refused at
  registration, because row-level security hides that row, so it is refused at verify; the spec
  was reworded. Review found the passkey impact count unbounded and the verify cooldown keyed
  by host across tenants, so one tenant's verification could throttle another's. A migration indexes the
  impact read and a cap bounds it.
- **The window.** A canonical row set without a retirement refuses its path address at once,
  which the plan's world had done by direct insert; `seed domain` goes through the same
  switch as the API for that reason.
- **Passkeys.** A person with only passkeys registered at the address left gets a challenge
  they cannot answer at the new one, and the sign-in flow has no fallback inside it. The guide
  says what recovers them, and the row below keeps the rest open.
- **The recheck.** The implementer found a contradiction: the spec had a failed domain stay
  failed and the admin API refuse to verify it, which together made a lost record
  unrecoverable. A failed domain is verified again once its record is seen. The outage guard
  was first per pass and is per page, which keeps memory to one page.
- **`seed domain`.** `--assume-verified` cannot bypass the host another tenant verified, since
  the unique index refuses it.
- **The console.** The count of passkeys a switch hides was read from a cache that a refetch
  had not replaced; the confirmation is held until the fresh count lands. An empty `If-Match`
  was sent when the tenant's tag was not yet known; the controls stay off until it is.

## Effort

The row estimated 20–35 h. The hours were not tracked. The wall-clock span between the first
and the last commit of the build was 9 h 25 min on 2026-11-04 (`13:14` to `22:39`), made by
agents working one task at a time with a review after each, so it is not a figure for a person's
hours and is not comparable with the estimate. The documentation increment ran after it.

## Left, and where it went

Each row is in `docs/NEXT.md`, "Decisions still open", with its argument.

- **A global cap on verification lookups, and a limiter shared between instances.** The
  verify throttle and the check endpoint's limiter are per process: **P11**, with the other
  in-process bounds.
- **A host-to-tenant cache.** One indexed read per request on a non-base host, and one on the
  path addresses, is the design; a cache has to state its bound and its invalidation on a
  switch and would blur "refused at its expiry". **P11**, when a measurement asks.
- **Back-channel logout retry keeps the original `exp`.** A retried logout token that has
  expired is refused by the receiver. It predates this phase and is outside its topic; **P11**
  takes it with the other outbound-call work.
- **A person with no password and only hidden passkeys has no way back inside the sign-in
  itself**; recovery needs a switch back, a reset or an administrator (the guide says which).
  **P4f**, whose self-service criterion owns the account's own recovery.
- **Not run:** a real reverse proxy and real DNS (above); `pnpm verify`, the e2e specs, the
  conformance job and the console screenshots of this closing increment ran in CI.
- **The admin paths as a whole.** The blocks that listed roles or what `tenant-admin` carries were
  run again for the two new capabilities; the 73 pages in one order on one stack stay with **P4g**.
