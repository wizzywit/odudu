# P4c — Admin API

**Date:** 2026-09-24
**Status:** Draft
**Umbrella:** `docs/superpowers/specs/2026-09-10-odudu-design.md`, section 11

## 1. What this phase is

The surface through which Odudu is administered over HTTP, and the end of
`psql` as a configuration door. A system tenant and a cross-tenant
permission, as section 5 of the umbrella spec has described since the
beginning and no code has ever had; capability roles; a tenant's settings,
SMTP, authentication flow and claim-mapper bindings; clients created,
amended and disabled; a subject's sessions listed and ended; signing keys
rotated on an overlap window; admin mutations audited; and OpenAPI
published, which forces ADR 0007 to be honoured or amended.

It is not the console. P4d drives this API and may expose no capability the
API does not have, which is P4d's own criterion and this phase's obligation
to it.

## 2. P4c became two phases

Brainstorming on 2026-09-24 added two things to the row as written: the
system tenant, which section 5 asserts exists and no migration creates, and
an audit tranche covering token issuance rather than admin writes alone.
Together they take the row from 95–125 hours to roughly 150–200 — past
P3b's 135–165, which section 11 already treats as the largest it tolerates
whole, and past the point where P2, P3 and P10 each split for less.

So **P4e** is created: authentication and token audit events, with its own
retention and volume answers. It lands before P4d, so the console has
events to show. The order becomes **P4a → P4c → P4e → P4d → P4b**.

P4c builds the `audit_events` table, carrying `event_type` and a nullable
actor from its first migration, so P4e adds rows rather than a schema. This
is deliberate: a table designed for one event kind and widened later is how
an audit log acquires two shapes.

### The citation rule still applies

A bare `P4` in prose means P4c unless it concerns token exchange, the grant
allowlist, theming or client branding — the rule the P4 split wrote, now
with one more phase behind it. `tests/docs/phase-references.test.ts`
resolves every phase citation in `README.md` and `docs/request-paths.md`
against section 11's rows, so adding a P4e row and rewriting P4c's is
checked there; `docs/NEXT.md` and the archived specs are not read by that
test and are grepped by hand.

## 3. Decisions

1. **Both authorities, now.** A tenant's own admins, and a system-tenant
   admin holding an explicit cross-tenant permission. Section 5's design
   delivered rather than deferred.
2. **One surface at `/admin`.** Tenant is a path parameter throughout;
   `iss` is validated against exactly two issuers.
3. **Bootstrap through the CLI**, with a single-use password and a forced
   change. Never an environment variable, never a network-reachable token.
4. **Capability roles**, seven per tenant plus one system-only, on a
   built-in admin client, riding the existing role tables.
5. **Capability re-resolved from the database per request**, never read
   from the token's role claim.
6. **ADR 0007 honoured for the admin API and amended in scope.** The
   protocol endpoints keep `parseStructure`, for reasons recorded rather
   than inherited (§9).
7. **`client.enabled` read at every door**, through one shared predicate.
8. **Clients are amendable by `PATCH`**; `seed client`'s refusal stands,
   and the difference is recorded rather than removed.
9. **Two-phase key rotation with signing selected by algorithm.**
10. **Opaque-cursor pagination**, `Link` headers, no totals.
11. **Audit written in the mutating transaction.**
12. **A standalone `docs/admin-paths.md`**, with one "What is not
    implemented" list and it stays in `docs/request-paths.md`.

## 4. Where the code lives, and the one layering exception

`packages/protocol-admin`, five layers, mounted by `apps/server/src/app.ts`
as `oidcRoutes` is.

This collides with a stated rule. `CLAUDE.md`: _"Protocol packages never
import each other."_ The admin API must read and write `client_oidc_config`
and `token_grants`, whose schemas live in `protocol-oidc` — redirect URIs,
grant types, logout URIs, UserInfo algorithms,
`token_exchange_impersonation_allowed`. Client management is not optional
here.

**One edge is permitted: `protocol-admin → protocol-oidc`**, recorded in an
ADR. The rule exists to stop two _peer_ protocol surfaces coupling — OIDC
and P8's SAML, which must be independently removable. The admin API is not
a peer; it administers the protocol surface and is downstream of it by
definition. The boundary suite encodes exactly that: this edge permitted,
`protocol-oidc → protocol-admin` forbidden, every other protocol-to-protocol
edge forbidden. A named exception with a test is honest; a rule quietly
broken is not.

**Rejected: moving `client_oidc_config` and `token_grants` into
`domain-tenant`.** Arguably where they belong — client metadata and grant
state are not wire format — but it is a schema-ownership refactor across
two packages and every test that touches them, inside the largest phase in
the project. If a later phase wants it, this exception is what it removes.

## 5. The system tenant

`odudu seed admin` creates a `system` tenant, structurally identical to every
other, `enabled = true`, no subjects, no signing key. The bootstrap command
mints the key, because the system tenant issues admin tokens and must
therefore be a working issuer.

Two authorities, one permission model:

- **Tenant-local admin** — a subject in tenant T holding capability roles
  on T's built-in admin client. Reaches `/admin/tenants/T/**` and nothing
  else.
- **System admin** — a subject in `system` holding `manage-tenants`.
  Reaches `/admin/tenants/*/**`, plus `/admin/tenants` itself.

