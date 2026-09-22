# P3a — Clients, registration and consent

**Date:** 2026-09-18
**Status:** Approved
**Umbrella:** `docs/superpowers/specs/2026-09-10-odudu-design.md`, section 11

## 1. What this phase is

Everything a client needs in order to exist, describe itself and be
approved by a user: dynamic client registration under a realm policy, the
client metadata the rest of P3 reads, and a consent screen with a grant
recorded behind it. The exit criterion is section 12.

It is the first half of what section 11 carried as P3. Section 2 records
the split and why.

## 2. How P3 became two phases

P3's criterion had grown past what one phase can finish. Brainstorming on
2026-09-18 added two decisions that the 80–120 hour estimate never
contained — concurrent sessions per browser, and retrofitting the page
contract across every existing renderer rather than only writing the
consent screen against it — which put the phase at roughly 105–160 hours,
larger than P2b, the largest phase this project has completed.

The roadmap already has the precedent and states the reason: P2 split into
P2a and P2b because a phase nobody can finish is a phase nobody starts.

**The seam is a real dependency, not a convenience.** Every P3b clause
reads client metadata P3a registers — back-channel and front-channel
logout URIs, the client's key material, its audiences, its UserInfo
algorithms — and no P3a clause reads anything P3b builds. The dependency
runs one way. The headline criterion, the OIDF Dynamic OP plan, sits
wholly in P3a, so it is answered at the halfway point rather than at the
end.

**Nothing outside P3 is renumbered.** P4 onward keep their digits, which
matters: roughly 150 `deferred:` rows carry phase numbers, `pnpm trace`
skips rows whose marker is an intent rather than a digit, and ADRs 0016
and 0017 cite phase numbers.

**The 78 `deferred: P3` rows are not left to rot.** They resolve to `P3a`
or `P3b` in the increment that splits the roadmap, before any other work:

verified: `grep -rc "deferred: P3 " docs/protocols/` on 2026-09-18 — with
the trailing space, because `deferred: P3` also matches `P3a` and `P3b` and
so could not distinguish a reassigned row from an untouched one —
`oidc-backchannel.md` 33, `oidc-core.md` 22, `rfc6749.md` 18,
`oidc-rpinitiated.md` 2, `rfc9068.md` 2, `oidc-discovery.md` 1. The check
that the reassignment finished is the complementary one, and it is the one
worth re-running: `grep -rnE "\bP3\b" docs/ README.md` returns nothing,
because P3 is not a phase any more.

This is `CLAUDE.md`'s closing-pass rule 2 applied at the moment the split
happens rather than three commits later: a phase that renumbers or splits
anything greps every document for the old number before it closes. Doing
it first also means every subsequent increment writes the right marker.

## 3. Decisions

Each gets an ADR. The numbers continue from 0025.

| #    | Decision                                                                         |
| ---- | -------------------------------------------------------------------------------- |
| 0026 | Client registration is a three-state realm policy, closed by default             |
| 0027 | Consent is required by default for anonymously registered clients only           |
| 0028 | A client-supplied URL the server fetches is bounded before the socket, not after |
| 0029 | A page's headers have one authority; transport stays out of `kernel`             |
| 0030 | A theme replaces a body fragment, never the document                             |

## 4. Ownership and schema

### 4.1 Where things live

The repository already splits clients along a line this phase follows:
`domain-tenant` owns `clients`, `client_scopes` and realm settings;
`protocol-oidc` owns `client_oidc_config`. The domain owns the client, the
protocol owns its OIDC metadata.

verified: `grep -rln "pgTable('clients'" packages/*/src` →
`packages/domain-tenant/src/schema/clients.ts`, 2026-09-18.

