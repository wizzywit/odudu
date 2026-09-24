# Admin paths

The admin API: the endpoints under `/admin/tenants/{tenant}/` that let an
operator manage a tenant instead of reaching for `psql`.

Three artifacts describe this API and each has one job. The published
OpenAPI document, served unauthenticated at `/admin/openapi.json`, is the
**reference** — generated, and the place every endpoint and every field is
listed exhaustively. This document is the **narrative** — an operator's
journey through a task, in the order they would actually hit it, with the
shape of each request and, once a live stack has been brought up to capture
it against, the real response. [README.md](../README.md) is the **entry
point** — how to get a token that can call any of this at all.

There is one "What is not implemented" list for the whole server, and it
stays in [docs/request-paths.md](request-paths.md#what-is-not-implemented);
this document never starts a second one. An admin endpoint that does not do
yet what its name suggests says so in its own section below, and points at
that list rather than duplicating it.

This document holds two kinds of section. One is captured against a live
stack and follows the same transcript discipline as
[docs/request-paths.md](request-paths.md): a fenced block holding a
response carries no language tag, a section whose output depends on the
state of the stack it ran against says which state, and a precondition a
refusal depends on is shown rather than asserted. The other is not yet
captured, and says so plainly — "the response shape, not a captured run" —
rather than presenting invented bytes as if they were real. Every section
below names which one it is.

## The shape of it

Most of the admin endpoint lives under `/admin/tenants/{tenant}/`, mirroring
the protocol surface's own `/tenants/{tenant}/` convention: the tenant being
administered is chosen by the URL. `/admin/tenants` itself is the one
exception — it has no `{tenant}` segment, because it administers the
collection of tenants rather than any one of them. The caller authenticates
with a bearer access token — the same kind `/token` mints for the protocol
surface — sent as `Authorization: Bearer …`. Two authorities can hold one:

- **A tenant-local admin.** A subject in the target tenant itself, holding
  a capability role on that tenant's built-in admin client. Reaches this
  tenant's `/admin/tenants/{tenant}/**` and nothing else — there is no
  tenant-local view of `/admin/tenants`, since a tenant-local admin already
  knows which tenant they administer.
- **A system admin.** A subject in the `system` tenant, holding
  `manage-tenants`. Reaches every tenant's `/admin/tenants/{tenant}/**`,
  plus `/admin/tenants` itself. `manage-tenants` authorizes the hop into
  another tenant and nothing more: the route's own capability is checked
  after it, on the same `system` admin client, so reading another tenant's
  subjects takes `manage-tenants` **and** `view-users`, amending its
  settings `manage-tenants` **and** `manage-tenant`, and so on — a system
  admin carrying only `manage-tenants` is refused with `403` by every route
  that names a capability of its own (`authorizeAdmin`,
  `packages/protocol-admin/src/usecase/authorize-admin.ts`). `/admin/tenants`
  and `whoami` are what it reaches alone: the first names `manage-tenants`
  as its own capability, the second names none.

Either way, the token must carry an `aud` naming this admin API,
`urn:odudu:params:admin-api` — an ordinary access token minted for the
protocol surface does not authorize anything here — and the request is refused if the grant behind the token
has been revoked, its session has ended, or its client has since been
disabled. A `client_credentials` token has no session behind it, and is
refused only on the other two counts. `docs/superpowers/specs/2026-09-24-p4c-admin-api-design.md`
section 7 has the full authentication and authorization sequence; getting
a token to test with is [README.md](../README.md)'s job, not this
document's.

| Method   | Path                                                             | What it is                       |
| -------- | ---------------------------------------------------------------- | -------------------------------- |
| `GET`    | `/admin/tenants`                                                 | List tenants                     |
| `POST`   | `/admin/tenants`                                                 | Create a tenant                  |
| `GET`    | `/admin/tenants/{tenant}/whoami`                                 | Identity probe                   |
| `GET`    | `/admin/tenants/{tenant}/subjects`                               | List subjects                    |
| `POST`   | `/admin/tenants/{tenant}/subjects`                               | Create a subject                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id`                           | Read a subject                   |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id`                           | Amend a subject                  |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id`                           | Delete a subject                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/credentials`               | List a subject's credentials     |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/credentials/:credentialId` | Remove a credential              |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Set a subject's required actions |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Replace a subject's roles        |
| `GET`    | `/admin/tenants/{tenant}/settings`                               | Read a tenant's settings         |
| `PATCH`  | `/admin/tenants/{tenant}/settings`                               | Amend a tenant's settings        |
| `GET`    | `/admin/tenants/{tenant}/clients`                                | List clients                     |
| `POST`   | `/admin/tenants/{tenant}/clients`                                | Create a client                  |
| `GET`    | `/admin/tenants/{tenant}/clients/:id`                            | Read a client                    |
| `PATCH`  | `/admin/tenants/{tenant}/clients/:id`                            | Amend a client                   |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id`                            | Delete a client                  |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/secret`                     | Rotate a client's secret         |
| `GET`    | `/admin/openapi.json`                                            | The OpenAPI reference            |

## `GET /admin/tenants`

Lists tenants — every one, the `system` tenant included: hiding it would
make the one tenant an operator most needs to inspect the one they cannot.
Requires `manage-tenants`, which only a system admin holds, so this is the
one collection with no tenant-local view. Pages by an opaque cursor, `?limit=`
and `?cursor=`, ordered by `id`; a further page is announced by a
`Link: rel="next"` header and a `next` member in the body, both absent once
the collection fits in one page. The response carries no total.

A request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?limit=50"
```

The response shape, not a captured run — a live stack replaces this with
the real bytes, including real ids:

```json
{
  "items": [
    {
      "id": "<tenant id>",
      "name": "system",
      "display_name": "System",
      "enabled": true,
      "created_at": "<timestamp>"
    }
  ]
}
```

## `POST /admin/tenants`

Creates a tenant: the row, its browser authentication flow
(`provisionTenant`, `@odudu/authn-flows`) and its built-in admin client
(`provisionAdminClient`, `@odudu/protocol-oidc`) in one call, so a tenant
this endpoint returns is one an operator can immediately provision an admin
for. `manage-tenants` is required, the same as the listing above. The name
`system` is refused with `409` — reserved for the tenant this API itself
administers from — rather than left to surface as a unique-index conflict;
`odudu seed tenant --name system` is refused for the identical reason
(`refuseSystemTenantName`, `apps/server/src/cli/seed.ts`), as is
`seed({ tenant: 'system', … })`, the options form of the same command. A
name another tenant already holds is refused with `409` too — under
row-level security a tenant carrying it is not visible to this call, so the
unique index is what answers, mapped to the same shape rather than left to
surface as a `500`.

A request shape:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "acme", "display_name": "Acme"}' \
  http://localhost:3000/admin/tenants
```

The response shape, not a captured run — `201` with the created tenant:

```json
{
  "id": "<tenant id>",
  "name": "acme",
  "display_name": "Acme",
  "enabled": true,
  "created_at": "<timestamp>"
}
```

## `GET /settings` and `PATCH /settings`

The 28 columns `tenants` carries beyond identity — everything
`odudu seed tenant --set` can already change — read and amended through one
map, `@odudu/domain-tenant`'s `SETTINGS`
(`packages/domain-tenant/src/service/tenant-settings.ts`): a name a caller
writes and a column a migration owns, never restated a second time. Ranges
are not in that map — they are `CHECK` constraints on `tenants`, so a value
outside one is refused by the database itself, not by a second copy of the
rule here.

Requires `manage-tenant` on the tenant named in the path — a tenant-local
admin's own capability, so a system admin reaches it only by also holding
that role there, `manage-tenants` alone is not enough. A `GET`
carries an `ETag` over the settings as they stand. A `PATCH` may carry
`If-Match`: absent, the write proceeds unconditionally; present and stale,
the request is refused with `412` and nothing is changed — the concurrency
control every amending endpoint in this API shares. The row is locked for
the rest of the amending transaction before its current `ETag` is computed,
so two `PATCH`es sent at once are serialised: the second reads what the
first wrote and its `If-Match` is stale, rather than both matching the same
pre-write row and the later write replacing the earlier one unseen.

A request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/settings
```

The response shape, not a captured run — `200`, an `ETag` header, and every
setting by name:

```json
{
  "display_name": null,
  "enabled": true,
  "registration_allowed": false,
  "verify_email": false,
  "reset_password_allowed": false,
  "sso_session_idle_seconds": 1800,
  "sso_session_max_seconds": 36000,
  "password_min_length": 8,
  "password_require_digit": false,
  "password_require_uppercase": false,
  "password_require_lowercase": false,
  "password_require_special": false,
  "password_not_username": true,
  "password_not_email": true,
  "password_history_depth": 0,
  "password_max_age_days": 0,
  "otp_required": false,
  "brute_force_max_failures": 5,
  "brute_force_lockout_seconds": 60,
  "brute_force_max_lockout_seconds": 900,
  "brute_force_failure_reset_seconds": 43200,
  "client_registration_policy": "disabled",
  "max_clients": 200,
  "max_sessions_per_browser": 25,
  "remember_me_allowed": false,
  "remember_me_idle_seconds": 604800,
  "remember_me_max_seconds": 2592000
}
```

Amending sends only the settings that change:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_email": true, "password_min_length": 14}' \
  http://localhost:3000/admin/tenants/demo/settings
```

The response shape, not a captured run — `200` and the full settings object
as it now reads, an `ETag` for the next `If-Match`:

```json
{ "verify_email": true, "password_min_length": 14, "…every other setting…": "…" }
```

A name this map does not know is refused with `400`, naming the settings it
does. A value the map itself coerces but the database's `CHECK` still
refuses — `password_min_length` outside `8..256`, for instance — is also
`400`, naming the setting rather than the constraint that fired: the
database stays the one authority for the range, and the caller still learns
which value it refused. A setting's value may be sent as its JSON type
(`true`, `14`) or as the equivalent string (`"true"`, `"14"`) — both reach
the same `coerceTenantSetting` the CLI uses, which reads a string either
way.

## `GET /clients`, `POST /clients` and `GET /clients/{id}`

Lists, reads and creates clients — the `clients` row and its OIDC
configuration (`client_oidc_config`), joined into one resource keyed by the
client's internal id (`{id}` above is that id, not the OAuth `client_id`
string a token request names). Requires `manage-clients` throughout: there
is no `view-clients`, because client metadata is configuration rather than
a population to browse. A `GET` on a single client carries an `ETag`, which
`PATCH /clients/{id}` below reads back through `If-Match`.