Capabilities are client-scoped roles on a built-in admin client provisioned
per tenant: `view-users`, `manage-users`, `manage-clients`, `manage-tenant`,
`manage-keys`, `manage-sessions`, `view-audit`, with a `tenant-admin`
composite holding all seven. `manage-tenants` exists only in the system
tenant. Each `manage-` role composes its `view-` counterpart, so granting
`manage-users` never needs `view-users` beside it. All of this uses `roles`,
`role_composites` and `subject_roles` unchanged.

**The built-in admin client's amendable fields are restricted too.** Blocking
`enabled: false` and `DELETE` is not enough: a `PATCH` replacing its
`grant_types` can remove the grant admin tokens are issued through and lock
every administrator out while the client stays enabled — the same lockout
through a second door, which is the defect `docs/phases/p3b.md` names as this
repository's recurring one. On the built-in client, `grant_types`,
`token_endpoint_auth_method` and `redirect_uris` are refused with 409; the
rest of the 25 amendable fields behave normally. Added after review on
2026-09-24.

**The built-in admin client is neither disablable nor deletable** — 409 with
the reason named. That is the guard against total lockout, and §11 explains
why it is needed.

## 6. Bootstrap

`odudu seed admin --username <name>`, requiring database access and
therefore never network-reachable:

1. Ensure the `system` tenant has a signing key and a built-in admin client.
2. Create a user subject; assign `tenant-admin` and `manage-tenants`.
3. Generate a password, print it once, and write an `update-password` row to
   `user_required_actions` — migration 0036's table, already driven by the
   login flow, so the generated password is single-use by construction.

Re-running against an existing username fails rather than resetting the
password, matching `seed client`'s refusal and for the same reason.

## 7. Authenticating an admin request

A bearer access token. Every step fails closed, in order:

1. Verify the JWT against the issuing tenant's JWKS. `iss` must be the
   target tenant's issuer or the system tenant's, both resolved through
   `tenantIssuerFor` — the same helper `/token` mints `iss` with and
   `/userinfo` verifies against, so there is one authority for the string
   rather than two. Amended after review on 2026-09-24: this originally said
   the issuers were "never derived from the request", and a configured base
   was built to honour that. It refused every genuine token on any deployment
   not served at the fixture's own authority, and the guard guarded nothing —
   a forged `Host` yields an issuer matching neither candidate, and
   verification runs against the matched issuer tenant's keys regardless. One
   configured issuer base for the whole deployment is the better long-term
   answer and is deferred, since it would change how `iss` is minted on every
   token, ID token, Logout Token, the RFC 9207 parameter and discovery.
2. `aud` must name the admin API's resource identifier,
   `urn:odudu:params:admin-api`. Without this check, a token minted for any
   other audience would still face steps 3 through 6 — the grant, the
   client, and the route's capability — but the audience check is what
   stops it from ever reaching them. Amended after review on 2026-09-24:
   this originally said `${iss}/admin`, which cannot be registered in the
   built-in admin client's audiences when that client is provisioned,
   because issuers are resolved from the request. A fixed URN is
   registrable, and replay across tenants is still closed by `iss` and by
   verification against the matched issuer tenant's keys.
3. The token's grant is live and its session alive — the pair `/userinfo`
   and `/introspect` already check.
4. The token's client is enabled (§10's rule, applied here too, which is what
   makes it one door rather than several).
5. Capability re-resolved through `resolveRoleReach`. Revoking a role takes
   effect on the next request.
6. If `iss` is the system tenant and the target is another tenant,
   `manage-tenants` is required _in addition_ to the route's capability.

### What this costs, said plainly

After step 6, the transaction issues `SET LOCAL app.tenant_id = <target>`.
RLS then behaves exactly as on every other request path and every repository
is reused unchanged — but **for a cross-tenant request RLS is no longer the
second independent defence**. It is scoped to the tenant the caller asked
for, so step 6 is the only thing between a system admin and another tenant's
data.

That is inherent to cross-tenant administration, not a shortcut. The
alternative — a second GUC and a rewrite of all 31 policies — gives every
table a second door, which is worse. The mitigations: the target tenant is
resolved once from the path before any query; it is written into the audit
row; and the RLS probes prove a _tenant-local_ admin cannot reach another
tenant even with a forged path.

## 8. The resource surface

`{t}` is the target tenant.