| New thing                            | Package                       | Why                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `consents`, `consent_scopes`         | `domain-tenant`                | Consent is what a subject authorized a client to do. It is not wire-shaped and outlives OIDC. `CLAUDE.md` forbids protocol packages importing each other, so consent placed in `protocol-oidc` would be unreadable to P5's agent layer and P9's authorization services. It references `client_scopes`, which `domain-tenant` owns. |
| `client_registration_tokens`         | `domain-tenant`                | An initial access token is a realm's credential for creating clients, not an OAuth artefact.                                                                                                                                                                                                                                      |
| Registration endpoint, usecase, DTOs | `protocol-oidc`               | An OAuth endpoint advertised in discovery. It orchestrates a `domain-tenant` client write and a `protocol-oidc` config write.                                                                                                                                                                                                      |
| `consent-html.ts`                    | `protocol-oidc/src/view/`     | `CLAUDE.md`: pages belonging to the protocol endpoints themselves live there, beside login, error and logout. Consent is an `/authorize` step.                                                                                                                                                                                    |
| `pageHeaders`                        | `packages/kernel/src/page.ts` | Where `RenderedPage` already lives, and the one module all three page-owning packages may import.                                                                                                                                                                                                                                 |

A cross-table foreign key does not force a package import. `token_grants`
lives in `protocol-oidc` and references `subjects`, which `domain-identity`
owns; the same idiom applies here, so the package graph is unchanged.

verified: `sed -n '/"dependencies"/,/}/p' packages/domain-tenant/package.json`
→ `@odudu/db`, `@odudu/kernel`, `drizzle-orm` only, 2026-09-18. The comment
at `packages/domain-tenant/src/service/client.ts:2` states the constraint
directly: the Argon2id comparator is injected because "domain-tenant must
not depend on domain-identity". Anything P3a adds to `domain-tenant` that
needs a `domain-identity` capability injects it the same way.

### 4.2 Migrations

Numbering continues from 0044.

verified: `ls packages/db/drizzle/ | tail -1` → `0044_authentication_sessions_authenticated.sql`, 2026-09-18.

**`client_oidc_config` gains the metadata later clauses read.** `jwks`
(jsonb), `jwks_uri` (text), `frontchannel_logout_uri`,
`backchannel_logout_uri`, `backchannel_logout_session_required` (boolean),
`consent_required` (boolean), `userinfo_signed_response_alg`,
`userinfo_encrypted_response_alg`, `userinfo_encrypted_response_enc`. The
`token_endpoint_auth_method` CHECK widens to admit `private_key_jwt` and
`tls_client_auth`.

A CHECK forbids `jwks` and `jwks_uri` both being present. RFC 7591 §2 makes
them mutually exclusive, and this repository's idiom is that a rule no
writer may bypass lives at the database — the same reasoning
`realm-settings.ts` gives for leaving ranges to CHECK constraints.

**`clients` gains `registration_origin`**, `text NOT NULL DEFAULT 'seeded'`
with a CHECK of `('seeded', 'anonymous', 'token')`. Section 5.3 explains
why the value is three-way rather than a boolean.

**`realms` gains two settings.** `client_registration_policy text NOT NULL
DEFAULT 'disabled'` with a CHECK of `('disabled', 'open', 'token')`, and
`max_clients integer NOT NULL DEFAULT 200` with a CHECK of `>= 0`.

Both names go into the `SETTINGS` map in
`packages/domain-tenant/src/service/realm-settings.ts:9`, which makes
`odudu seed realm --set client_registration_policy=token` work with no CLI
change. That is the payoff of that map existing, and the reason the policy
is one three-valued column rather than a pair of booleans.

**`consents` and `consent_scopes`**, per section 7.1.

**`client_registration_tokens`**, per section 5.2.

Every new table gets `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL
SECURITY` and an isolation policy on `realm_id`, and every repository
method against it is probed with a foreign `realm_id`.

### 4.3 The rule that keeps the split honest

P3a stores `backchannel_logout_uri` and does nothing with it. That is the
point of the split, and it is also a hazard the protocol notes already
name: `docs/protocols/oidc-backchannel.md:25` records that advertising
`backchannel_logout_supported` would "claim a capability the OP does not
have".

**So P3a registers and validates this metadata and advertises none of it.**
`backchannel_logout_supported`, `frontchannel_logout_supported`,
`userinfo_signing_alg_values_supported`,
`userinfo_encryption_alg_values_supported`, `introspection_endpoint` and
`revocation_endpoint` stay absent from discovery until P3b implements the
behaviour behind them.

This is a test P3a owes, not a convention: a live discovery response is
asserted to name no capability whose behaviour is deferred. The existing
`packages/protocol-oidc/tests/claims-supported.int.test.ts` — which fails
the build if `entitlements` appears in a live discovery response — is the
shape to copy.