A create body names `client_id` — chosen by the operator, unlike RFC 7591
dynamic registration (`clients-registrations/openid-connect`,
[docs/request-paths.md](request-paths.md#dynamic-client-registration))
where the server assigns it — plus the same RFC 7591 client metadata dynamic
registration accepts, narrowed by the identical validator
(`parseClientMetadata`, `packages/protocol-oidc/src/service/client-metadata.ts`):
a `redirect_uris` entry it rejects, or `jwks` and `jwks_uri` sent together,
is refused here with the identical `400` detail. `odudu-admin` is refused
as a `client_id` with `409` — reserved for the built-in admin client every
tenant is provisioned with, and creation is a door dynamic registration
never opens to it in the first place, since RFC 7591 §2 already assigns
`client_id` there and refuses a caller that names one itself. A `client_id`
that collides with an existing client in the tenant is refused the same
way, also `409`, rather than surfacing as the database's own unique-index
violation.

A tenant at its `max_clients` cap (`GET`/`PATCH /settings` above) refuses
creation here with `403`, the same cap `registerClient`'s own
`lockCapacity` enforces for dynamic registration — `manage-clients` and
`manage-tenant`, which sets the cap, are different capabilities, so this
door locks and counts for itself rather than trusting the two to be held
together.

Every client created through this door is recorded as
`registration_origin: "operator"` — distinct from the CLI's `"seeded"`, RFC
7591 open registration's `"anonymous"` and a registration token's
`"token"` — so the four ways a client came to exist stay told apart in the
one column that records it.

A confidential client (`token_endpoint_auth_method` anything but `none`) is
given a generated secret, returned **exactly once, in the creation
response**. Nothing reads it back afterward — `clients.secret_hash` is the
only thing stored.

A request shape:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3000/admin/tenants/demo/clients
```

The response shape, not a captured run — `201`, the created client, and the
one-time secret:

```json
{
  "id": "<client id>",
  "client_id": "demo-backend",
  "name": "demo-backend",
  "type": "confidential",
  "enabled": true,
  "full_scope_allowed": false,
  "registration_origin": "operator",
  "created_at": "<timestamp>",
  "redirect_uris": [],
  "grant_types": ["client_credentials"],
  "token_endpoint_auth_method": "client_secret_basic",
  "client_secret": "<returned once, here only>",
  "…every other client field…": "…"
}
```

Listing pages the same way `GET /admin/tenants` does — `?limit=`, `?cursor=`,
ordered by `id`, a `Link: rel="next"` header and a `next` body member once a
further page exists, no total:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients?limit=50
```

Reading one client by its internal id carries an `ETag` and never the
secret, whether or not one was ever generated:

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/<client id>
```

## `PATCH /clients/{id}`

Amends the fields a general-purpose amendment can safely touch — every
column of `clients` and `client_oidc_config` except identity (`id`,
`client_id`, `tenant_id`), history (`created_at`), provenance
(`registration_origin`), the security-model switch (`type`), the secret
(rotated only through `POST /secret` below) and `builtin_admin` itself. A
field this excludes is refused with `400`, naming the field and the reason
(`refusalFor`, `packages/protocol-admin/src/service/client-patch.ts`) —
`client_id` answers "identity: changing it breaks every relying party and
orphans the azp of every issued token", for instance, not merely "refused".

A list field — `redirect_uris`, `post_logout_redirect_uris`, `web_origins`,
`audiences`, `grant_types`, `client_credentials_scopes` — is replaced
**wholesale**, never appended to: the body names the complete list the
field should hold afterward. Because last-write-wins on one of these
silently reinstates exactly what another admin just removed, `If-Match` is
**required** when a request touches any of the six, answered with
`428 Precondition Required` when it is missing;
every other field amends with `If-Match` optional, the same concurrency
control `PATCH /settings` uses, row lock included. A stale `If-Match` is
`412` either way, and nothing is changed.

The RFC 7591 metadata fields among them — `redirect_uris`, `grant_types`,
`token_endpoint_auth_method`, `jwks`, `jwks_uri`, the two logout URIs and
their `_session_required` flags, the three `userinfo_*` response fields,
and `tls_client_auth_subject_dn` — are revalidated through the same
`parseClientMetadata` a create body runs through, against the amended
value merged with what the client already holds: a `redirect_uris` entry
registration would refuse is refused here with the identical `400` detail,
and narrowing `grant_types` takes effect on the very next `/token` request,
since nothing about a grant type is cached anywhere between the two.

Amending `token_endpoint_auth_method` to a value on the other side of the
public/confidential boundary — `none` for a confidential client, or
anything else for a public one — is refused with `409`, naming the
client's current type and the type the new method implies: the same
concern `type` itself being unamendable exists for, reached through a
different field. `client_secret_basic`, `client_secret_post` and
`private_key_jwt` are always confidential and freely amendable into one
another; `tls_client_auth` joins them only when TLS client authentication
is enabled (`ODUDU_TRUST_PROXY`) — `parseClientMetadata` refuses it
otherwise, on a create or an amend alike. `none` is the only public
method.

The built-in admin client (`builtin_admin`) refuses three kinds of
amendment with `409`, each naming the client and the reason: disabling it
(`enabled: false`), and amending any of `grant_types`,
`token_endpoint_auth_method` or `redirect_uris` — the fields that could
lock every administrator out while the client stays enabled, the same
lockout `enabled: false` produces through a second door. The guard reads
the `builtin_admin` column, not `client_id`, so renaming the client does
not evade it. Every other field on the built-in client amends normally. An
**ordinary** admin-capable client carries no such guard and may be
disabled even by the caller whose own token runs through it — the built-in
client is the recovery path that makes that permissible.

A request shape — amending only the fields that change:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: \"<etag from a GET>\"" \
  -d '{"grant_types": ["client_credentials"]}' \
  http://localhost:3000/admin/tenants/demo/clients/<client id>
```

The response shape, not a captured run — `200`, the amended client, and a
fresh `ETag` for the next `If-Match`:

```json
{ "grant_types": ["client_credentials"], "…every other client field…": "…" }
```

## `DELETE /clients/{id}`

Deletes the client and its OIDC configuration in one statement — the
foreign key from `client_oidc_config` to `clients` cascades, so nothing
here deletes the config row a second time. `204` with no body on success,
`404` for an id that does not exist, and the same `409` built-in-admin
guard `PATCH` uses: the built-in client cannot be deleted any more than it
can be disabled.

```bash
curl -sS -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/<client id>
```

## `POST /clients/{id}/secret`

Rotates a confidential client's secret: generates a fresh one, stores only
its hash, and returns the plaintext **exactly once, in this response** —
the same guarantee `POST /clients` makes for a client's first secret.
Nothing reads it back afterward, and the previous secret stops
authenticating at `/token` immediately, since only the current hash is ever
compared against. A public client (`token_endpoint_auth_method: "none"`)
has no secret to rotate, refused with `409`.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/<client id>/secret
```

The response shape, not a captured run — `200`, the client, and the new
secret:

```json
{ "client_secret": "<returned once, here only>", "…every other client field…": "…" }
```

## `GET /whoami`

The identity probe: what an operator reaches for when a token is not
working and they need to know what the server thinks it is, before
debugging anything else. It requires an authenticated caller and no
capability beyond that — any admin token good enough to reach this tenant's
admin surface at all can call it.

A request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

The response shape, not a captured run. Running this against a live stack
replaces it with the real bytes: the caller's own identity as
the server resolved it, `subjectId` (the token's `sub`) and
`issuerTenantId` (the tenant that issued the token, which for a system
admin calling into another tenant is `system`, not the tenant named in the
URL).

```json
{ "subjectId": "<subject id>", "issuerTenantId": "<tenant id>" }
```

## `GET /subjects`

Requires `view-users`. `manage-users` also reaches it: `provisionAdminClient`
(`packages/domain-tenant/src/usecase/provision-admin-client.ts`) composites
every `manage-*` role to its `view-*` counterpart through `role_composites`,
so a caller holding only `manage-users` already holds `view-users` by the
time `authorizeAdmin` resolves its effective roles — nothing in the route
special-cases it. Pages by an opaque cursor, `?limit=` and `?cursor=`,
ordered by `id`, the same convention every other listing in this API
follows. `?search=` filters by a username prefix; a subject with no `users`
row (`type: "service"`, provisioned for a confidential client's service
account) never matches one and is only ever reached by an unfiltered page.

A request shape:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?limit=50"
```

The response shape, not a captured run:

```json
{
  "items": [
    {
      "id": "<subject id>",
      "type": "user",
      "username": "ada",
      "email": "ada@example.com",
      "enabled": true,
      "created_at": "<timestamp>"
    }
  ]
}
```

## `POST /subjects`

Requires `manage-users`. Creates a `type: "user"` subject: the subject
itself, its `users` row and the tenant's `default_for_new_subjects` roles —
the same composition self-registration performs
(`composeUserSubject`, `packages/protocol-admin/src/usecase/subjects.ts`,
shared with `createAccount` in `apps/server/src/app.ts` so the two doors
cannot drift on what "a new subject" means). **There is no `password`
field**, and that is a rule, not an omission: creating a subject through
this door writes an `update-password` required action instead, so no
operator ever handles a user's password, and the created subject cannot
complete a login until an out-of-band channel sets one. A body carrying
`password` is refused with `400` before the usecase ever runs — Zod's
generated schema already sets `additionalProperties: false`.

A request shape:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada", "email": "ada@example.com"}' \
  http://localhost:3000/admin/tenants/demo/subjects
```

The response shape, not a captured run — `201`, the created subject:

```json
{
  "id": "<subject id>",
  "type": "user",
  "username": "ada",
  "email": "ada@example.com",
  "enabled": true,
  "created_at": "<timestamp>"
}
```

A username already in use answers `409`.

## `GET /subjects/:id`

Requires `view-users`, the same capability the listing does. Carries an
`ETag` computed over the response body, the same convention every other
single-resource read in this API follows; an unknown id answers `404`.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/<subject id>
```

## `PATCH /subjects/:id`

Requires `manage-users`. Amends `email` and `enabled` — the only two
general fields a subject exposes; everything else about a subject
(credentials, required actions, roles) has its own door below. Honours
`If-Match`, answering `412` on a mismatch, the same convention every other
amendment in this API follows — locked with `SELECT … FOR UPDATE` before
the `ETag` is computed, so two concurrent amendments cannot both pass the
precondition.

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/subjects/<subject id>
```

## `DELETE /subjects/:id`

Requires `manage-users`. Removes the subject; every table that names one
(`users`, `user_credentials`, `sessions`, `token_grants`,
`subject_roles`, …) cascades, except a client whose service account named
it — `clients_service_subject_fk` (`packages/db/drizzle/0063_service_subject_fk.sql`)
detaches the client (`service_subject_id` goes `null`) rather than failing
or deleting it. An unknown id answers `404`.

## `GET /subjects/:id/credentials`

Requires `view-users`. Metadata only — `type`, `created_at`, and, for a
`password` credential, whether it is expired under the tenant's
`password_max_age_days`. Never a hash, never `secret_data`: the response is
built from an explicit field list, so a column added to `user_credentials`
later is absent by default rather than exposed by default.
`recovery-code` rows are collapsed into one entry carrying
`recovery_code_count` — ADR 0021 keeps a spent code's row, so a per-row
listing would answer "how many were ever issued" rather than "how many
still work"; that entry carries no `id`, since it names no single row a
caller could delete. `password-history` never appears: it is not a
credential a caller reads or deletes.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/<subject id>/credentials
```

The response shape, not a captured run:

```json
{
  "items": [
    { "type": "password", "created_at": "<timestamp>", "expired": false },
    { "type": "totp", "created_at": "<timestamp>" },
    { "type": "recovery-code", "created_at": "<timestamp>", "recovery_code_count": 7 }
  ]
}
```

## `DELETE /subjects/:id/credentials/:credentialId`

Requires `manage-users`. Removes one credential — a TOTP enrolment or a
WebAuthn credential, most operationally — so the subject's next login no
longer offers or requires it. Refuses a `password` or `password-history`
row with `409`: a password has its own rotation surface, never a bare
delete, and history is not a credential this door exposes at all. An
unknown id, or one belonging to a different subject, answers `404`.

## `PUT /subjects/:id/required-actions`

Requires `manage-users`. Sets a subject's required actions wholesale — an
action left out of the list is one the caller clears, not one left alone.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"actions": ["configure-totp"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/<subject id>/required-actions
```

## `PUT /subjects/:id/roles`

Requires `manage-users`, and enforces a capability ceiling beyond it: a
caller may never assign authority it does not itself hold. The requested
role set and the caller's own are each expanded through `role_composites`
to the admin-client capability names they actually grant — not merely the
role names given — before the comparison, so a role that nests
`tenant-admin` rather than naming it cannot smuggle the assignment past a
name check. A caller whose expanded set is not a subset of its own is
refused with `403`; this is what stops `manage-users` alone from assigning
`tenant-admin` — or `manage-tenants` in the system tenant — to any subject,
itself included (CWE-269). Replaces the subject's role assignments
wholesale, the same convention `required-actions` follows: a role left out
is one the caller clears, and stops appearing in the subject's
`effectiveRoles` immediately.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role_ids": ["<role id>"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/<subject id>/roles
```

## `GET /admin/openapi.json`

The reference this document points at: an OpenAPI 3.1 description of every
route above, generated from the same route table the router registers from,
so the two cannot drift. It takes no `{tenant}` — it describes the API
rather than reaching into one — and is served without authentication, since
a client that cannot read it cannot generate against it:

```bash
curl -sS http://localhost:3000/admin/openapi.json
```

Every other endpoint in it requires a bearer token whose `aud` names
`urn:odudu:params:admin-api`, declared as this document's `bearerAuth`
security scheme.

## What to do next, from wherever you are

**From here, for anything this document does not yet cover** — creating a
client, rotating a signing key, editing a tenant's authentication flow —
[docs/request-paths.md](request-paths.md) is where the rest of the server's
behaviour is documented, and its own "What to do next" section covers the
protocol surface this API sits beside.