| Path                                              | Methods                  | Capability                    |
| ------------------------------------------------- | ------------------------ | ----------------------------- |
| `/admin/tenants`                                  | `GET`, `POST`            | `manage-tenants`              |
| `/admin/tenants/{t}`                              | `GET`, `PATCH`           | `manage-tenant`               |
| `/admin/tenants/{t}/settings`                     | `GET`, `PATCH`           | `manage-tenant`               |
| `/admin/tenants/{t}/smtp`                         | `GET`, `PUT`, `DELETE`   | `manage-tenant`               |
| `/admin/tenants/{t}/smtp/test`                    | `POST`                   | `manage-tenant`               |
| `/admin/tenants/{t}/clients`                      | `GET`, `POST`            | `manage-clients`              |
| `/admin/tenants/{t}/clients/{id}`                 | `GET`, `PATCH`, `DELETE` | `manage-clients`              |
| `/admin/tenants/{t}/clients/{id}/secret`          | `POST`                   | `manage-clients`              |
| `/admin/tenants/{t}/subjects`                     | `GET`, `POST`            | `view-users` / `manage-users` |
| `/admin/tenants/{t}/subjects/{id}`                | `GET`, `PATCH`, `DELETE` | `view-users` / `manage-users` |
| `…/subjects/{id}/credentials`                     | `GET`, `DELETE`          | `manage-users`                |
| `…/subjects/{id}/required-actions`                | `GET`, `PUT`             | `manage-users`                |
| `…/subjects/{id}/roles`                           | `GET`, `PUT`             | `manage-users`                |
| `…/subjects/{id}/sessions`                        | `GET`                    | `manage-sessions`             |
| `…/subjects/{id}/sessions/{sid}`                  | `DELETE`                 | `manage-sessions`             |
| `/admin/tenants/{t}/roles`, `/groups`, `/scopes`  | CRUD                     | `manage-tenant`               |
| `/admin/tenants/{t}/scopes/{id}/mappers`          | `GET`, `PUT`             | `manage-tenant`               |
| `/admin/tenants/{t}/flow/executions`              | `GET`, `PUT`             | `manage-tenant`               |
| `/admin/tenants/{t}/keys`                         | `GET`, `POST`            | `manage-keys`                 |
| `/admin/tenants/{t}/keys/{id}/promote`, `/retire` | `POST`                   | `manage-keys`                 |
| `/admin/tenants/{t}/audit`                        | `GET`                    | `view-audit`                  |

**A caller may never assign authority it does not hold.** `PUT
…/subjects/{id}/roles` runs under `manage-users`, and without a ceiling that
caller could assign `tenant-admin` — or, in the system tenant,
`manage-tenants` — to any subject including itself, which is privilege
escalation by design (CWE-269). So the write expands the requested role set
through `role_composites` to its **effective capabilities**, expands the
caller's the same way, and refuses with 403 when the requested set is not a
subset of the caller's. The same ceiling governs `POST /roles/{id}/composites`,
which could otherwise smuggle a capability into a role the caller may already
assign. Added after review on 2026-09-24; the original named no ceiling.

**Credentials are readable as metadata only** — type, created-at, whether a
password is expired, how many recovery codes remain. Never the secret, never
the hash. `DELETE` removes a lost TOTP enrolment.

**There is no endpoint that sets a user's password.** An admin writes an
`update-password` required action instead, so no operator ever handles a
user's password. That matches the bootstrap command and keeps the
prohibition uniform across the product.

## 9. The wire contract

### Pagination

`?limit=` (default 50, coerced down to a 200 maximum, never rejected) and
`?cursor=`. Keyset over UUIDv7 `id` underneath — section 5 already makes it
time-ordered by construction, so no sort column is added.

The cursor is **opaque on the wire**: base64url over an HMAC-tagged payload
carrying the sort key, the collection and the tenant. The tag is verified on
the way in, so a cursor cannot be forged, hand-written or replayed against a
different collection. That makes "do not parse this" an enforced property
rather than a request.

Next page arrives as `Link: <…>; rel="next"` _and_ as `next` in the body;
absence of both means end of list. No totals, anywhere.

This shape was chosen against four comparable APIs rather than from habit;
§18 records what each does and what it changed here.

### Errors

RFC 9457 Problem Details, `application/problem+json`, with `type`, `title`,
`status`, `detail`, and `instance` set to the request id. The protocol
endpoints keep RFC 6749's `{"error": …}` because their specifications
require it. Two error shapes, each correct for its surface.

### Concurrency

Every single-resource `GET` returns an `ETag` over the row's state. `PATCH`
and `PUT` accept `If-Match` and answer `412` on mismatch.

**Optional in general, required for an authorization-bearing list.** A
simple client editing a display name should not need a read first. But a
`PATCH` that changes `redirect_uris`, `post_logout_redirect_uris`,
`web_origins`, `audiences` or `grant_types` is **refused with `428
Precondition Required`** when `If-Match` is absent. Those five are
allowlists: last-write-wins on one silently discards another admin's
narrowing, and §11 replaces them whole rather than merging, so a stale
`PATCH` reinstates exactly what someone just removed. Amended after review
on 2026-09-24 — the original made the precondition optional everywhere and
then relied on it for safety.

### Contracts, and ADR 0007

Zod in `packages/contracts/admin/` — a subpath, not `index.ts`, because
under the amendment the package stops being "the schemas" and becomes "the
schemas for surfaces that have one". Compiled by `z.toJSONSchema()` for ajv
boundary validation and for OpenAPI 3.1 at `/admin/openapi.json`. A test
asserts every route in the Fastify tree appears in the document and every
documented path exists, so an endpoint cannot ship undocumented.

**ADR 0007 is amended by appending**, not rewritten. The amendment records
three things:

- It governs **JSON endpoints**. The admin API is its first execution.
- The **form-encoded protocol endpoints keep `parseStructure`**, for two
  reasons that are real rather than historical: their 400 body is
  RFC-defined and ajv's is not, and at `/authorize` a check's position in
  the sequence is what makes it safe — boundary validation that rejects
  every structurally invalid request up front collapses the
  render-versus-redirect distinction for a missing `redirect_uri`. That
  reasoning already existed, as a comment on `authorize.ts`.