## 5. The registration endpoint

Path: `POST /realms/{realm}/clients-registrations/openid-connect`, with
RFC 7592 management under `/{client_id}` if section 11's second spike says
the plan requires it.

RFC 7591 fixes no path and discovery advertises `registration_endpoint`, so
the path is ours. Plain `/register` is rejected because it would sit
confusingly beside `/realms/{realm}/login-actions/registration`, which is
**user** self-registration and already exists.

verified: `grep -rn "login-actions/registration" packages apps` →
`packages/account/src/view/routes/registration.ts:76`, 2026-09-18.

### 5.1 The three states

`disabled` (the default) answers 404 **and** omits `registration_endpoint`
from discovery — section 4.3's rule applied to the endpoint itself.

`open` accepts unauthenticated requests. RFC 7591 §3.1: "To support open
registration and facilitate wider interoperability, the client registration
endpoint SHOULD allow registration requests with no authorization".

`token` requires an initial access token presented as a bearer credential.

Defaulting to `disabled` matches every realm toggle P2a and P2b added —
`registration_allowed`, `verify_email`, `reset_password_allowed` are all
`DEFAULT false`, under a migration comment saying a realm "does not acquire
a public registration endpoint because it was upgraded". It also converges
with Keycloak, whose Trusted Hosts policy ships with no trusted hosts,
which its documentation says makes "anonymous client registration de-facto
disabled".

### 5.2 Initial access tokens

`client_registration_tokens (id, realm_id, token_hash, created_at,
expires_at, remaining_uses)`, with `UNIQUE (token_hash)` and a CHECK of
`remaining_uses >= 0`.

This copies `action_tokens` deliberately, which is proven here:
`randomBytes` for the value, `sha256Hex` for storage, lookup by hash.

verified: `packages/account/src/repository/action-tokens.ts:18` —
`createHash('sha256').update(token).digest('hex')`, 2026-09-18.

A deterministic SHA-256 rather than Argon2id is correct for the same reason
it is correct there: the value is 256 bits of `randomBytes`, not a
password, and it has to be found by its hash. `remaining_uses` replaces
`consumed_at` because RFC 7591 §3 permits a multi-use token; it is
decremented in the same transaction as the client insert, so concurrent
registrations cannot overspend one token.

Issued by `odudu seed registration-token --realm <r> --uses <n> --ttl
<seconds>` and printed once. The CLI is the issuing surface because there
is no admin API until P4 — the same position `seed realm --set` already
accepts.

### 5.3 What is validated, and what the defaults are

The server assigns `client_id`; a client cannot propose one. RFC 7591 §2:
it "SHOULD NOT be currently valid for any other registered client", which
`clients_client_id_unique (realm_id, client_id)` already enforces.

**Redirect URIs are validated at registration, as a MUST.** RFC 7591 §5:
"registered redirection URI values MUST be one of: A remote web site
protected by TLS... A web site hosted on the local machine using an HTTP
URI... A non-HTTP application-specific URL".

**`consent_required` defaults on for anonymous registration and off
otherwise.** RFC 7591 §5 warns that "a rogue client might use the name and
logo of a legitimate client that it is trying to impersonate", requires
that "an authorization server MUST take appropriate steps to mitigate this
risk by looking at the entire registration request", and says an AS "can
also present warning messages to end-users about dynamically registered
clients in all cases".

The axis is **how the registration was authorized**, not whether it was
dynamic, and that is taken from a shipping implementation rather than
inferred. Keycloak's `DefaultClientRegistrationPolicies.addAnonymousPolicies()`
installs a `Consent Required` policy; `addAuthPolicies()` installs none.

verified: `curl -sL https://raw.githubusercontent.com/keycloak/keycloak/main/services/src/main/java/org/keycloak/services/clientregistration/policy/DefaultClientRegistrationPolicies.java`,
2026-09-18. The policy's own description: "Newly registered clients will
have `Consent Allowed` switch enabled. So after successful authentication,
user will always see consent screen when he needs to approve permissions
(client scopes)."

