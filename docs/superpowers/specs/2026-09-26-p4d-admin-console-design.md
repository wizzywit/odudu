# P4d — The admin console, and the admin API it needs

**Date:** 2026-09-26
**Status:** Draft
**Umbrella:** `docs/superpowers/specs/2026-09-10-odudu-design.md`, section 11

## 1. What this phase is

P4c published an admin API and P4e filled its audit trail. Nothing a person
can look at drives either yet: every operator task is a `curl` against
`/admin/**`, and a scan of the schema made for this phase (§4.5) found twelve
configuration surfaces the API does not reach at all, which the CLI or `psql`
alone can change.

This phase delivers three things, in dependency order:

1. **The admin API made complete** — every per-tenant and per-client setting
   the server honours becomes readable and writable through `/admin/**`, and
   the API gains what a console needs from it: server-side search and
   filters, bounded counts, the caller's own capabilities, and tenant export
   and import.
2. **A console gateway** — a backend-for-frontend inside `apps/server` that
   signs an administrator in through Odudu's own `/authorize`, keeps the
   tokens server-side, and forwards the console's calls to the admin API.
3. **The admin console** — a React application in `apps/admin-console`,
   compiled to static assets the server serves, covering the System area and
   every tenant area.

The account console the §11 row names is **not** built; §2 has why and where
its obligations went.

## 2. Scope, as brainstormed on 2026-09-26

**The account console is replaced, not deferred.** Odudu is adopted behind
applications that already have their own settings pages, and those
applications want profile editing inside their own product. What an
application cannot do on its own is run a credential ceremony: a passkey is
bound to Odudu's origin by WebAuthn, and routing TOTP seeds or recovery codes
through an application's backend exposes secrets that should exist only
between Odudu and the person. The replacement is **P4f**: a user-scoped
"me" API (profile, own credentials and their counts, own sessions, own
consents) authorised by the person's own access token, and
application-initiated actions — an application sends the user to
`/authorize` with an action, Odudu renders the page it already has, and
returns them. This follows Auth0's My Account API and Keycloak's
application-initiated actions. It moves to P4f with:

- the fresh set of recovery codes before the old set is spent, and the
  low-count warning;
- sessions shown against their device, the stable browser identifier
  ADR 0033 declines, and the orphan it admits;
- the re-scoping of `docs/request-paths.md`'s two unscoped `user_credentials`
  counts, which P4f re-captures;
- per-tenant TOTP policy, WebAuthn policy and recovery-code count (§4.5,
  row 15), which need per-credential parameters stored before they can vary.

**One phase, not two.** Admin API completion and the console were weighed
as separate phases and kept together at the user's direction: P4 has been
split five ways already. The estimate is re-stated rather than squeezed:
**140–180 hours**, against §11's 55–85, which was set before the account
console was re-scoped and before the configuration scan. §11 was amended
with this spec, before the plan: P4d's row, a new P4f row, the order, both
totals, and each other phase's criterion that §4.5 places an item against
(P4b, P7, P10, P11).

**Nothing found in this brainstorm is split off.** Every item the
configuration scan placed against P4d — §4.5 rows 1 to 13 — is built,
tested and documented in this phase, alongside the rest of §4, and none of
them waits for the console to exist. The only items that leave are the ones
§4.5 places by topic (rows 14 to 19) and the self-service work §2 moves to
P4f.

**The restated §11 criterion**, as it now stands in the umbrella spec, so
that no item here can be skipped with nothing going red:

> ADR 0038 choosing the console's stack and its backend-for-frontend,
> written before the first line of console code, and ADR 0039 recording
> that names relying parties match on are identifiers; CI caching by Turborepo, landed before the
> first Playwright increment; tenant names constrained to DNS labels by a
> `CHECK`, a predicate and a test holding them together; the admin API made
> complete — initial access tokens minted, listed and revoked; a subject's
> group memberships read and replaced; a role's composites listed and
> removed; a scope unassigned from a client; `default_for_new_subjects`
> amended after creation; a subject's profile claims and verification flags
> read and amended; a subject's consents listed and revoked; a one-time
> password issued with a forced change; a brute-force lockout cleared; every
> session of a subject ended at once; `builtin_admin` and
> `service_subject_id` readable; `client_registration_policy` validated
> before the database; a username renamed where the tenant's
> `username_editable` setting allows it; `whoami` answering the caller's effective
> capabilities; server-side, field-scoped, case-insensitive prefix search
> and exact filters on every paged list, each backed by an index, with
> cursors bound to their filters and the existing subject search's `LIKE`
> escaping fixed; bounded counts beside every countable list; tenant export
> with no secret in it and import into a new tenant only; `seed tenant`
> provisioning the admin client, and `odudu console provision` re-running it;
> a console gateway holding every token server-side behind an `HttpOnly`
> cookie, with CSRF defended beyond `SameSite`; an admin console reaching
> every capability the admin API exposes and none it does not, for tenant
> administrators and system administrators alike, the audit trail among it
> read by event type and by resource; the five functional layers carried
> outside the server for the first time, with the boundary suite's fixtures
> proving `service-is-a-leaf` is not over-broad; WCAG 2.2 AA checked on
> every page in both themes; Playwright green in its own CI job;
> `docs/admin-paths.md` and `docs/request-paths.md` with every new
> transcript executed; cross-tenant RLS probes green.