- `authorizeQuerySchema` and `AuthorizeQuery` are **deleted**, with
  `tokenRequestSchema`'s deletion in `2e1e0e4` as precedent. They are unused
  (§18), and stale in the same way: no `response_mode`, no `resource`, no
  `claims`, all three of which `/authorize` has accepted since P3b. The
  comment keeping them claimed consumers that do not exist; its true half —
  the order-dependence above — moves into the amendment, where it is
  reasoning rather than a note on a dead file.

`packages/contracts` today contains **no executed Zod at all**: a discovery
builder, an auth-method list, and that one dead schema. The admin schemas
are the first Zod in this repository that anything runs at a boundary.

## 10. `client.enabled`, at every door

Five call sites gain the check: `resolveUserinfo`, `introspect`, and
`resolveExchangeToken`'s access-token, refresh-token and id_token branches.

As **one shared predicate**, not five inline reads. Five inline reads is how
the blind spot arose; `docs/phases/p3b.md` names "a rule applied at one door
out of several" as this repository's recurring defect. The predicate is what
is tested; each call site's test proves it is wired.

Reading `client.enabled` was chosen over revoking a disabled client's
grants. It is reversible — re-enabling restores access without forcing
re-authentication — and it reaches the id_token exchange branch, which names
no grant at all (`resolveIdToken` returns `grantId: null`) and which
revocation therefore cannot touch.

This changes documented behaviour, so `docs/request-paths.md`'s `/userinfo`,
`/introspect` and token-exchange transcripts are **re-run against a live
stack**, not edited. A transcript changed by reasoning rather than execution
is the silent downgrade back to a claim.

## 11. Clients: amendment, and the asymmetry resolved

`PATCH` amends. `seed client`'s refusal stands, and the spec records why
they differ rather than pretending they do not: the refusal guards against a
_re-run of a seed script_ silently widening an allowlist, which is a
property of re-runnable scripts. A deliberate `PATCH` carrying `If-Match` is
not that. `seed tenant --set` and `PATCH /settings` share
`tenant-settings.ts`'s name-to-column map and coercion, which is why it was
put there rather than in the CLI.

**Amendable, 25 fields.** From `clients`: `name`, `enabled`,
`full_scope_allowed`. From `client_oidc_config`, all 22. That is the whole
of what `docs/NEXT.md` lists as settable at creation by one door and by
`psql` otherwise — the five P3b columns and P4a's
`token_exchange_impersonation_allowed` included. All six stop needing
`psql`.

**Refused, each for a stated reason.** `id`, `tenant_id` and `client_id` are
identity: changing `client_id` breaks every relying party and orphans the
`azp` of every token already issued. `created_at` is history.
`registration_origin` is provenance, and rewriting it falsifies a record.
`service_subject_id` re-points role assignments and needs its own operation.
`secret_hash` is never written directly — `POST /clients/{id}/secret`
rotates and returns the new secret once, the same rule as §8's refusal to
set a password. And `type` is refused in both directions: flipping to
`public` strands a secret relying parties still send, flipping to
`confidential` leaves a client with no secret to authenticate with.

**Three properties the amend path must hold:**

- **Lists are replaced whole, never appended to** — redirect URIs,
  post-logout URIs, web origins, audiences, grant types. Widening is always
  an explicit statement of the new list.
- **`grant_types` is load-bearing.** P4a made `config.grantTypes` gate every
  grant, not only refresh issuance, so a `PATCH` changes what a client may
  do at `/token`. Whole-list replacement, `If-Match` and an audited
  before/after exist for exactly this case.
- **Every value runs through `parseClientMetadata`**, the validator dynamic
  registration uses — the `jwks`/`jwks_uri` exclusion, RFC 8252's redirect
  rules, the blank-`subject_dn` rejection. The admin door cannot accept what
  registration would refuse.

`userinfo_signed_response_alg` validates against every non-retired key's
algorithm, not only the active one. That is §12's rule from the other side,
and it is what lets a client move algorithm during the overlap window.

### Disabling, and the lockout it can cause

An admin request is itself a bearer token minted by some client, and §7 step
4 applies the same `client.enabled` rule to it. So disabling can lock out
the admin who did it — legitimately for an ordinary client, and for an
admin-capable client whose service account holds roles. Disabling a
tenant's **built-in admin client** would lock out every tenant-local admin
at once, and the system tenant's would lock out everyone with no recovery
short of `psql`.

Hence §5's guard: **the built-in admin client is neither disablable nor
deletable**, 409 naming the reason. Every other client may be disabled,
because the built-in one is always above it as recovery.

## 12. Signing-key rotation

`signingKeyRepository` already reads `ne(status, 'retired')` for JWKS, so
the overlap window is published today; only rotation has no door.

- `POST /keys` — generate, store as **`rotating`**, published in JWKS at
  once. `signing_keys_one_active` is untouched: it constrains `active`.
- `POST /keys/{id}/promote` — demote the current `active` to `rotating` and
  promote this one, in one transaction, so no window has two actives or
  none.