An initial access token **is** an operator's authorization for that client
to exist, so a `token`-registered client is as trusted as a seeded one.
`registration_origin` is three-way for exactly this reason: the consent
default is derived from it rather than being a second flag to keep in sync,
and the value is worth recording for audit regardless. An operator may
still override `consent_required` per client.

**`max_clients` bounds the realm.** RFC 7591 §5: registration requests "MAY
be rate-limited or otherwise limited to prevent a denial-of-service attack
on the client registration endpoint." A per-realm cap is the concrete form,
matching Keycloak's `Max Clients Limit` (200 by default).

**The cap is taken under a lock, not with a bare `COUNT`.** A count followed
by an insert is two statements with a gap: two concurrent registrations read
the same total, both find room, and both insert — so the cap a
denial-of-service bound exists to hold is the one thing that fails under the
load it is meant to bound. The registration transaction issues
`SELECT max_clients FROM realms WHERE id = $1 FOR UPDATE` first, which
serialises registrations **per realm** and leaves other realms concurrent.
The cost is one row lock on a path that is neither hot nor latency
sensitive; a counter column maintained by trigger would buy concurrency this
endpoint has no use for and add a second thing that can disagree with
`COUNT(*)`.

## 6. A client-supplied URL the server fetches

`jwks_uri` is the first URL this server fetches with its own network
position. There is no precedent in the repository to follow, so the rules
are stated here rather than left to the implementer.

verified: `grep -rn "fetch(\|undici\|axios" --include="*.ts" packages apps`
→ one hit, `packages/protocol-oidc/src/view/authorize-html.ts:109`, which
is browser-side script inside a rendered page, 2026-09-18. The server makes
no outbound HTTP request today.

The hazard: an attacker-supplied URL fetched from inside the deployment's
perimeter reaches `169.254.169.254`, `localhost` and every internal
service.

- **`https` only.** No `http`, `file`, `data` or anything else. RFC 7591 §5
  already sets TLS as the bar for client-supplied URLs.
