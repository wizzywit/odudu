# 0038 — The admin console and its gateway

**Status:** Accepted · 2026-09-27

## Context

P4c and P4e gave the admin API every route it needs; nothing a person can
look at drives it, and every operator task is a `curl` against `/admin/**`.
P4d builds that surface: a React application, `apps/admin-console`, and a
way for it to hold a session against Odudu without becoming a place a token
can be stolen from.

A single-page application that keeps its own access and refresh tokens —
in memory, in `localStorage`, or anywhere else the page's own JavaScript can
read — is exactly the shape RFC 10017 (OAuth 2.0 for Browser-Based
Applications) writes to move away from: any script that runs on the page
runs with the tokens. RFC 10017 recommends a backend component holding the
tokens instead, the browser talking to it over a session cookie. Odudu
already has a backend: `apps/server`.

## Decision

**A backend-for-frontend, not a token-holding browser client.**
`@odudu/console-gateway`, mounted by `apps/server` under `/console`, is an
OAuth client of Odudu like any other: it runs the authorization code flow
against `/authorize` and `/token`, and keeps the access, refresh and ID
tokens server-side, encrypted, keyed to an `HttpOnly` session cookie the
browser never reads. The console calls `/console/api/admin/*`, which the
gateway forwards to `/admin/**` in-process, attaching the bearer token
itself. No token, no `client_secret` and no PKCE verifier is ever sent to
the browser.

**The stack.** React 19.3, built by Vite as a static SPA the server serves.
TanStack Router for routes and search parameters, TanStack Query for server
data. React Aria Components, unstyled, for every interactive primitive. CSS
Modules over custom-property tokens for styling. Zustand for the small set
of UI-only stores the state table (spec §6.4) allows — toasts, the
unsaved-changes guard — never for server data.

### Rejected

- **Tailwind v4.** A utility class carries no design-token boundary of its
  own; CSS Modules over custom properties keep every token as a single,
  greppable source instead of a class name convention.
- **vanilla-extract.** Build-time CSS-in-TS buys type-checked style objects
  at the cost of a compiler step the workspace does not otherwise need; CSS
  Modules get the same scoping with plain CSS.
- **Next.js.** Brings a server runtime and a routing convention of its own
  into a workspace that already has one server (`apps/server`) and one
  router library (TanStack Router); the console is a static SPA, not an
  application that needs Next's server rendering.
- **React Router's framework mode.** Framework mode assumes it owns data
  loading and the build; the console's data lives behind TanStack Query and
  the gateway, and TanStack Router's own type-safe search-parameter handling
  is what the state table (spec §6.4) is built around.
- **An in-browser OAuth client.** The rejected half of the decision above:
  tokens in the page are tokens a compromised dependency can read. RFC 10017
  exists because of exactly this case.
- **A token-mediating backend** (a server that exchanges the code but hands
  the resulting tokens back to the browser rather than keeping them). Keeps
  the authorization code out of the browser but not the access token,
  leaving the theft surface RFC 10017 identifies unaddressed.

## Consequences

- The layer rule inside `apps/admin-console` is by path segment, folder or
  single file (spec §6.2): a layer a feature does not need does not exist,
  and every file is classified by its path alone rather than by a fixed
  five-file scaffold per feature.
- The React file-naming convention — `PascalCase.tsx` for a component,
  `useCamelCase.ts` for a hook, `camelCase.ts` for anything else — holds
  only inside `apps/admin-console`. The server keeps kebab-case; this ADR
  introduces no naming change outside the console.
- Every admin action the console performs is authorised twice: by the
  gateway's own session check and, on the forwarded request, by the admin
  API's existing `authorizeAdmin`. The console holds no authority of its
  own to lose.
- The gateway is a new package and a new pair of tables
  (`console_sessions`, `console_logins`) under row-level security, reaped
  alongside every other session-shaped row; it is more moving parts than an
  in-browser client, accepted for the theft surface it removes.

## Amendment (2026-09-28): one console session per browser

A browser holds one console session. Signing in to another tenant asks
first and replaces the session only once the new sign-in succeeds (spec
§7.1). Operating several tenants is the system administrator's job: one
sign-in in `system` reaches every tenant, in as many tabs as wanted, under
the amber context bar. This is the model Keycloak's master realm and
Auth0's tenant switcher use.

Concurrent sessions for separate per-tenant accounts were weighed and not
built. `__Host-` forbids scoping a cookie to one tenant's path, so they
need one cookie name per tenant and every request routed to the right one,
which reopens the tab-acting-as-someone-else risk the switch page closes.
AWS's opt-in multi-session is the model if a need appears: bounded, opt-in,
and isolated per session by subdomain.

## Amendment (2026-10-09): the gateway authenticates as `odudu-admin`

Nothing chose "public" for `odudu-admin`: it was the provisioning default
from before a gateway existed, and the decision above recorded it only as a
fact. The gateway is a server and can hold a credential, so by the same BFF
reading of RFC 10017 it authenticates at the token endpoint. That puts a
second lock on a stolen authorization code, binds the refresh token to client
authentication, and stops any other page from starting a login as the
console.