- `POST /keys/{id}/retire` — **refused with 409** in two cases: while a
  client is registered against an algorithm no remaining non-retired key
  produces, listing the offending clients; and whenever the key's own status
  is `active`. Promotion must come first. Checking algorithm coverage alone
  would permit retiring the sole active key whenever a `rotating` key shared
  its algorithm, leaving the tenant with no active key at all and the
  selection rule's fallback pointing at nothing. Amended after review on
  2026-09-24.
- `GET /keys` — status, `kid`, `alg`, `created_at`, `not_after`. Never the
  private half, encrypted or otherwise.

The deadlock the row names — registration refuses an algorithm the active
key cannot produce, so clients cannot move first, and rotating first strands
them — dissolves through one change: **signing selects a non-retired key
whose `alg` matches what the request requires, falling back to `active`.**
`active` stops meaning "the only key that can sign" and starts meaning "the
default when nothing specifies". Discovery advertises the algorithms of
every non-retired key; registration accepts any of them. Stranding becomes
unreachable rather than merely detected.

The crypto suite's injectable clock drives the overlap: a test advances past
`not_after` and asserts JWKS still publishes a `rotating` key until
retirement is explicit, because section 5's rule is that retiring early
breaks every relying party at once.

## 13. A tenant's authentication flow

`GET /flow/executions` returns the ordered list. `PUT` replaces it wholesale
— validated for at least one execution, every `authenticator` resolvable
against the executor's registry, indices renumbered contiguously by the
server. Partial edits are not offered: a flow's meaning is in its order, and
a flow is short.

**`required` and `conditional` are made to differ.** They do not today:
`groupSteps` groups only `alternative`, so both fall to the `single` branch,
and `isGroupSatisfied` passes a `single` group whose only member is
inapplicable — which is `conditional`'s semantics, applied to both.

- **`conditional`** — must be satisfied _when applicable_; inapplicable
  passes. Today's behaviour.
- **`required`** — must be satisfied; a subject for whom it is inapplicable
  **fails the flow**.

That is a behaviour change on a login path, so the migration rewrites
**every** row whose requirement is `required` and whose authenticator is
subject-dependent — OTP, passkey and recovery code — to `conditional`, not
only the rows the seeded flow created. Nothing can customise a flow today
(`executionRepository` exposes `forTenant` and `create` and nothing else)
and nothing is deployed, so in practice the two sets are identical; matching
on the condition rather than on provenance costs nothing and is what keeps a
hand-written row from becoming a silent lockout. A test asserts a default
tenant's flow behaves identically before and after. Amended after review on
2026-09-24 — the original rewrote seeded rows only.

## 14. Claim mappers a scope reaches

The registry stays code-defined: `standardClaimMappers()` remains the
catalogue of mapper _types_, and a mapper still declares the scopes it
reads. What becomes per-tenant is the **binding** — a `client_scope_mappers`
table saying which registered mapper this tenant attaches to which client
scope.

`assemble` consults the tenant's bindings; a tenant with no bindings falls
back to the mappers' declared scopes. **The fallback is per scope, not per
tenant**: a scope with no binding rows uses the mappers that declare it,
whatever other scopes in the same tenant have been bound. A per-tenant
fallback would mean the first binding written for one scope silently
stripped the defaults from every other scope in that tenant — one edit,
unrelated claims gone. Every existing tenant therefore behaves exactly as it
does now and the migration backfills nothing. Amended after review on
2026-09-24.
`claims_supported` in discovery derives from the tenant's bindings rather
than from the process singleton, which is what makes the document genuinely
per-tenant.

`client-scopes.ts`'s comment — that the scope record _"deliberately carries
no list of claim mappers: a mapper declares the scopes it reads… not the
other way around"_ — stops being the whole truth. The mapper still declares;
a tenant may now override. The comment is amended in the same commit,
because a comment whose stated reason has quietly expired is this
repository's most frequent defect.

## 15. Per-tenant SMTP

A `tenant_smtp` row: host, port, from, username, `password_encrypted`,
starttls. The credential goes behind **the same key-encryption interface as
a signing key**, which means generalising `crypto/src/service/kek.ts` into a
`wrapSecret`/`unwrapSecret` pair, with `wrapPrivateJwk`/`unwrapPrivateJwk`
becoming thin typed wrappers over it. One authority for encryption at rest,
which is what "the same interface" has to mean to be worth saying.

Resolution order when sending: the tenant's row, else the `ODUDU_SMTP_*`
sender, else the capturing adapter. ADR 0015 is unaffected — it governs
where a _deployment's_ credentials live, and this adds a per-tenant
credential the deployment does not hold.

`GET /smtp` never returns the password, only whether one is set.
`POST /smtp/test` sends one message to a supplied address: without it an
operator discovers a bad configuration only when a user's verification mail
silently fails.

## 16. A subject's sessions

`GET /subjects/{id}/sessions` is the first read of sessions by subject
rather than by cookie. It adds `sessionRepository.liveBySubject`, measuring
each session against its own lifespan pair as `liveByIds` does — and because
it reads by subject, **it sees ADR 0033's orphans**: sessions a browser's
cookie no longer names, including a remembered one idling for seven days.
That is the operator's only reach for that case, which is why the roadmap
places it here.

`DELETE /subjects/{id}/sessions/{sid}` reuses P3b's machinery unchanged:
revoke the session's grants, enqueue a back-channel Logout Token for every
registered client. Front-channel cannot apply — there is no browser to
render frames in — and the response says so rather than implying a
completeness it lacks.