- **Resolve, check every resolved address, then connect to that address.**
  Validating a hostname and letting the HTTP client resolve again is a
  DNS-rebinding hole. Refused, for every address the name resolves to:
  loopback, link-local (`169.254.0.0/16`, `fe80::/10`), private
  (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`),
  unspecified, and multicast.
- **No redirect following.** A redirect is a second URL that never passed
  validation.
- **Bounded**: a connect timeout, a total timeout, a response-size cap, and
  a refusal of any media type that is not `application/json`.
- **Cached with a TTL, and a failure is not a permanent cache miss.** A key
  set that will not fetch fails the operation rather than being retried on
  every request.
- **One development escape hatch**, because the compose stack and the
  conformance stack both run on private addresses and could otherwise never
  register a client with a `jwks_uri`. It is refused under
  `NODE_ENV=production` by `apps/server/src/config-guard.ts`, which already
  performs exactly this refusal for `ODUDU_TLS`.

The address check is a pure function over a resolved address list, so it is
unit-testable with no network. The fetcher around it is the thin part.

## 7. Consent

### 7.1 The model

`consents (id, realm_id, subject_id, client_id, created_at, updated_at)`
with `UNIQUE (realm_id, subject_id, client_id)`, and `consent_scopes
(consent_id, client_scope_id, granted_at)`.

One row per subject-client pair with the granted scopes hanging off it, so
"a recorded grant it can be asked against again" is one lookup, and
revoking a single scope later is a row delete rather than a rewrite.

### 7.2 Where it sits

Consent is not an authenticator and does not belong in the flow tree. It is
a step in the `/authorize` continuation, after `advance` reports
authenticated **and** pending required actions are exhausted. That order is
deliberate: a subject who must change their password should do so before
being asked what to share.

### 7.3 The decision, in evaluation order

1. Resolve the requested scope against the client's `default` and
   `optional` assignments.
2. `prompt=consent` — ask, whatever the client's flag says and whatever is
   recorded.
3. If `consent_required` is false, continue.
4. Load the recorded grant; compute what is missing.
5. Nothing missing — continue with no page. This is what recording the grant
   buys.
6. Something missing and `prompt=none` — refuse. The refusal is §3.1.2.1's
   MUST ("an error is returned if the client lacks pre-configured consent
   for the requested claims"); naming it `consent_required` is §3.1.2.6's
   MAY. Both rows are in `docs/protocols/oidc-core.md`, now `deferred: P3a`.
7. Otherwise — ask.

**Why `prompt=consent` is evaluated before the per-client flag.** §3.1.2.1's
SHOULD is addressed to the authorization server and conditioned on the
request, not on how the client was registered. Ordering the flag first makes
the parameter silently inert for every seeded and token-registered client —
which is most of them — so the screen would work in testing against a
dynamically registered client and do nothing in production. A client that
does not otherwise require consent is still one whose relying party may ask
for a fresh decision.

`prompt=none` and `prompt=consent` together are refused with
`invalid_request` before any of this, by the `prompt` handling P1 already
built.

### 7.4 The page

`default` scopes are listed and not selectable: a client denied `openid`
cannot function, and pretending otherwise produces a flow that fails
confusingly later. `optional` scopes each carry a checkbox, pre-ticked
where already granted.

Allow records exactly the ticked set and writes the narrowed scope back
onto the authentication session, which already carries `scope`. Deny
redirects with `access_denied`.

A declined optional scope is simply absent from the issued token's `scope`,
which the client reads in the token response. RFC 6749 §3.3 permits it, and
it is already the shape the server produces: `resolveScope` narrows a
requested scope against the client's assignments and
`packages/protocol-oidc/src/usecase/token-issuance.ts:339` emits the result
as `scope`.

**CSRF adds nothing new.** The consent form carries the `auth_session_id`
hidden field, exactly as the login form does. The reasoning is already
written down at `packages/protocol-oidc/src/view/authorize-html.ts:130`: a
submission whose `auth_session_id` does not name a live authentication
session is refused, and that "CSRF-protects the whole endpoint rather than
any one authenticator".

### 7.5 Two gaps P3a will have

A subject cannot **revoke** a recorded consent; `prompt=consent` is the
only re-ask. That is the account console, **P4**.

RFC 7591 §5's "warning messages about dynamically registered clients" is
discharged by _asking_ rather than by a distinct warning banner. The
consent page shows the client's self-asserted name, which §5 warns may be
an impersonation. A banner, and the logo-domain heuristic §5 describes,
are **P4**.

Both become `deferred:` rows naming P4, not prose.

## 8. The page contract

### 8.1 The drift that already happened

`CLAUDE.md` states that every page leaves through `sendHtml`. That is
already false. `packages/account/src/view/verification-html.ts:14` defines
`sendVerificationHtml`, a second exit that hand-duplicates the policy — and
correctly explains why it must: `html-response.ts` is a protocol package's
internal, and no feature reaches into another's internals.

The two have diverged. `sendVerificationHtml` sets `referrer-policy:
no-referrer`; `sendHtml` does not. This is not a bug so much as a missing
home.

### 8.2 The contract

`sendHtml` cannot move to `kernel`: it takes a `FastifyReply`, and
`kernel`'s dependencies are `uuidv7` and `zod`, deliberately transport-free.

verified: `sed -n '/"dependencies"/,/}/p' packages/kernel/package.json`,
2026-09-18.

So the split follows that line. `kernel` gains a pure
`pageHeaders(page: RenderedPage): ReadonlyArray<readonly [string, string]>`
returning the **complete** header set: the CSP derived from the page's own
script declaration as `policyFor` does today, `x-frame-options: DENY`, and
`referrer-policy: no-referrer`. Each package keeps a two-line `send*` that
spreads those headers.

A test asserts that no `*-html.ts` and no route names
`content-security-policy`, `x-frame-options` or `referrer-policy` itself —
the enforcement shape `html-response.test.ts` already uses for the media
type.

**The criterion this corrects.** "A single exit" is the wrong promise,
because transport cannot live in `kernel`. The honest one is **a single
authority for a page's headers, enforced by a test**, which is what
actually prevents the drift in 8.1.

### 8.3 What a theme may replace

ADR 0030, decided here and delivered by P4b.

**A body fragment and a token set. Never the document.** The document is
where the CSP nonce, the framing defence and the `auth_session_id` live,
and P4b's criterion requires an **untrusted client** to supply styling. A
contract that lets a client replace the document is a contract that lets a
client replace the password field.

`RenderedPage` grows `body` and `title` alongside `html`. The renderers
return those; P4b substitutes a document shell around them without touching
a renderer.

**The retrofit is 26 functions, not seven pages.** `NEXT.md` and
`CLAUDE.md` both say "seven page renderers", which counted pages a user
navigates to rather than functions a contract must cover.

verified: `grep -rhn "^export function render" packages/*/src/view/*-html.ts | wc -l`
→ 26, across 10 files, 2026-09-18. Both documents are corrected in the
increment that does the retrofit.

## 9. The rate limit on `client_secret` at `/token`

ADR 0023 already specified this, which leaves nothing to design: "what that
clause asks for is a limit keyed by _client_. This throttle is not where
that goes."

So: a second `slidingWindow` instance from `apps/server/src/throttle.ts` —
the existing primitive, already bounded by `MAX_THROTTLE_KEYS` against the
memory-exhaustion vector that a caller-chosen key creates — keyed by
`realm:client_id` rather than by origin.

Three properties make it honest rather than decorative.

- **It counts failures only.** A healthy client is never throttled. The
  obvious objection — an attacker flooding failures to lock out a
  legitimate client — costs the attacker the ability to affect anyone but
  that one client, which is the trade the account lockout already makes for
  subjects.
- **It applies only to `client_secret_basic` and `client_secret_post`.**
  RFC 6749 §2.3.1's MUST is about password authentication, and
  `private_key_jwt` is not that.
- **An unknown `client_id` is refused identically to a wrong secret**, so
  the limiter does not become a client-existence oracle.

It inherits ADR 0023's stated limitation unchanged: in-process, therefore
per instance. `README.md` already documents that for the throttle beside
it, and says so for this one in the same passage.

## 10. Conformance

`infra/conformance/dynamic-op.json` and `run-dynamic-op.sh`, beside the two
plans that exist, with the result JSON committed under `results/` as the
others are.

The rig already solved the hard parts — a TLS-terminating proxy, a shared
docker network, `ODUDU_TLS` and `ODUDU_TRUST_PROXY` set so the session
cookie really has `Secure` semantics rather than claiming them. This is a
third plan, not a new harness.

## 11. Assumptions, and the spikes that settle them

Per `CLAUDE.md`'s P0 rule: a claim about third-party behaviour carries
either `verified:` or `assumption:`, and every `assumption:` on a
load-bearing path gets a spike **before** the task that depends on it.

The method for all three is the one `infra/conformance/README.md` already
models for the Config OP spike: read the suite's own Java source at
`release-v5.1.36` and quote the conditions, then reproduce against a
running stack.

**Spike 1 — does the Dynamic OP plan require metadata P3a deliberately
does not advertise?** **Answered 2026-09-18: it does not.** Five of the six
fields are untouched by any module the plan runs; the sixth,
`userinfo_signing_alg_values_supported`, is wrapped in
`.skipIfElementMissing` and so is skipped with INFO rather than failed.
`infra/conformance/README.md` has the quoted source. The original
`assumption:` was that Section 4.3 forbids
advertising `backchannel_logout_supported`,
`userinfo_signing_alg_values_supported`, `introspection_endpoint` and the
rest until P3b. If the plan demands them, the P3a/P3b seam is in the wrong
place. **This runs first, before any code**, because it is the only one
that can invalidate the phase split.

**Spike 2 — does the plan require RFC 7592 client configuration
management?** `assumption:` it does, since OpenID Connect Dynamic Client
Registration 1.0 describes `registration_access_token` and
`registration_client_uri`. This decides whether P3a builds RFC 7591 alone
or 7591 and 7592, which is a materially different size. Runs before the
registration endpoint's first task.

**Spike 3 — does the plan exercise `jwks_uri` rather than inline `jwks`?**
`assumption:` it does. If so, section 6 is on the critical path for the
exit criterion; if not, it can be sequenced later in the phase. Runs before
the plan's increment ordering is fixed.

## 12. Exit criterion

The OIDF Dynamic OP plan runs reproducibly with every divergence confirmed
as a recorded decision; dynamic client registration (RFC 7591)
behind a per-realm setting closed by default, with initial access tokens
and a per-realm client cap; the client metadata later clauses read —
`jwks` or `jwks_uri` with the boundary of section 6 stated and tested,
front- and back-channel logout URIs, audiences, a consent flag — registered
and validated but advertised nowhere in discovery; a consent screen a user
can refuse, with per-scope choice over `optional` scopes and a recorded
grant it can be asked against again; a rate limit on `client_secret`
attempts at `/token`, keyed by client; a single authority for a page's
headers, enforced by a test, with every renderer returning the contract
P4b will theme; cross-realm RLS probes green.

Estimate: 55–80 hours.

## 13. What P3a does not do

P3b, whose spec is written when P3a closes: concurrent sessions per browser
and `prompt=select_account`; "remember me"; front-channel and back-channel
logout **delivery**, back-channel through a queue and a command rather than
on the request path; token introspection (RFC 7662) scoped by audience and
revocation (RFC 7009); RFC 8707 `resource` indicators making `aud` derived,
single-valued, with the refresh token bound to the full original grant;
signed and encrypted UserInfo; `private_key_jwt` and proxy-header mTLS
client authentication.

Two P3b decisions were settled during this brainstorm and are recorded here
so P3b's spec inherits rather than reopens them.

**Introspection is scoped by audience.** RFC 7662 §2.1 requires
authorization "to prevent token scanning attacks", and anticipates a caller
who may authenticate yet may not learn about a given token: a query for "a
token the protected resource is not allowed to know about" is not an error,
and the AS "MUST instead respond with an introspection response with the
'active' field set to 'false'". Audience membership is the test, rather
than a per-client permission column, because such a column would be a
second source of truth for what `aud` already answers. The case it does not
cover — a gateway introspecting for several resources — is **P9**.

verified: `WebFetch https://www.rfc-editor.org/rfc/rfc7662.txt`, 2026-09-18.

**A single `resource` value, with the registered list as an allowlist.**
RFC 8707 §2 permits several and §3 discourages them: "using only a single
'resource' parameter is encouraged", because a multi-audience bearer token
"can be used by any one of those resources to access any of the others".
§2.2 sanctions the allowlist directly — the acceptable values are "at its
sole discretion based on local policy or configuration" — and §2.1 keeps
today's behaviour conformant when the parameter is omitted: the AS "MAY
process the request with no specific resource or by using a predefined
default resource value". §2.2 also fixes a rule none of the options
originally named: a narrowed request yields "an access token based on that
subset of requested resources, whereas any refresh token that is returned
is bound to the full original grant". Refusing multiple values is a
declined MAY and gets an ADR in P3b.

verified: `WebFetch https://www.rfc-editor.org/rfc/rfc8707.txt`, 2026-09-18.

**mTLS client authentication arrives as a proxy header**, read only when
`ODUDU_TRUST_PROXY` is set and the header name is explicitly configured;
unset means the method is unavailable and a client registering
`tls_client_auth` is refused. Odudu never terminates TLS, so forging that
header is exactly as bad as forging `X-Forwarded-For`, and the method
inherits the trust decision the server already makes rather than inventing
a second one. Certificate-bound tokens remain **P13**.

## 14. Index of verified claims

Every command in section 2 through 13 marked `verified:` was run on
2026-09-18. The third-party ones:

| Claim                                    | Command                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFC 7591 §2, §3.1, §5                    | `WebFetch https://www.rfc-editor.org/rfc/rfc7591.txt`                                                                                                                             |
| RFC 7662 §2.1, §4, §5                    | `WebFetch https://www.rfc-editor.org/rfc/rfc7662.txt`                                                                                                                             |
| RFC 8707 §2, §2.1, §2.2, §3              | `WebFetch https://www.rfc-editor.org/rfc/rfc8707.txt`                                                                                                                             |
| Keycloak anonymous registration defaults | `curl -sL https://raw.githubusercontent.com/keycloak/keycloak/main/services/src/main/java/org/keycloak/services/clientregistration/policy/DefaultClientRegistrationPolicies.java` |
| Keycloak consent policy description      | `WebFetch https://www.keycloak.org/securing-apps/client-registration`                                                                                                             |