**Already done.** `POST /admin/tenants/{tenant}/clients` honouring or
refusing every field `PATCH` amends shipped in `534c434` (PR #39). The
criterion's item is closed, and the `docs/NEXT.md` entry still listing it as
owed is corrected.

**Stays where it is.** Theming, client branding and email templates are
P4b's. New claim mappers and authenticators an operator supplies are P10's.
Identity providers are P6's.

## 3. Decisions

| #   | Decision                                                                                                                | Where argued   |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------- |
| 1   | Account console replaced by a "me" API and application-initiated actions, in P4f                                        | §2             |
| 2   | Console holds no tokens: a backend-for-frontend in `apps/server` (RFC 10017's recommended pattern for sensitive apps)   | §5, ADR 0038   |
| 3   | React 19.3, Vite SPA, TanStack Router, TanStack Query, React Aria Components, CSS Modules with custom-property tokens   | §6, ADR 0038   |
| 4   | State: Query for server data, URL for position, Context for rarely-changing injected values, Zustand for busy UI stores | §6.4           |
| 5   | Five layers per feature; the layer is the first path segment under the feature, a folder or a single file               | §6.2           |
| 6   | React file naming (`PascalCase.tsx`, `useX.ts`, `camelCase.ts`) inside the console; kebab-case stays on the server      | §6.3           |
| 7   | Records are pages; one section, one save, one API call; explicit save; dialogs only to stop the user                    | §7.3           |
| 8   | Search is prefix, case-insensitive, scoped to one named field, ordered by that field; no contains-search, no free sort  | §4.3           |
| 9   | Counts are a separate bounded endpoint, capped at 10,000; lists stay count-free                                         | §4.4           |
| 10  | Export never carries a secret; import only creates a new tenant                                                         | §4.6           |
| 11  | Role, group, scope and tenant names are immutable; usernames are renamable behind a tenant setting, off by default      | §4.7, ADR 0039 |
| 12  | Tenant names are DNS labels                                                                                             | §4.1           |
| 13  | Visual direction "Instrument", light and dark, responsive by container queries                                          | §8             |
| 14  | Playwright runs as its own CI job, `e2e`, beside `verify`                                                               | §9             |

## 4. The admin API, completed

Every addition here is a route in `ADMIN_ROUTES`
(`packages/protocol-admin/src/service/capability.ts`), a row in the
capability matrix, a schema in `@odudu/contracts/admin`, an entry in the
OpenAPI document the coverage test already holds to every route, an
integration test against real PostgreSQL including a foreign-`tenant_id`
probe, an `admin_mutation` row where it writes, and an executed transcript in
`docs/admin-paths.md`.

### 4.1 Tenant names

A tenant name is a DNS label: one to 63 characters of lowercase letters,
digits and hyphens, neither starting nor ending with a hyphen. No
`/`, so one tenant's issuer cannot nest under another's (the `docs/NEXT.md`
row); no uppercase, so two tenants cannot differ by case alone in a URL a
person reads.

One rule, three expressions held together by a test: a `CHECK` on
`tenants.name` (a new migration), a predicate `isValidTenantName` in
`@odudu/domain-tenant`, and the test asserting the predicate and the `CHECK`
accept and refuse the same corpus. `POST /admin/tenants`, tenant import and
`odudu seed tenant` refuse through the predicate with one `400` detail.
`system` stays reserved through `isSystemTenantName`.

Nothing is deployed, so no existing name needs migrating; the migration
still refuses to apply over a violating row rather than rewriting it.

### 4.2 `whoami` reports capabilities

`GET /admin/tenants/{tenant}/whoami` keeps `subjectId` and `issuerTenantId`
and adds:

- `capabilities` — the caller's effective capabilities on the tenant in the
  path, resolved by the same code `authorizeAdmin` uses to authorise a
  request, so the console can never be told it holds something a request
  would be refused for;
- `crossTenant` — `true` when the caller reaches this tenant through
  `manage-tenants`.

The console treats the answer as advice for rendering, never as authority:
every action is still authorised by the server, and a `403` re-reads
`whoami` (§7.4).

### 4.3 Search and filters

A filter that runs in the browser over one loaded page reports "no match"
for a record on page three, so every list that pages filters on the server.

**Search** is a named field and a prefix: `?username=ada`, `?name=billing`.
It is case-insensitive through a stored generated column holding
`lower(<field>)` in the `C` collation, indexed — an expression index cannot
serve it under row-level security, because `lower` is not leakproof
(`docs/phases/p4d.md`, "Prefix search as one range scan"). A search that
matched one field _or_ another would be two index range scans to merge, and
a contains-search (`%love%`) needs a trigram index that cannot return rows in
cursor order — both give up "every page costs one index range read", so
neither is offered. The console's search box carries a visible field chip
instead of guessing which field was meant.

The existing `?search=` on subjects is replaced by `?username=`. It is
case-sensitive today, and it passes `%` and `_` through to `LIKE` unescaped
(`packages/protocol-admin/src/usecase/subjects.ts:115`), so a search for
`a_b` matches `axb`. No search in this phase uses `LIKE`: a prefix is a
range between two bounds, so `%` and `_` are ordinary characters, and the
prefix is case-folded by the same `lower()` that fills the column, in the
database, so the bound and the stored key can never fold differently.

**Ordering.** Unfiltered lists stay in creation order (`id`). A searched
list is ordered by that column and `id`, and paged by a keyset over that
pair, which is what makes page one thousand as cheap as page one. The cursor
payload (`CursorPayload`, `packages/protocol-admin/src/service/cursor.ts`)
today carries `after`, `collection` and `tenantId`; it gains the sort value
and a digest of the filter set, so a cursor minted under one search is
refused under another rather than silently paging the wrong list.

**Exact filters** are named parameters with enumerated values. An unknown
parameter is refused with `400`, the way `PATCH` refuses an unknown field.

| List     | Prefix search fields   | Exact filters                                  |
| -------- | ---------------------- | ---------------------------------------------- |
| Tenants  | `name`, `display_name` | `enabled`                                      |
| Subjects | `username`, `email`    | `enabled`, `role` (direct assignment), `group` |
| Clients  | `client_id`, `name`    | `type`, `enabled`                              |
| Roles    | `name`                 | `client` (a client's id, or `tenant`)          |
| Groups   | `name`                 | —                                              |
| Scopes   | `name`                 | —                                              |
| Keys     | —                      | `status`, `alg`                                |
| Audit    | —                      | the existing filters, plus `resource_id`       |

A subject's sessions, credentials, groups and consents are bounded per
subject and are not filtered.

Every search field and exact filter has an index shaped for it, added in a
migration. The plan carries `verified: EXPLAIN …` for each against a seeded
table, not an assertion that the index is used.

### 4.4 Bounded counts

`GET …/{collection}/count` for tenants, subjects, clients, roles, groups and
scopes. It takes the same search and filters as its list, requires the same
capability, and answers `{"count": 1204, "capped": false}` or
`{"count": 10000, "capped": true}`. It is `count(*)` over a `LIMIT 10001`
subquery, so its cost has a ceiling however large a tenant grows. The audit
trail has no count; the console shows its time range.

This amends P4c's "no totals, anywhere" in one direction only: list
responses stay count-free, and the count is a separate request a caller
makes deliberately — Keycloak's `/count` shape, bounded.

### 4.5 Configuration the API does not reach today

A scan of every configuration-bearing column against `ADMIN_ROUTES` found
these. Rows 1–13 are this phase's: the topic is administration, and each is a
setting the server honours that an administrator cannot change without the
CLI or `psql`.

| #   | Gap                                                          | Today                                                                  | This phase                                                                                                    |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | Initial access tokens for dynamic registration               | minted by `seed registration-token` only; listed and revoked by `psql` | `GET`, `POST`, `DELETE …/registration-tokens`; a minted token is shown once                                   |
| 2   | A subject's group memberships (`subject_groups`)             | `seed join-group` only                                                 | `GET`, `PUT …/subjects/{id}/groups` (`If-Match` mandatory, as for roles)                                      |
| 3   | A role's composites                                          | add only (`POST …/roles/{id}/composites`); no read, no remove          | `GET …/roles/{id}/composites`, `DELETE …/roles/{id}/composites/{childId}`                                     |
| 4   | A scope's assignment to a client                             | upsert only                                                            | `DELETE …/scopes/{id}/clients/{clientId}`                                                                     |
| 5   | `roles.default_for_new_subjects` after creation              | refused by `role-patch.ts:16` as needing "its own operation"           | `PUT …/roles/{id}/default` with `{"default": bool}`, audited as its own action                                |
| 6   | Profile claims and `email_verified`, `phone_number_verified` | `seed profile` or `psql`; `subjectSchema` exposes six fields           | `GET`, `PATCH …/subjects/{id}/profile` over every `users` claim column                                        |
| 7   | Consents a subject has recorded                              | `psql` only                                                            | `GET …/subjects/{id}/consents`, `DELETE …/subjects/{id}/consents/{clientId}`                                  |
| 8   | An administrator restoring a subject's password              | impossible; without SMTP a locked-out user cannot be helped            | `POST …/subjects/{id}/password`: a server-generated one-time password, shown once, with `update-password` set |
| 9   | Clearing a brute-force lockout                               | no route                                                               | `DELETE …/subjects/{id}/lockout`                                                                              |
| 10  | Ending every session of a subject                            | one `DELETE` per session                                               | `DELETE …/subjects/{id}/sessions`                                                                             |
| 11  | `clients.builtin_admin`, `clients.service_subject_id`        | readable only by `psql` (`docs/admin-paths.md:611-614`)                | read-only fields on the client representation                                                                 |
| 12  | `client_registration_policy` outside its enumeration         | reaches the database `CHECK` (migration `0045`) instead of a `400`     | validated against the enumeration by the settings coercer                                                     |
| 13  | Renaming a username                                          | refused by `subjects-patch.ts:13`: "belongs to a dedicated operation"  | `PATCH …/subjects/{id}` accepts `username` when the tenant's new `username_editable` setting is on (§4.7)     |

Row 8 has the shape `odudu seed admin` already has: the server generates the
password, answers it once, never stores or logs it in the clear, and the
subject must change it at the next sign-in. An administrator never chooses
another person's password.

Placed elsewhere, each against the phase whose topic covers it:

| #   | Item                                                                                                                            | Phase                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 14  | Renaming a role, group, scope or tenant                                                                                         | decision, §4.7                              |
| 15  | TOTP policy, WebAuthn policy and recovery-code count per tenant                                                                 | **P4f**                                     |
| 16  | Email templates                                                                                                                 | **P4b**                                     |
| 17  | Operator-supplied claim mappers and authenticators                                                                              | **P10**                                     |
| 18  | Identity providers                                                                                                              | **P6**                                      |
| 19  | `apps/server/src/app.ts:91-92` names `ODUDU_CLIENT_SECRET_THROTTLE_*`, which does not exist; the limiter is fixed at 5 per 60 s | **P11**, whose criterion names that limiter |

Deployment-wide settings — retention windows, workers, the SMTP fallback,
proxy and TLS — stay environment variables. They configure an installation,
not a tenant.

### 4.6 Export and import

**Export.** `GET /admin/tenants/{tenant}/export`, requiring `manage-tenant`
and `manage-clients` (every other client read needs the latter),
answers `application/vnd.odudu.tenant+json` carrying `version: 1`:
settings, the authentication flow, clients (every field but the secret),
roles and composites, groups and their roles, scopes with their role
mappings, mapper bindings and client assignments, registration policy, and
SMTP host, port, sender and STARTTLS. `?include=subjects` adds, and
additionally requires `view-users`: subjects with profile claims, role and
group memberships and required actions.

Never exported: password hashes, TOTP seeds, passkeys, recovery codes,
client secrets, the SMTP password, private signing keys, sessions,
consents, grants, registration tokens and audit rows. Each secret a
consumer would expect is listed under `omitted` by its JSON path, so the
gap is visible in the file rather than silent.

Export is refused above 10,000 subjects with `?include=subjects`, naming
**P7**, whose inbound provisioning is the tool for moving users in bulk. An
export writes a `tenant.export` audit row.

**Import.** `POST /admin/tenant-imports`, requiring `manage-tenants`, takes
`{name, display_name, document}` and always creates a new tenant. The whole
document is validated before anything is written, and every problem is
reported with its JSON path in one `400`. The tenant is then created in one
transaction with fresh signing keys and a fresh secret for each confidential
client, answered once in the `201`. Imported subjects carry no credential
and receive `update-password`. The import writes `tenant.import` into the
new tenant's trail.

Merging into an existing tenant is not offered: deciding what wins on a
conflict and what an import may delete is where partial import damages a
live tenant, and "new tenant only" makes that impossible.

### 4.7 Names relying parties match on are identifiers; usernames are not

OIDC Core makes `iss` and `sub` together the only stable identifier for an
End-User, and forbids a relying party from keying on `preferred_username`,
`email` or `name`. Odudu's `sub` is the subject's id
(`packages/protocol-oidc/src/service/claims.ts:31`), so two kinds of name
behave differently.

**Immutable: role, scope, group and tenant names.** These are the values a
relying party authorises on — the `roles` claim, a requested `scope`, the
`groups` claim and its paths — and a tenant's name is the issuer. A rename
would change new tokens while tokens already issued still carry the old
value, so an RP's check would pass or fail by a token's age. The "needs its
own operation" refusals in `role-patch.ts`, `group-patch.ts`,
`scope-patch.ts` and `tenant-patch.ts` become a recorded decision rather
than an unbuilt operation: **ADR 0039**, "Names relying parties match on are
identifiers". The console shows such a name as fixed after creation, with
that reason, and offers "create a copy" for roles and scopes.

**Renamable: a username**, behind a tenant setting `username_editable`,
`false` by default — Keycloak's "Edit username", off by default, is the
precedent, and so is where the change is made: Keycloak renames through its
ordinary user update, and so does Okta through `profile.login`.
`PATCH …/subjects/{id}` accepts `username`, checked by the same validation
creation runs. `subjects-patch.ts`'s refusal becomes conditional: with the
setting off, `username` is refused with `400` and the reason that the tenant
has not enabled username editing, the way `type` is refused today. With it
on, `If-Match` is mandatory whenever `username` is in the body — `428`
without it, the precedent `redirect_uris` set on `PATCH …/clients/{id}` —
because a rename silently undoing another administrator's is what that
precondition exists to stop. A username another subject holds refuses the
whole amendment with `409`, and nothing in it is applied.
The change is an
`admin_mutation` row carrying the before and after values. Nothing keyed on
the subject moves: sessions and grants hold `sub`, brute-force counters are
keyed by subject rather than by the name submitted
(`packages/domain-identity/src/schema/login-failures.ts`), and
`preferred_username` changes on the next token issued. A password that
equals the new username is not re-checked against `password_not_username`
until it is next changed, which is when every password policy applies. The
setting joins `SETTINGS` in `@odudu/domain-tenant` through a migration, so
`PATCH …/settings`, `seed tenant --set` and export all reach it.

## 5. The console gateway

A new package, `@odudu/console-gateway`, in the five layers, mounted by
`apps/server` under `/console`. It is an OAuth client of Odudu like any
other: it reaches `/token`, `/revoke` and `/admin/**` through Fastify's
in-process `inject`, so it imports no protocol package and every forwarded
request passes through the admin API's own authentication, authorisation
and audit.

### 5.1 Routes

| Route                        | Does                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /console/*`             | the built SPA; `index.html` for any path that is not an asset, with a strict CSP (§5.4)                                                                                                                                                                                                                                                                                                      |
| `GET /console/auth/login`    | `?tenant=&return_to=`; stores a pending login (state, PKCE verifier, nonce, tenant, return path) and redirects to `/tenants/{tenant}/authorize` with `client_id=odudu-admin`, `resource=urn:odudu:params:admin-api`, `scope=openid`, `code_challenge`                                                                                                                                        |
| `GET /console/auth/callback` | checks `state` and the RFC 9207 `iss`; exchanges the code; verifies the ID token and its nonce; stores the tokens encrypted; sets the session cookie; redirects to `return_to`, which must be a `/console/` path on this origin                                                                                                                                                              |
| `GET /console/api/session`   | the tenant, subject and username the SPA boots from                                                                                                                                                                                                                                                                                                                                          |
| `* /console/api/admin/*`     | the proxy: resolves the session, refreshes the access token within 30 s of expiry, forwards with `Authorization: Bearer`; passes status, `ETag`, `Location`, problem+json and `Link` through, rewriting `Link` and `Location` into `/console/api/`; strips cookies                                                                                                                           |
| `POST /console/auth/logout`  | revokes the refresh token, deletes the console session and clears its cookie, then answers `200 { "redirect": … }` naming the tenant's `/protocol/openid-connect/logout` with `id_token_hint`, `post_logout_redirect_uri` and `client_id`, which the SPA navigates to so the SSO session ends as well; not a `302`, because the CSRF header makes this a `fetch`, which cannot move the page |

### 5.2 Sessions

`console_sessions`, a new table under row-level security: id, `tenant_id`
(the issuing tenant), `subject_id`, a SHA-256 of the cookie secret, the
access, refresh and ID tokens each wrapped by `wrapSecret`
(`@odudu/crypto`, the interface signing keys and the SMTP credential
already use), `created_at`, `last_seen_at`, `expires_at`.

The cookie carries `<tenant_id>.<secret>`: the lookup sets `app.tenant_id`
from the first half before reading, so the table needs no path around RLS.
A session ends at 30 minutes idle, 12 hours absolute, when its refresh
token is refused, or when the admin API refuses its access token, confirmed
against the session's own tenant, whichever is first. Refreshes are serialised per session
by a row lock, so two tabs refreshing together cannot trip refresh-token
reuse detection and revoke the grant. Pending logins live in
`console_logins` with a ten-minute lifetime. Both tables are reaped by
`odudu reap` and take their place in `REAP_ORDER`.

### 5.3 Cookie and CSRF

`__Host-odudu-console`, `HttpOnly; Secure; SameSite=Strict; Path=/`. Over
plain HTTP in development it takes ADR 0020's rule: the same attributes
without `Secure`, under a name without the `__Host-` prefix.

A state-changing request to `/console/api/**` must carry an `Origin` equal to
the configured origin and the header `X-Odudu-Console: 1`. The custom header
forces a CORS preflight that nothing grants; the `Origin` check refuses a
same-site forgery `SameSite` would not.

### 5.4 Serving the SPA

`index.html` is served with `default-src 'self'; script-src 'self';
style-src 'self' 'sha256-…' 'sha256-…'; img-src 'self' data:; font-src 'self'; connect-src 'self';
frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, plus
`x-frame-options: DENY` and `referrer-policy: no-referrer`. Assets are
content-hashed and served immutable; `index.html` is `no-store`. Fonts are
self-hosted, since `font-src 'self'` refuses a font CDN.

The two `'sha256-…'` sources are the hashes of the stylesheets React Aria
injects at runtime, `usePress`'s and, on iOS WebKit, `usePreventScroll`'s,
each constant per version: a test recomputes both from the pinned source,
so an upgrade that changes the text fails the build rather than the page.

The SPA's shell is not a server-rendered page in ADR 0029's sense — it has no
per-request nonce, because it has no inline script — so its headers are
set by the gateway's one static-serving function, and
`html-response.test.ts`'s view-layer walk is extended to name that file as
the third authorised header site.

### 5.5 Configuration

`ODUDU_CONSOLE` (`true` by default; `false` registers no `/console` route).
It follows the `true`/`false` spelling every other switch in
`packages/kernel/src/config.ts` uses, rather than an `on`/`off` pair
nothing else there has. With the console on, `ODUDU_PUBLIC_BASE_URL` is
required, and boot refuses without it, naming both the variable and the
switch. Boot also refuses an `https` base while `ODUDU_TRUST_PROXY` is off:
the issuer is built from a request's scheme and host
(`packages/protocol-oidc/src/view/issuer.ts`), a request the gateway
injects in-process never arrives over TLS, and only a trusted
`x-forwarded-proto` lets it see the `https` issuer the browser sees.
`ODUDU_CONSOLE_DIR` (default `/app/console`) names the built SPA's
directory.

The redirect URI `${ODUDU_PUBLIC_BASE_URL}/console/auth/callback` and the
post-logout redirect URI `${ODUDU_PUBLIC_BASE_URL}/console/` are written
onto a tenant's `odudu-admin` client by `provisionAdminClient`,
idempotently, so a re-run corrects a changed base URL: an entry with either
path is replaced by the current base's, and every other entry, the loopback
URI included, is kept. Neither is ever derived from a request's `Host`.

`provisionAdminClient` runs when `POST /admin/tenants` creates a tenant and
`POST /admin/tenant-imports` imports one
(`insertProvisionedTenant`, `packages/protocol-admin/src/usecase/tenants.ts`),
when `odudu seed admin` bootstraps `system`, and from `odudu seed tenant`
and `odudu seed --tenant` (`apps/server/src/cli/seed.ts`), each passing the
base while the console is on. `seed tenant` already provisioned the admin
client before this phase (43c24a9); what this phase adds is the console's
URIs on every one of those paths, and `odudu console provision`, which
re-runs `provisionAdminClient` over every tenant: the command to run after
setting or changing `ODUDU_PUBLIC_BASE_URL`.

In development, Vite's server proxies `/console/api` and `/console/auth` to
Fastify, so the browser stays same-origin and the cookie rules hold as they
do in production.

## 6. The console application

### 6.1 Stack

React 19.3, built by Vite as a static SPA. TanStack Router for type-safe
routes and search parameters; TanStack Query inside the repository layer;
React Aria Components, unstyled, for every interactive primitive; CSS
Modules over custom-property tokens; Zustand for the stores §6.4 allows;
Vitest and Testing Library for units; Playwright for flows. Versions are
pinned exactly, as elsewhere in the workspace, and respect
`minimumReleaseAge`. ADR 0038 records each choice against its alternatives:
Tailwind v4 and vanilla-extract for styling, Next.js and React Router's
framework mode for the build, an in-browser OAuth client and a
token-mediating backend for authentication.

### 6.2 Layout and layers

```
apps/admin-console/src/
├─ app/          composition root: router, providers, the shell
├─ shared/       only what two or more features use
│  ├─ view/      design system (§8)
│  ├─ transport/ the one HTTP client to the gateway
│  ├─ adapter/   browser storage (local and session)
│  ├─ service/   pure rules: capabilities, dirty tracking, formatting
│  └─ repository/ cross-feature stores: toasts, the unsaved-changes guard
└─ features/<feature>/
   ├─ index.ts   the feature's routes — the only importable surface
   ├─ view/ or view.tsx
   ├─ usecase/ or usecase.ts
   ├─ repository/ or repository.ts
   ├─ adapter/ or adapter.ts
   └─ service/ or service.ts
```

**The layer is the first path segment under the feature**, a folder when the
layer has several files and a single file named for the layer when it has
one. A layer a feature does not need does not exist. Every file is therefore
classified by its path alone.

Browser storage is an outside system like the gateway, so it belongs to an
adapter: a feature's `adapter/` may hold its own `localStorage` or
`sessionStorage` access, and `shared/adapter/` what two features share. The
repository decides what to remember and when.

Features: `session`, `shell`, `overview`, `tenants`, `system-admins`,
`subjects`, `groups`, `roles`, `clients`, `scopes`, `registration-tokens`,
`flow`, `keys`, `settings`, `smtp`, `import-export`, `audit`.

The import rules are ADR 0010's. dependency-cruiser gains:

- `features/A/**` and `app/**` may import `features/B/index.ts` and nothing
  else of B;
- nothing but a test and `src/testing/` itself imports `src/testing/`;
- `shared/**` never imports `features/**`;
- a console `service` imports only other services, its own or
  `shared/service`, and `@odudu/contracts`, so never a feature's `index.ts`;
- a feature's `index.ts` publishes only its own views, usecases and
  services, and types of anything, never a repository or an adapter;
- `app/**` is the only place that assembles features;
- a `view` never imports `shared/transport` or `shared/repository`;
- the existing layer rules match `(view|usecase|repository|adapter|service)(/|\.tsx?$)`
  so a single-file layer is held to them.

The fixtures gain a service importing another service in the same package,
which **must pass** — the missing negative control `docs/NEXT.md` records
against `service-is-a-leaf` — and a feature reaching into another's
internals and a shared module importing a feature, which must fail.

Adapters parse responses with `@odudu/contracts`' Zod schemas, the ones the
API is built from, so a contract change fails the console's typecheck rather
than its runtime.

### 6.3 Naming

Inside `apps/admin-console` only: a component is `PascalCase.tsx`; a file
exporting a hook is `useCamelCase.ts` (or `.tsx`), in whatever layer it
sits; anything else is `camelCase.ts`; a test repeats its subject's name
with `.test`; a CSS module sits beside its component. A lint test in
`tests/lint/` fails the build on a `use*` file exporting no hook, on a hook
exported from a file not named `use*`, and on a component file not in
PascalCase. `eslint-plugin-react-hooks` holds hooks to their rules.
A `#/` import names its file's extension (`#/app/App.tsx`), because under
`moduleResolution: bundler` TypeScript does not probe extensions for a
`package.json` `imports` target, and one `"#/*": "./src/*"` must reach both
`.ts` and `.tsx`.

Component props are plain properties, not `readonly`; an array prop is typed
`readonly T[]`.

A stateful usecase is a hook — `useAmendClientIdentity` returning
`{ save, status, fieldErrors }` — and a stateless one a function; both live
in `usecase`.

### 6.4 State

| State                                                  | Home                            |
| ------------------------------------------------------ | ------------------------------- |
| Server data                                            | TanStack Query, in `repository` |
| Position: tenant, record, tab, filters, cursor         | the URL                         |
| Rarely changing, injected: principal, transport, theme | Context                         |
| Busy UI stores: toasts, the unsaved-changes guard      | Zustand, in `repository`        |

A view never imports a store; it reads through its usecase. No store ever
holds a copy of server data.

## 7. The console, as a person uses it

### 7.1 Getting in

A tenant in the URL goes straight to its sign-in: `/console/acme`. Without
one, the last tenant this browser signed in to is used, with "a different
tenant" beside it. Only a bare `/console` in a fresh browser asks "which
tenant do you administer?". The question cannot be skipped by asking for a
username first: usernames are unique per tenant, not across them, and a
lookup across tenants would tell anybody which tenants a name belongs to.

A tenant administrator already signed in who opens another tenant's console
sees a page, not a dialog — "You're signed in to acme as grace", with "Back
to acme" and "Sign in to globex" — and the old console session ends only
once the new sign-in succeeds; a system administrator enters with system
authority instead.

After sign-in the tenant comes from the token. A first-time administrator
passes through the forced password change on the way back, because that is
Odudu's own login flow.

### 7.2 Information architecture

The tenant rail groups areas by task: **Overview**; **Identity** — Subjects,
Groups, Roles; **Applications** — Clients, Scopes, Registration tokens;
**Security** — Sign-in flow, Signing keys; **Tenant** — Settings, Email,
Import / export; **Observe** — Audit trail.

Overview shows the issuer with a copy control and a discovery link, bounded
counts, a "needs attention" list (no SMTP while verification or reset is
on; a `rotating` key — published, not signing — old enough to promote; dynamic registration
open with no client cap headroom), and the latest audit rows.

Record pages and their tabs:

| Area    | Tabs                                                                                       |
| ------- | ------------------------------------------------------------------------------------------ |
| Subject | Profile · Credentials · Groups · Roles · Required actions · Sessions · Consents · Activity |
| Group   | General · Roles · Activity                                                                 |
| Role    | General · Composites · Activity                                                            |
| Client  | General · Redirects & origins · Tokens · Scopes · Logout · Advanced · Activity             |
| Scope   | General · Roles · Claim mappers · Clients · Activity                                       |

Sign-in flow is one page of ordered steps with their requirement. Signing
keys is one page of three lanes by the stored status: `rotating`
(published, not signing), `active` and `retired`. Settings is
one page of sections by concern: sessions, remember-me, registration and
recovery, usernames (whether they may be renamed), password policy, brute
force, dynamic registration, retention. With `username_editable` on, a
subject's username is an editable field in its Profile section; with it off,
the field is shown fixed with the reason and a link to the setting.
Activity on every record is the audit trail filtered by `resource_id`, the
same view rather than a second one.

**The System area**, for a system administrator signed in to `system`:
Tenants (list, search, count, guided creation, a tenant record with its
administrators, export, and "enter tenant"); System administrators; System
settings (the `system` tenant's own areas); System audit. Inside a tenant, a
system administrator sees the tenant console under an amber context bar,
"acting in acme with system authority", that does not go away, and every
confirmation names the tenant.

**Creating a tenant** is a guided page whose steps are each one API call and
which can be resumed: the tenant, with the name rule and a live issuer
preview; its first administrator, created with a one-time password (§4.5,
row 8) and granted `tenant-admin`; done.

A tenant cannot be deleted: the API has no such route. It can be disabled.

### 7.3 Editing

- **A record is a page** with its own URL and tabs.
- **One section, one save, one API call.** A section's save bar appears only
  when it has changes. There is no "save all" that can half-succeed.
- **Nothing saves silently**: no autosave, no save on blur. Changed fields
  are marked, a tab with changes carries a dot, and leaving asks first.
- **Every save sends the `ETag` it loaded with.** A `412` shows the other
  administrator's value beside yours, field by field, and offers "keep mine"
  (re-save on the fresh `ETag`) or "take theirs". Nothing merges on its own.
- **Errors sit under the field** the problem detail names. A toast confirms
  success or reports a failure that belongs to no field.
- **Dialogs only stop you**: a destructive or irreversible action, a secret
  shown once, leaving unsaved work. Never stacked, never used for editing,
  always stating the consequence.
- **Creation is a short page** of required fields, landing on the new
  record's page.
- **Undo only where the API has an inverse** — disable and enable. Nothing
  that deletes offers undo.
- **Nothing hidden**: no hover-only or swipe-only action, no unlabelled icon
  button, and a keyboard shortcut is shown beside the control it triggers.

### 7.4 Edge cases

- The console always sends `If-Match`, so a `428` is a console defect, logged
  and never shown as the user's mistake.
- One request per section is in flight at a time; the button reads
  "Saving…" and Enter cannot resubmit.
- A `POST` whose outcome is unknown after a timeout is never retried; the
  console says it could not confirm the result and offers to check the list.
  A `GET` retries on its own; a `PATCH` or `PUT` retries safely, since a
  duplicate surfaces as `412`.
- Saving one section of a record re-bases the record's other dirty sections
  on the fresh read, keeping their edits.
- Reads refetch on window focus but never overwrite a field being edited; a
  record that changed shows "updated since you opened it".
- A `401` from the gateway keeps the draft in `sessionStorage` — never a
  field holding a secret — sends the user through sign-in, and restores the
  draft marked for review. Nothing is saved on their behalf.
- Every tab shares one console cookie, so another tab's sign-in can replace
  the session under this one. Each admin request names the subject its tab
  shows in `X-Odudu-Console-Subject`, and the gateway answers a mismatch
  `409` `about:blank#console-principal-changed`, forwarding nothing. That
  refusal, or a session read naming somebody else, ends this tab's session
  as a `401` does: its drafts are kept for the principal they were made as,
  and a page says who the browser is signed in as now, offering to sign in
  as the old principal again or to continue as the new one, which discards
  them. `whoami` is cached per tenant and principal.
- A `403` says which capability is missing and re-reads `whoami`.
- An action against yourself — ending your own session, removing your own
  admin role, disabling your own subject — says so in its dialog. The
  server's lockout guards still decide.
- Typed confirmation guards disabling a tenant, retiring a key and deleting
  a client or subject; a plain confirmation guards the rest.
- A `409` from a reference (a role still in a composite) is shown beside the
  action with the API's detail.
- A secret shown once — a client secret, a registration token, a one-time
  password, import's client secrets — is displayed in a dialog with a copy
  control and an acknowledgement, and never enters a toast, the URL, a draft
  or the query cache.
- A rule that cannot be changed is shown as fixed text with its reason
  ("`system` cannot be disabled"; "a role's name is fixed after creation"), not
  offered and then refused.
- Three empty states are distinct: nothing yet, nothing matches, failed to
  load.
- Ids are shortened in lists with a visible copy control, never truncated in
  a form. Time shows relative and absolute together. Seconds show with their
  human reading ("1209600 s · 14 days"). Effective defaults are shown, never
  a blank.
- `request_id` in the audit trail is labelled a correlation, not evidence,
  and a row whose `actor_tenant_id` differs from its tenant is marked as a
  caller from elsewhere (ADR 0037's third amendment).
- The unsaved-changes guard covers in-app navigation, tab changes, tenant
  switching, sign-out, and the browser's back, reload and close.
- Lists page by "Load more" and by Previous and Next, the visited cursors
  kept in the URL. There is no jump to page N.

## 8. Design system: Instrument

**Tokens** in `shared/view/tokens.css`, light and dark through
`light-dark()`, following the system setting with a remembered override:

- surface: mineral grey with a faint 24 px grid on the page only, white
  panels, hairline borders, a near-black rail;
- ink: primary, muted, and ink on the rail;
- signal: jade for active, success and focus; **amber reserved for system
  authority**; ochre for warning; burnt orange for danger; each paired with
  an ink shade that reaches 4.5:1 on its surface;
- type: IBM Plex Sans for content, IBM Plex Mono for labels, ids,
  navigation and buttons, self-hosted; a 12, 13, 15, 20, 28 scale;
- shape: 3–4 px radii, 1 px borders, shadows only on the toast and dialog
  layers;
- space: a 4 px base, steps of 8, 12, 16, 24, 32;
- motion: 120 ms for hover and press, 200 ms for panels and toasts, one
  ease-out curve, View Transitions between routes; `prefers-reduced-motion`
  makes each instant.

**Responsive by container queries**: at 1024 px and wider, the full rail and
multi-column tables; from 640 to 1023, a narrower rail and fewer columns;
under 640, a top bar with a menu sheet, tables as stacked rows, save bars
sticky at the bottom and toasts above the thumb zone. From 640 up the rail
can also be collapsed for full width, and collapsed means gone rather than
narrowed: the page takes the narrow layout's top bar, whose **Menu** opens
the same sheet. A labelled "Collapse menu" at the rail's foot, with its
shortcut `[` shown beside it, collapses it; the same shortcut, or "Expand
menu" in the top bar, restores it. There is no icon-only rail, since it
would need hover-only or unlabelled controls (§7.3). The choice is
remembered in `localStorage`, every access guarded, and the amber context
bar never collapses.

**Components** in `shared/view`: AppShell, Rail, ContextBar, PageHeader,
Tabs, Section with SaveBar, Field (text, number with unit, select, toggle,
URL list, key-value), DataTable with stacked mode, FilterBar, Pager, Count,
EmptyState, Skeleton, Toasts, ConfirmDialog (plain and typed), SecretDialog,
UnsavedChangesDialog, CopyValue, Timestamp, Duration, StatusTag,
CapabilityNote.

**Toasts** announce through `aria-live`; success dismisses after about five
seconds, pausing on hover and focus; an error stays until dismissed
(WCAG 2.2.1). A toast is never the only copy of anything a person must act
on.

**Accessibility** is WCAG 2.2 AA: visible focus, focus returned when a
dialog closes, targets of at least 24 px, status never carried by colour
alone.

## 9. Testing and CI

Test-driven throughout: each behaviour's test is written and seen failing
before its implementation, in every layer.

| Level                       | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit, Vitest                | the console's services, usecases and repositories against a fake transport; views with Testing Library, asserting roles and text; every view test runs axe in both themes, enforced by a lint; the gateway's services                                                                                                                                                                                                                                                                                                                                      |
| Integration, Testcontainers | every new admin route, with a foreign-`tenant_id` probe and a capability-matrix row; the name `CHECK` against the predicate; filters and cursors, including a cursor replayed under a different filter; counts at and past the cap; a username rename refused with the setting off, `428` without `If-Match`, `409` on a taken name with nothing applied, and a session and brute-force counter surviving it; export and import round-trip; `console_sessions` and its RLS; the gateway's login, callback, proxy, refresh race and logout through `inject` |
| Playwright, job `e2e`       | sign-in and the forced change; an expired session restoring a draft; create, edit, a `412` conflict and its resolution; typed confirmation; a secret shown once; a system administrator entering a tenant under the context bar; guided tenant creation; export then import; a phone viewport; dark mode; axe on every page in both themes                                                                                                                                                                                                                 |
| Boundary and lint           | the console's feature rules and fixtures, the `service-is-a-leaf` negative control, React naming, and the existing no-`any` and comment-length tests                                                                                                                                                                                                                                                                                                                                                                                                       |

**CI caching lands first.** `test` becomes a Turbo task per package with
`globalDependencies` naming the root configuration, the lockfile and
`tsconfig.base.json`, and the workflow restores Turbo's cache. The phase
note records `verify`'s duration before and after.

**`e2e` is its own job**: build the image, start it with PostgreSQL, seed an
administrator, run Playwright. It runs beside `verify` rather than inside it.
Making it a required check on `main` is a repository setting the owner
changes; the phase note asks for it.

## 10. Documents

- `docs/admin-paths.md`: every new route, with executed transcripts.
- `docs/request-paths.md`: the console's sign-in path — redirect, callback,
  cookie, proxy — as real output, in its own section.
- `README.md`: running the console, `ODUDU_CONSOLE`, `ODUDU_PUBLIC_BASE_URL`,
  and the development proxy.
- ADR 0038 (the console's stack and its gateway) and ADR 0039 (names relying
  parties match on are identifiers), before the code each governs.
- The umbrella spec's §11: P4d's criterion and estimate restated, a **P4f**
  row added, the order **P4d → P4f → P4b**, and a subsection recording why
  the account console was replaced.
- `docs/NEXT.md`: the client-fields entry closed, the recovery-code,
  device-session and credential-count entries pointed at P4f, the
  tenant-name row closed.
- `docs/phases/p4d.md`: what building this phase found.

## 11. Assumptions, spiked

- `verified:` Fastify's `inject({ remoteAddress })` sets `request.ip` with
  `trustProxy` off, so audit rows written through the gateway can record the
  browser's address rather than the loopback.
- `verified:` Vite's production build emits no inline script and no `style`
  attribute, so `script-src 'self'` holds without a nonce.
- `verified:` React Aria applies styles through the CSSOM, which
  `style-src 'self'` does not govern, with two exceptions, each a constant
  `<style>` element allowed by its hash (§5.4): `usePress` injects one
  everywhere, and `usePreventScroll` one on iOS WebKit.
- `verified:` a stored generated `lower(<field>)` column in the `C`
  collation, indexed with `tenant_id` and `id` and queried by explicit bounds,
  is one Index Scan with no Sort under RLS; the expression index first
  assumed here was not (`docs/phases/p4d.md`).
- `verified:` `odudu-admin`'s access token names the admin API in `aud` on
  the code exchange and on refresh, with or without `resource`, so the
  gateway's refreshed token keeps its audience.

## 12. Increments

Each is two to six hours, independently mergeable, and ends with CI green on
a pushed commit and the review it attracted answered.

1. **Groundwork** — CI caching; ADR 0038 and ADR 0039; the spikes listed in this spec's §11.
2. **API** — tenant names; `whoami`; search, filters, cursors and indexes by
   collection (about three); counts; §4.5 rows 1–13 (about four); export;
   import.
3. **Gateway** — the tables and reaping; login and callback; the proxy and
   refresh; logout, CSRF and static serving; the redirect URI on
   `provisionAdminClient`.
4. **Console foundation** — the scaffold, boundary rules and naming lint;
   tokens and core components (about two); the shell, session and draft
   restore; the Playwright harness with sign-in.
5. **Features**, each ending with its Playwright flow — Overview; Tenants and
   guided creation; System administrators; Subjects (about three); Groups;
   Roles; Clients (about three); Scopes; Registration tokens; Sign-in flow;
   Signing keys; Settings and Email; Import / export; Audit.
6. **Close** — the whole-branch review and the phase-closing pass
   `CLAUDE.md` describes.

## 13. Index of verified claims

| Claim                                                                                                                | Verified by                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `whoami` answers only `subjectId` and `issuerTenantId`                                                               | `docs/admin-paths.md:868-879`                                                                                   |
| Lists page by an HMAC cursor carrying `after`, `collection`, `tenantId`                                              | `packages/protocol-admin/src/service/cursor.ts:31-35`                                                           |
| Subject search is `like(users.username, '<q>%')`, unescaped                                                          | `packages/protocol-admin/src/usecase/subjects.ts:115`                                                           |
| No route for group membership, composite read or removal, scope unassignment, registration tokens, consents, profile | `grep -n "pattern:" packages/protocol-admin/src/service/capability.ts`                                          |
| "Needs its own operation" refusals for names, `default_for_new_subjects`, `service_subject_id`, `builtin_admin`      | `grep -rn "needs its own operation" packages/protocol-admin/src/service`                                        |
| `subjectSchema` carries six fields                                                                                   | `packages/contracts/src/admin/subjects.ts:14-21`                                                                |
| `ODUDU_CLIENT_SECRET_THROTTLE_*` is named in a comment and read nowhere                                              | `grep -n "CLIENT_SECRET_THROTTLE" apps/server/src/app.ts apps/server/src/main.ts packages/kernel/src/config.ts` |
| `wrapSecret` is `@odudu/crypto`'s key-encryption export                                                              | `packages/crypto/src/index.ts:1`                                                                                |
| The next free migration follows `0071_session_secret.sql`; the next ADR is 0038                                      | `ls packages/db/drizzle`, `ls docs/adr`                                                                         |
| `odudu-admin` is a public client provisioned per tenant by `provisionAdminClient`                                    | `packages/domain-tenant/src/usecase/provision-admin-client.ts:44-57`                                            |
| `provisionAdminClient`'s only callers are tenant creation and `seed admin`                                           | `grep -rn "provisionAdminClient(" packages apps --include='*.ts'`                                               |
| The view-layer header walk exempts exactly two files                                                                 | `packages/protocol-oidc/src/view/html-response.test.ts:17`                                                      |
| There is no tenant delete route                                                                                      | `ADMIN_ROUTES`, `capability.ts:208-235`                                                                         |
| No admin route clears a brute-force lockout                                                                          | `grep -n "lockout" docs/admin-paths.md`; `login_failures` is read only by `domain-identity`                     |
| RFC 10017 recommends a BFF for sensitive browser applications                                                        | https://oauth.net/2/browser-based-apps/                                                                         |
| React 19.3 is current, released 2026-09-09                                                                           | https://react.dev/blog/2026/09/09/react-19-3                                                                    |