## 17. Audit — the admin tranche

An `audit_events` table: `occurred_at`, `tenant_id` (the **target**),
`actor_tenant_id`, `actor_subject_id`, `actor_client_id`, `event_type`,
`action`, `resource_type`, `resource_id`, `outcome`, `request_id`, `ip`,
`detail` (jsonb). RLS on `tenant_id`, so a tenant-local admin reads only
their own tenant's events even when a system admin made the change.

Three properties fixed now rather than discovered later:

1. **The audit row is written in the mutating transaction.** A rolled-back
   write leaves no row; a committed one always has exactly one. An audit log
   that can disagree with the database is worse than none.
2. **`detail` is an allowlisted before/after diff**, never the raw body. No
   secrets, no password hashes, no private keys. The allowlist is per
   resource type and is the thing tested.
3. **`event_type` and a nullable actor exist from the first migration**, so
   P4e's events are rows rather than a schema change.

Retention: `audit_events` joins `REAP_ORDER` with its own rule and a tenant
setting, so the highest-growth table in the schema is bounded before P4e
multiplies its volume. `GET /audit` takes §9's cursor plus filters on actor,
resource type, action, outcome and a time range.

## 18. Index of verified claims

Every claim below was produced by running the command, not by reading
documentation — the P0 rule — and every claim about this repository was
grepped before being written, which is the P2b rule.

| Claim                                                                | Command                                                                                                                                                                                |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `authorizeQuerySchema`/`AuthorizeQuery` have no consumer             | `grep -rn "authorizeQuerySchema\|AuthorizeQuery" --include=*.ts .` → its own file, its own test, the index re-export                                                                   |
| `@odudu/contracts` has exactly three external importers              | `grep -rn "from '@odudu/contracts'" packages apps` → `discovery.ts`, `authorize-validation.test.ts`, `client-oidc-config.ts`                                                           |
| The token schemas were deleted as dead code, not rejected            | `git show 2e1e0e4`                                                                                                                                                                     |
| `authorizeQuerySchema` lacks `response_mode`, `resource`, `claims`   | `head -30 packages/contracts/src/authorize.ts`                                                                                                                                         |
| `clients.enabled` exists and is read in six places                   | `grep -rn "\.enabled\b" packages/protocol-oidc/src packages/domain-tenant/src`                                                                                                         |
| Neither `/userinfo` nor `/introspect` reads it                       | same grep; absent from `usecase/userinfo.ts` and `view/routes/introspect.ts` beyond the tenant check                                                                                   |
| Ending a session is an `UPDATE`, never a `DELETE`                    | `packages/authn-flows/src/repository/sessions.ts:71`                                                                                                                                   |
| Nothing deletes a subject today                                      | `subjects` absent from `REAP_ORDER`, `apps/server/src/cli/reap.ts:338`                                                                                                                 |
| JWKS already publishes non-retired keys                              | `packages/crypto/src/repository/signing-keys.ts:47`                                                                                                                                    |
| `conditional` and `required` are indistinguishable                   | `packages/authn-flows/src/service/requirements.ts`, `groupSteps` groups only `alternative`                                                                                             |
| `executionRepository` has `forTenant` and `create` and nothing else  | `cat packages/authn-flows/src/repository/executions.ts`                                                                                                                                |
| No audit table or module exists                                      | `grep -rln audit packages apps` → one SQL comment in `0051`, one in `app.ts`                                                                                                           |
| No `system` tenant exists                                            | `grep -rn "'system'" packages apps --include=*.ts --include=*.sql`                                                                                                                     |
| No RFC 7592 endpoint exists                                          | `grep -rn "7592\|registration_access_token" packages` → only the refusal list in `client-metadata.ts:94`                                                                               |
| `client_oidc_config` carries 22 amendable columns                    | `grep -E "^\s+\w+:" packages/protocol-oidc/src/schema/client-oidc-config.ts`                                                                                                           |
| `tenant-settings.ts` holds 28 settings with coercion                 | `cat packages/domain-tenant/src/service/tenant-settings.ts`                                                                                                                            |
| `loadDocument` takes a path, so a second document costs one argument | `tests/docs/markdown.ts:11`                                                                                                                                                            |
| `docs/request-paths.md` is 8,171 lines across 20 sections            | `wc -l`, `grep -n "^## "`                                                                                                                                                              |
| `z.toJSONSchema` emits draft 2020-12 under Zod 4.6.1                 | `node --input-type=module -e "import {z} from 'zod'; console.log(JSON.stringify(z.toJSONSchema(z.object({a:z.string()}))))"` → `$schema: https://json-schema.org/draft/2020-12/schema` |

### Pagination, checked against four comparable APIs

| API                 | Shape                                                                                                                                                                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keycloak Admin REST | `first`/`max` offset, `max` default 100; its own design guideline adds an RFC 5988 `Link` header with `next`/`prev` and **declines totals** to avoid computing counts, putting counts on separate `/count` endpoints                                                       |
| Okta                | `limit` + `after`, next page via `Link: rel="next"`; documentation says explicitly **do not construct the URL yourself**, cursor formats change without notice                                                                                                             |
| Auth0               | Both; offset suits collections "unlikely to exceed 1,000 items", and checkpoint pagination is "recommended for its greater efficiency and stability with large datasets" where both exist                                                                                  |
| Google AIP-158      | `page_size` + `page_token` → `next_page_token`; tokens "must be opaque… must not be user-parseable", base64 over a transparent token called out as insufficient; an over-large `page_size` is **coerced down**, not rejected; `total_size` optional and may be an estimate |