**Decision.** `odudu-admin` is a confidential client authenticating by
`private_key_jwt` (RFC 7523 §2.2, OIDC Core §9). One ES256 key pair is held by
the gateway and registered, as its public half, on every tenant's
`odudu-admin`. The gateway signs a fresh assertion — `iss` and `sub` the
client, `aud` the tenant's token endpoint, a minute's lifetime, a new `jti`
— on the authorization-code exchange, the refresh and the revocation, the
three requests that name the client. Nothing else it sends is authenticated
this way: the admin API still sees only the subject's bearer token.

**The key is registered inline (`jwks`), not by `jwks_uri`.** The server's
own `private_key_jwt` support was read, and run, before this was chosen.
A `jwks_uri` is fetched through an address guard that refuses anything not
`https` and refuses loopback addresses outright, whatever
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS` says (`service/remote-address.ts`);
`ODUDU_PUBLIC_BASE_URL` is `http://localhost:…` on every development, CI and
documentation stack, and a container does not reach its own published port.
A success is cached for five minutes, so a rotation would have to wait out the
cache; a failure is cached for thirty seconds, so the server fetching its own
public URL and failing once would refuse that tenant's console sign-in for as
long. An inline key set has none of that: the
check is a read of the client's own row.

**Rotation does not edit tenants one at a time, but it does write every
tenant's row.** That is the price of `jwks`, and it is paid by the command
that already exists for a changed base URL, `odudu console provision`, which
visits each tenant in a transaction of its own and writes only where the
registered keys differ. A key is replaced in an overlap, so no tenant ever
lacks the key the gateway signs with:

1. `odudu console keygen` makes the new key. Set `ODUDU_CONSOLE_CLIENT_KEY` to
   it and `ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS` to the old value (a private or a
   public key; only the public half is read).
2. Run `odudu console provision` with that environment, before any server
   signs with the new key. Every tenant now registers both.
3. Roll the servers. A tenant created during the roll by a server still on
   the old key registers it alone, so run `provision` once more afterwards.
4. Unset `ODUDU_CONSOLE_CLIENT_KEY_PREVIOUS`, run `provision` again, and the
   old key is gone from every tenant.

**Configuration.** `ODUDU_CONSOLE_CLIENT_KEY` is the signing key: an ES256
private JWK, base64-encoded as `ODUDU_KEK` is, so no environment file,
manifest or shell has a character to quote. Its `kid` is its RFC 7638
thumbprint, never a value the configuration supplies. It is required while
the console is on (`ODUDU_CONSOLE` is not `false` and a base URL is set): the
server refuses to start without it, naming the variable and the switch, and
so do `seed` and `console provision`. No stack's `.env.example` carries one,
since a private key is not something to commit; `infra/docker/ensure-console-key.sh`
adds one to a `.env`, and the conformance scripts make one per run.
With the console off nothing is read and a new `odudu-admin` stays public, as
before; `provisionAdminClient` converts a public one to confidential and never
converts it back.

**`clients_secret_matches_type` is relaxed, not worked around.** The
constraint required a secret hash on every confidential client. Whether a
confidential client has a secret depends on its authentication method, which
is on `client_oidc_config`, and a CHECK on `clients` cannot read another
table, so "relax it for non-secret methods" cannot be written there. Migration
`0098_clients_secret_by_type.sql` keeps the half that protects something — a
public client carries no secret — and drops the other. A confidential client
with no hash cannot authenticate by secret (`verifyClientSecret` refuses it),
so the absence fails closed. The alternative, a hash of a secret nobody was
given, is what every other `private_key_jwt` client carries today: a credential
shaped value that can never be presented, one Argon2 hash per tenant at
conversion, and a stored secret the rotate route would then offer to replace.
That route now refuses a client whose method is not a secret one, and the
client page says why instead of offering a rotation.

**Consequences found on the way, fixed here.**

- `/revoke` and `/introspect` authenticated through the password methods alone,
  so a `private_key_jwt` client could not call either. Both now share the
  assertion check `/token` runs, with the token endpoint's URL as the one
  accepted `aud` at all three. Discovery lists the method for both.
- The administrator who redeemed a code at `/token` as a public client with
  nothing but PKCE cannot any more while the console is on. `odudu console
assertion --tenant <name>` prints an assertion for whoever holds the key. It
  is key-holder-equivalent: it asks nothing the key does not already allow, so it
  guards nothing and records instead. It refuses a tenant that does not exist and
  writes an audit row (`console.assertion`, `admin_mutation`) naming the tenant and
  the command, never the assertion; the redemption it enables is audited at
  `/token` as any other.

### Rejected

- **Keep `odudu-admin` public.** Nothing in its favour but inertia: the code
  and the refresh token are redeemable by anyone holding them, and any page can
  start a login as the console.
- **A `client_secret` per tenant.** The gateway would hold 10,000 secrets and
  rotate each one, with a grace window per tenant, against one key pair and one
  command.
- **The server reading the key set from configuration for this one client.**
  Rotation would be a configuration change with no tenant written, but the
  console's key would then sit outside the data model: the admin API would show
  a client authenticating by `private_key_jwt` with no keys, and the token
  endpoint would have a branch for one client's identity.
- **`jwks_uri`.** Above.