Offset-versus-cursor is not standardized. What is consistent is direction:
every offset API above has since added or now recommends a cursor. Three
things this changed in the design — an opaque tagged cursor rather than a
bare UUID, a `Link` header beside the body member, and a coerced rather than
rejected `limit`.

## 19. Assumptions, and the spikes that settle them

Each is on a load-bearing path and gets a short spike **before** the task
that depends on it.

1. **`assumption:` Fastify 5.12.3 can validate a draft-2020-12 schema.**
   ajv 8.20.0 is present, but ajv 8's default export is draft-07; 2020-12
   requires `ajv/dist/2020` wired as a custom validator compiler. If it
   cannot be wired cleanly, the fallback is to emit `target: 'draft-7'` from
   `z.toJSONSchema` for ajv and 2020-12 for the OpenAPI document — two
   compilations of one authored schema, which still honours ADR 0007.
2. **`assumption:` Fastify's error serializer can emit
   `application/problem+json` without disturbing the OIDC routes' RFC 6749
   bodies**, given both trees are mounted on one instance.
3. **`assumption:` `SET LOCAL app.tenant_id` to a tenant other than the
   caller's behaves identically to the ordinary path**, including inside the
   transaction that also writes the audit row. Adjacent risk: resolving
   `{tenant}` from the path needs the owner connection, as `AppDeps`
   already records for the OIDC routes.
4. **`assumption:` a `rotating` key can sign** — the signing path currently
   reaches for `active()`, and §12 changes the selection rule. The spike
   confirms nothing else assumes `active`.
5. **`assumption:` an HMAC key for the cursor can be derived from
   `ODUDU_KEK`** without widening what the KEK is used for in a way ADR 0015
   or the crypto package objects to.

## 20. Testing

Test-driven throughout; integration against real PostgreSQL via
Testcontainers, never a mock.

- **Every repository method probed with a foreign `tenant_id`** — the
  standing rule, carrying more weight here because §7 gives away RLS as the
  second defence for cross-tenant requests.
- **Cross-tenant RLS probes**, the phase's own criterion: a tenant-local
  admin of T, with a valid token and every capability, refused at
  `/admin/tenants/U/**` — by the authorization check, and again by RLS if
  the check were bypassed. Proven separately, or the second is a claim.
- **A capability matrix**: for every route, a caller holding each capability
  and no other, asserting one grid of allow and deny. This is what makes
  P4d's "no capability in the UI the API does not expose" checkable, and
  what stops a route shipping with the wrong role by copy-paste.
- **OpenAPI coverage**: every route in the Fastify tree appears in the
  document, and every documented path exists.
- **Boundary suite**: the single permitted `protocol-admin → protocol-oidc`
  edge, with the reverse and every other protocol-to-protocol edge failing.
- Flow evaluation and rotation stay unit-testable — `nextStep` takes steps
  and state, rotation drives the crypto suite's injectable clock. No suite
  sleeps.

## 21. Documentation

**`docs/admin-paths.md`**, new, under three rules:

1. **One "What is not implemented" list, and it stays in
   `docs/request-paths.md`.** Splitting it is the aggregate-invisibility
   failure `CLAUDE.md` records — six passages each honestly admitting a gap
   and each pointing at another. `tests/docs/not-implemented-placement.test.ts`
   keeps one target.
2. **`tests/docs/` is extended, not duplicated.** `loadDocument` already
   takes the path; a second document costs one argument per check.
3. **Mutual pointers**, so a reader who starts in the wrong file is
   redirected in one hop.

Same transcript discipline: no language tag on a response block, the stack
named where output depends on prior state, a precondition shown rather than
asserted.

Three artifacts, three jobs, stated in the documents so they cannot drift
into competing: **OpenAPI is the reference**, generated; **`admin-paths.md`
is the narrative**, executed operator journeys with real output;
**`README.md` is the entry point**.

`docs/request-paths.md` changes in four places: the `/userinfo`,
`/introspect` and token-exchange transcripts re-run for §10; every "reach
for `psql`" passage this API obsoletes rewritten to name the endpoint,
including the aggregate under "Any admin API"; the "What is not implemented"
list reconciled in both directions; the new pointer added.

`README.md` gains `odudu seed admin` and the admin API's existence. It is
also the file `CLAUDE.md` singles out as most likely to be left asserting
something that stopped being true, so its claims about what cannot be
configured are grepped rather than assumed.

## 22. ADRs this phase writes

| ADR  | Subject                                                                                                                                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| new  | `protocol-admin` may import `protocol-oidc`; no other protocol-to-protocol edge (§4)                                                           |
| 0007 | **Amended by appending**: scope limited to JSON endpoints, the protocol endpoints' two reasons recorded, the dead schemas' deletion noted (§9) |
| new  | Whether `/userinfo`'s `claims` narrowing is the right reading of OIDC Core §5.5 (§24)                                                          |

## 23. Exit criterion

A system tenant created and bootstrapped by
`odudu seed admin` with a single-use password and a forced change; an admin
API at `/admin` serving both a tenant's own admins and a system admin
holding `manage-tenants`, with capability re-resolved per request and proven
by a capability matrix over every route; a tenant's settings, SMTP
(credential behind the same key-encryption interface as a signing key),
authentication flow with `required` and `conditional` made to differ without
changing an existing tenant's behaviour, and claim-mapper bindings feeding a
per-tenant discovery document, all manageable without `psql`; clients
created, amended and disabled, with `client.enabled` read by `/userinfo`,
`/introspect` and all three exchange branches through one shared predicate
and the affected transcripts re-run; a subject's sessions listed by subject
— orphans included — and ended individually; two-phase key rotation with
signing selected by algorithm, so an algorithm change strands nobody and
retirement is refused while it would; a service account provisioning users
under `manage-users` alone; opaque-cursor pagination with `Link` headers and
no totals; admin mutations audited in the mutating transaction, with a
redacted diff and retention through `reap`; OpenAPI published under an
amended ADR 0007, proven to cover every route; `docs/admin-paths.md` with
every transcript executed; cross-tenant RLS probes green.

Roughly **110–140 hours**, twelve to sixteen increments. A draft pull
request opens with the first push; each increment ends CI-green with the
review that push attracted answered.

## 24. What this phase does not do

Every item names a phase, a decision or an ADR — the rule `CLAUDE.md`
applies to `docs/request-paths.md`, applied here too.

- **Authentication and token audit events — P4e**, this split's own phase,
  landing before P4d. The table, `event_type` and the nullable actor are
  built here for it.
- **Tenant import and export — P4d**, unchanged.
- **RFC 7592's client configuration endpoint — P13.** P13's criterion is
  already the collection point for deferred protocol RFCs nobody else owns —
  the deferred grants, `private_key_jwt` and `tls_client_auth` at
  `/introspect` and `/revoke`, RFC 7523's missing clause table — and RFC
  7592's authority is a `registration_access_token`, a client-authentication
  mechanism, which is P13's subject. At roughly 15–20 hours it is smaller
  than anything section 11 has ever carried as a phase of its own.
- **A per-audience scope model, and `/introspect`'s "may introspect"
  capability — P9.** `docs/NEXT.md` places the first with client management
  and P4c is declining it; both are the same missing abstraction, a resource
  server as a first-class thing owning scopes and authorized to introspect,
  which is what P9's UMA 2.0 and policy evaluation build. Named together, so
  half the model is not built twice.
- **`private_key_jwt` and mTLS at `/introspect` and `/revoke` — P13**,
  unchanged.
- **`requested_userinfo_claims` lost on refresh — an ADR, written here.**
  OIDC Core §5.5 describes `claims` as requesting Claims _alongside_ scope,
  and narrowing is a stricter reading this implementation chose without
  writing it down. P4c is already reopening `/userinfo`, so the reasoning is
  in front of whoever is there. The ADR decides; if narrowing is kept,
  threading the claim onto the rotated grant is P4e's, named in its
  criterion.
- **`MAX_DELEGATION_DEPTH` and `may_act` persistence — P5**, unchanged.
- **`token_grants_session_fk`'s unrestricted `ON DELETE SET NULL`** keeps
  its existing trigger: a migration touching `token_grants`, of which this
  phase has none. Ending a session is an `UPDATE`, so §16 does not fire it
  either. Stated so the omission does not read as an oversight.
- **`client_oidc_config`'s blank-`subject_dn` CHECK** keeps its trigger for
  the same reason — no migration here touches that table.

### Riders this phase does pick up

- **`clients_service_subject_fk`'s unrestricted `ON DELETE SET NULL`**, and
  it is no longer cosmetic. Nothing deletes a subject today. §8's
  `DELETE /subjects/{id}` makes it reachable over HTTP for the first time,
  so deleting a service subject would fail `clients`'s `NOT NULL` rather
  than detach the client. Fixed to `ON DELETE SET NULL (service_subject_id)`,
  with a test that deletes a service subject a client references.
- **`session-cookie.ts`'s hand-rolled case-sensitive UUID regex** →
  `@odudu/kernel`'s `isUuid`. §16 is the first read of a session outside
  that cookie, which is its trigger.
- **`pendingSession`'s duplicated liveness conditions** → one shared
  predicate. §13 rewrites the executor's semantics, which is its trigger.
- **`callerIsAddressed` and `audienceOf` move from `usecase/introspection.ts`
  to `service/`.** §10 touches that file, which is the trigger.

## 25. Section 11 edits this phase forces

- A **P4e** row; P4c's row rewritten to §23's criterion; the order stated as
  **P4a → P4c → P4e → P4d → P4b**.
- **P13's** criterion gains RFC 7592.
- **P9's** criterion gains the per-audience scope model and `/introspect`'s
  entitlement check.
- **P4e's** criterion names the `requested_userinfo_claims` follow-up, if
  the ADR keeps narrowing.
- `tests/docs/phase-references.test.ts` will fail on every citation that
  moves until it is corrected, which is the mechanism working. `docs/NEXT.md`
  and the archived specs are not read by it and are grepped by hand.
