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

Every transcript below is captured output, and follows the same discipline
as [docs/request-paths.md](request-paths.md): a fenced block holding a
response carries no language tag, a section whose output depends on the
state of the stack it ran against says which state, and a precondition a
refusal depends on is shown rather than asserted.

**The stack.** One run of `infra/docker/compose.yaml`, brought up from an
empty volume, with `odudu seed admin --username ada` run against it and a
tenant named `demo` created through `POST /admin/tenants` below. The
sections are in the order they were executed, so the ids, secrets, `ETag`s
and timestamps in them are one run's real ones and refer to each other:
`demo` is `01a0d6fc-3626-7e23-94d7-3b1b666e278f`, `ada` in the `system`
tenant is subject `01a0d6fb-0918-7846-b430-0a714b8bf7bf`. Secrets shown
here are that stack's, and it was torn down with `docker compose down -v`
when the capture finished.

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
section 7 has the full authentication and authorization sequence;
[README.md](../README.md) explains why the built-in admin client is shaped
the way it is, and "Getting the token" below is the run every transcript
here used.

| Method   | Path                                                             | What it is                                |
| -------- | ---------------------------------------------------------------- | ----------------------------------------- |
| `GET`    | `/admin/tenants`                                                 | List tenants                              |
| `POST`   | `/admin/tenants`                                                 | Create a tenant                           |
| `GET`    | `/admin/tenants/{tenant}/whoami`                                 | Identity probe                            |
| `GET`    | `/admin/tenants/{tenant}/subjects`                               | List subjects                             |
| `POST`   | `/admin/tenants/{tenant}/subjects`                               | Create a subject                          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id`                           | Read a subject                            |
| `PATCH`  | `/admin/tenants/{tenant}/subjects/:id`                           | Amend a subject                           |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id`                           | Delete a subject                          |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/credentials`               | List a subject's credentials              |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/credentials/:credentialId` | Remove a credential                       |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/required-actions`          | Set a subject's required actions          |
| `PUT`    | `/admin/tenants/{tenant}/subjects/:id/roles`                     | Replace a subject's roles                 |
| `GET`    | `/admin/tenants/{tenant}/subjects/:id/sessions`                  | List a subject's live sessions            |
| `DELETE` | `/admin/tenants/{tenant}/subjects/:id/sessions/:sid`             | End one session                           |
| `GET`    | `/admin/tenants/{tenant}/settings`                               | Read a tenant's settings                  |
| `PATCH`  | `/admin/tenants/{tenant}/settings`                               | Amend a tenant's settings                 |
| `GET`    | `/admin/tenants/{tenant}/clients`                                | List clients                              |
| `POST`   | `/admin/tenants/{tenant}/clients`                                | Create a client                           |
| `GET`    | `/admin/tenants/{tenant}/clients/:id`                            | Read a client                             |
| `PATCH`  | `/admin/tenants/{tenant}/clients/:id`                            | Amend a client                            |
| `DELETE` | `/admin/tenants/{tenant}/clients/:id`                            | Delete a client                           |
| `POST`   | `/admin/tenants/{tenant}/clients/:id/secret`                     | Rotate a client's secret                  |
| `GET`    | `/admin/tenants/{tenant}/roles`                                  | List roles                                |
| `POST`   | `/admin/tenants/{tenant}/roles`                                  | Create a role                             |
| `GET`    | `/admin/tenants/{tenant}/roles/:id`                              | Read a role                               |
| `PATCH`  | `/admin/tenants/{tenant}/roles/:id`                              | Amend a role                              |
| `DELETE` | `/admin/tenants/{tenant}/roles/:id`                              | Delete a role                             |
| `POST`   | `/admin/tenants/{tenant}/roles/:id/composites`                   | Add a role composite                      |
| `GET`    | `/admin/tenants/{tenant}/groups`                                 | List groups                               |
| `POST`   | `/admin/tenants/{tenant}/groups`                                 | Create a group                            |
| `GET`    | `/admin/tenants/{tenant}/groups/:id`                             | Read a group                              |
| `PATCH`  | `/admin/tenants/{tenant}/groups/:id`                             | Amend a group (reparent)                  |
| `DELETE` | `/admin/tenants/{tenant}/groups/:id`                             | Delete a group                            |
| `PUT`    | `/admin/tenants/{tenant}/groups/:id/roles`                       | Replace a group's roles                   |
| `GET`    | `/admin/tenants/{tenant}/scopes`                                 | List client scopes                        |
| `POST`   | `/admin/tenants/{tenant}/scopes`                                 | Create a client scope                     |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id`                             | Read a client scope                       |
| `PATCH`  | `/admin/tenants/{tenant}/scopes/:id`                             | Amend a client scope                      |
| `DELETE` | `/admin/tenants/{tenant}/scopes/:id`                             | Delete a client scope                     |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/roles`                       | Replace a scope's roles                   |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/clients/:clientId`           | Assign a scope to a client                |
| `GET`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                     | Read a scope's claim mapper bindings      |
| `PUT`    | `/admin/tenants/{tenant}/scopes/:id/mappers`                     | Replace a scope's claim mapper bindings   |
| `GET`    | `/admin/tenants/{tenant}/keys`                                   | List signing keys                         |
| `POST`   | `/admin/tenants/{tenant}/keys`                                   | Stage a signing key                       |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/promote`                       | Promote a signing key                     |
| `POST`   | `/admin/tenants/{tenant}/keys/:id/retire`                        | Retire a signing key                      |
| `GET`    | `/admin/tenants/{tenant}/flow/executions`                        | Read a tenant's authentication flow       |
| `PUT`    | `/admin/tenants/{tenant}/flow/executions`                        | Replace a tenant's authentication flow    |
| `GET`    | `/admin/tenants/{tenant}/smtp`                                   | Read a tenant's own SMTP configuration    |
| `PUT`    | `/admin/tenants/{tenant}/smtp`                                   | Replace a tenant's own SMTP configuration |
| `POST`   | `/admin/tenants/{tenant}/smtp/test`                              | Send one test message                     |
| `GET`    | `/admin/tenants/{tenant}/audit`                                  | List the tenant's audit trail             |
| `GET`    | `/admin/openapi.json`                                            | The OpenAPI reference                     |

## Getting the token

`odudu seed admin` creates the `system` tenant, its `odudu-admin` client
and its signing key, and a subject holding `tenant-admin` there — which
composites every capability plus `manage-tenants`, so this one subject
reaches every route in the table above, in every tenant.

```bash
docker compose exec -T odudu node dist/main.js seed admin --username ada
```

```
qVWBqjTLZBlCgwfqTnFD7hWEURGc8yQ6
This password is shown once and cannot be retrieved again.
{"command":"admin","tenantId":"0199aa00-0000-7000-8000-000000000001","username":"ada","subjectId":"01a0d6fb-0918-7846-b430-0a714b8bf7bf"}
```

The subject is created with an `update-password` required action, so the
first `authorize`/login round trip does not end in a redirect. It ends on
the change-password page, whose form carries the same `auth_session_id`
the login form did:

```
<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Change your password</title></head>
<body>
<h1>Change your password</h1>
<p>This account needs a new password before you can continue.</p>
<form method="post" action="/tenants/system/login-actions/required-action?action=update-password">
  <input type="hidden" name="auth_session_id" value="01a0d6fb-45c9-750b-b189-c0f12cfed7b9">
  <label>New password <input type="password" name="password" autocomplete="new-password"></label>
  <button type="submit">Update password</button>
</form>
</body>
</html>
```

Submitting it **returns the sign-in page, not the redirect** — clearing the
action leaves the authentication session to be completed from the start,
with the new password:

```bash
curl -sS -c jar -b jar \
  --data-urlencode "auth_session_id=01a0d6fb-45c9-750b-b189-c0f12cfed7b9" \
  --data-urlencode 'password=correct-horse-battery-staple-9' \
  'http://localhost:3000/tenants/system/login-actions/required-action?action=update-password'

curl -sS -D - -c jar -b jar \
  --data-urlencode "auth_session_id=01a0d6fb-45c9-750b-b189-c0f12cfed7b9" \
  --data-urlencode 'username=ada' \
  --data-urlencode 'password=correct-horse-battery-staple-9' \
  'http://localhost:3000/tenants/system/login-actions/authenticate'
```

```
HTTP/1.1 302 Found
set-cookie: system-session=01a0d6fb-a6c4-778d-90fb-d682fa5b0b5a; HttpOnly; SameSite=Lax; Path=/
location: http://127.0.0.1:8080/callback?code=bloWwM1eqh9sRGtzxgsJDgLoEHz3zAwz-Nu9zIM-zLA&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fsystem
```

The code redeems at `/token` the way any `authorization_code` does. The
access token's `aud` carries `urn:odudu:params:admin-api` **without the
request asking for it** — it comes from the client's own registered
`audiences`, which `provisionAdminClient` sets, so no `resource` parameter
is involved. The block below is that token's payload, base64url-decoded and
indented — it is the one place here where what is shown is not the bytes on
the wire, because the bytes on the wire are a signed JWT:

```
{
  "iss": "http://localhost:3000/tenants/system",
  "sub": "01a0d6fb-0918-7846-b430-0a714b8bf7bf",
  "aud": ["urn:odudu:params:admin-api", "http://localhost:3000/tenants/system"],
  "client_id": "odudu-admin",
  "scope": "openid",
  "iat": 1790313220,
  "exp": 1790313520,
  "jti": "01a0d6fb-c892-746e-9a30-903b33b02697",
  "sid": "01a0d6fb-a6c4-778d-90fb-d682fa5b0b5a",
  "grant_id": "01a0d6fb-c892-746e-9a30-903a020bafe9"
}
```

`expires_in` is 300 seconds, so a capture session longer than five minutes
refreshes with the `refresh_token` the same response carried. The probe
that says the token works at all:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/system/whoami
```

```
{"subjectId":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","issuerTenantId":"0199aa00-0000-7000-8000-000000000001"}
```

## `GET /admin/tenants`

Lists tenants — every one, the `system` tenant included: hiding it would
make the one tenant an operator most needs to inspect the one they cannot.
Requires `manage-tenants`, which only a system admin holds, so this is the
one collection with no tenant-local view. Pages by an opaque cursor, `?limit=`
and `?cursor=`, ordered by `id`; a further page is announced by a
`Link: rel="next"` header and a `next` member in the body, both absent once
the collection fits in one page. The response carries no total.

```bash
curl -sS \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants?limit=50"
```

Captured after `POST /admin/tenants` below had created `demo`, so both
tenants this stack ever held are in it — the collection fits one page, and
there is no `next`:

```
{"items":[{"id":"0199aa00-0000-7000-8000-000000000001","name":"system","display_name":"System","enabled":true,"created_at":"2026-09-25T05:12:51.138Z"},{"id":"01a0d6fc-3626-7e23-94d7-3b1b666e278f","name":"demo","display_name":"Demo","enabled":true,"created_at":"2026-09-25T05:14:08.294Z"}]}
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

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $SYSTEM_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "demo", "display_name": "Demo"}' \
  http://localhost:3000/admin/tenants
```

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"01a0d6fc-3626-7e23-94d7-3b1b666e278f","name":"demo","display_name":"Demo","enabled":true,"created_at":"2026-09-25T05:14:08.294Z"}
```

Both refusals, against that same stack — the reserved name, then the name
the call above had just taken:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"system\" is reserved","instance":"01a0d6ff-87ec-7a40-b65e-a2b6205f4428"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the name \"demo\" is already in use","instance":"01a0d6ff-87ff-7621-bf57-d9d1cdf24dfd"}
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

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/settings
```

Captured against `demo` as `POST /admin/tenants` had just created it, so
every value but `display_name` is the migration's own default:

```
HTTP/1.1 200 OK
etag: "6aa9aa25fbfe79b1d0b8a345d33642eab1ebd60ce5e3a3f4500a3c8002aa81b2"
content-type: application/json; charset=utf-8

{"display_name":"Demo","enabled":true,"registration_allowed":false,"verify_email":false,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":8,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90}
```

Amending sends only the settings that change, and the response is the whole
object as it now reads, with a fresh `ETag` for the next `If-Match`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_email": true, "password_min_length": 14}' \
  http://localhost:3000/admin/tenants/demo/settings
```

```
HTTP/1.1 200 OK
etag: "3f8b0bb2e9d80ce1a85d8ca2c4a24d29781110ff96090e5af2baa2a1be4f2f31"
content-type: application/json; charset=utf-8

{"display_name":"Demo","enabled":true,"registration_allowed":false,"verify_email":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":14,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90}
```

A name this map does not know is refused with `400`, naming the settings it
does — which is also the one place the whole vocabulary is listed by the
server itself:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown tenant setting \"nonesuch\"; expected one of display_name, enabled, registration_allowed, verify_email, reset_password_allowed, sso_session_idle_seconds, sso_session_max_seconds, password_min_length, password_require_digit, password_require_uppercase, password_require_lowercase, password_require_special, password_not_username, password_not_email, password_history_depth, password_max_age_days, otp_required, brute_force_max_failures, brute_force_lockout_seconds, brute_force_max_lockout_seconds, brute_force_failure_reset_seconds, client_registration_policy, max_clients, max_sessions_per_browser, remember_me_allowed, remember_me_idle_seconds, remember_me_max_seconds, audit_retention_days","instance":"01a0d6fc-3690-7dd6-b489-cd6055a38719"}
```

A value the map itself coerces but the database's `CHECK` still
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

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3000/admin/tenants/demo/clients
```

`201`, the whole client, the tenant's default scope assignments, and the
one-time secret. The `scopes` ids are `demo`'s own, created with the tenant
above:

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":true,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-25T05:14:53.164Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0d6fc-3628-7829-8b29-5697c271d92e","name":"openid","assignment":"default"},{"id":"01a0d6fc-3629-7e64-a89c-2804355f56cf","name":"profile","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0ed3f11a86","name":"email","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0f8bb7530a","name":"address","assignment":"default"},{"id":"01a0d6fc-362b-7e0c-8a4d-4d3d27f20576","name":"phone","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af72e19f1886","name":"roles","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af737fd4358b","name":"groups","assignment":"default"},{"id":"01a0d6fc-362d-7533-bab9-7ea5ea57ba8d","name":"offline_access","assignment":"optional"}],"client_secret":"8ifZC73Id0zHBaQ05QgjVsKl7fTaMHPo6_M92X-Zp1A"}
```

`client_secret` is the only member of that object nothing reads back. Note
what is **not** there: `builtin_admin`. The column the disable and delete
guards below read is not part of a client's representation, so the psql
listing under `PATCH /clients/{id}` is what shows it.

The reserved `client_id`, refused against the same tenant:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the client_id \"odudu-admin\" is reserved","instance":"01a0d6ff-8816-7f15-827d-118b7b6ee5ed"}
```

Listing pages the same way `GET /admin/tenants` does — `?limit=`, `?cursor=`,
ordered by `id`, a `Link: rel="next"` header and a `next` body member once a
further page exists, no total. On this stack the page held two clients, the
tenant's own `odudu-admin` and `demo-backend` above:

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
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
HTTP/1.1 200 OK
etag: "721f3544b87c2a93b0160b4b51e95eb0c5107d77fd31fa39a41d1b4afba7907c"
content-type: application/json; charset=utf-8
content-length: 1594
```

The create response above was 1656 bytes and this one is 1594: the
difference is the secret, present there and absent here.

## `PATCH /clients/{id}`

Requires `manage-clients`, as every client route does. Amends the fields a
general-purpose amendment can safely touch — every
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

Amending a list field without `If-Match`, and amending a field the
exclusion list names — the refusal carries the reason, not just the
refusal:

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to amend redirect_uris","instance":"01a0d703-3447-7e19-b584-95b550fd90b0"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"client_id: identity: changing it breaks every relying party and orphans the azp of every issued token","instance":"01a0d703-345c-74db-9618-d6bc257b82af"}
```

The revalidation is not a formality. `demo-backend` was created with
`grant_types: ["client_credentials"]` and no `redirect_uris`; widening the
grants alone, with a good `If-Match`, is refused, because the merged
metadata no longer satisfies the rule that excused the empty list:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "721f3544b87c2a93b0160b4b51e95eb0c5107d77fd31fa39a41d1b4afba7907c"' \
  -d '{"grant_types": ["client_credentials","refresh_token"]}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris is required unless grant_types is exactly [\"client_credentials\"]","instance":"01a0d703-346f-7951-8f22-3840777b824f"}
```

An amendment that does pass, with that same `ETag`, and the fresh one it
returns:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H 'If-Match: "721f3544b87c2a93b0160b4b51e95eb0c5107d77fd31fa39a41d1b4afba7907c"' \
  -d '{"audiences": ["https://api.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
HTTP/1.1 200 OK
etag: "0d54739bab7b13288c3d6e04be6b179c7cb2303e5d720a864235a643f1e7ef3e"
content-type: application/json; charset=utf-8
content-length: 1620
```

Replaying the identical request — same `If-Match`, now one generation
stale — is refused and changes nothing:

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a0d703-349d-786d-9fc1-ac4631a105f5"}
```

**The two `409`s that disabling produces are told apart by one column, and
the admin API does not expose it**, so it is read from the database beside
them rather than asserted. The three clients are `demo`'s own built-in one,
`demo-backend` above, and `demo-app`, which the sessions section below
creates:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select client_id, builtin_admin, enabled from clients
     where tenant_id = '01a0d6fc-3626-7e23-94d7-3b1b666e278f' order by client_id;"
```

```
  client_id   | builtin_admin | enabled
--------------+---------------+---------
 demo-app     | f             | t
 demo-backend | f             | t
 odudu-admin  | t             | t
(3 rows)
```

`demo-backend`, `builtin_admin` false, disables — and the response is the
whole client, so `enabled` can be read back from it:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
{"id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-25T05:14:53.164Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0d6fc-3628-7829-8b29-5697c271d92e","name":"openid","assignment":"default"},{"id":"01a0d6fc-3629-7e64-a89c-2804355f56cf","name":"profile","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0ed3f11a86","name":"email","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0f8bb7530a","name":"address","assignment":"default"},{"id":"01a0d6fc-362b-7e0c-8a4d-4d3d27f20576","name":"phone","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af72e19f1886","name":"roles","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af737fd4358b","name":"groups","assignment":"default"},{"id":"01a0d6fc-362d-7533-bab9-7ea5ea57ba8d","name":"offline_access","assignment":"optional"}]}
```

`odudu-admin`, `builtin_admin` true, the same request against the other id
in that listing, does not:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-3632-7d66-b7c1-71695bd9e71f
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be disabled","instance":"01a0d703-358b-7e86-8398-16a5d3936196"}
```

## `DELETE /clients/{id}`

Requires `manage-clients`. Deletes the client and its OIDC configuration in
one statement — the
foreign key from `client_oidc_config` to `clients` cascades, so nothing
here deletes the config row a second time. `204` with no body on success,
`404` for an id that does not exist, and the same `409` built-in-admin
guard `PATCH` uses: the built-in client cannot be deleted any more than it
can be disabled.

All three outcomes against `demo`, in that order: the built-in client, an
id nothing holds, then `demo-backend`. A `404` carries no `detail` at all,
only the status and the request id:

```bash
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be deleted","instance":"01a0d708-7b5e-7443-b462-7af170e24808"}
{"type":"about:blank","title":"Not Found","status":404,"instance":"01a0d708-7b71-7e3b-8a95-a58ed9456ef2"}

HTTP/1.1 204 No Content
x-request-id: 01a0d708-7b86-7dfe-9913-5ea326976017
```

## `POST /clients/{id}/secret`

Requires `manage-clients`. Rotates a confidential client's secret: generates a fresh one, stores only
its hash, and returns the plaintext **exactly once, in this response** —
the same guarantee `POST /clients` makes for a client's first secret.
Nothing reads it back afterward, and the previous secret stops
authenticating at `/token` immediately, since only the current hash is ever
compared against. A public client (`token_endpoint_auth_method: "none"`)
has no secret to rotate, refused with `409`.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/01a0d6fc-e5b4-73d4-9162-e2a9893d64b0/secret
```

Captured immediately after the disable above, which is why `enabled` reads
`false` here: rotating a disabled client's secret is allowed, the guard
being on the built-in client rather than on a disabled one.

```
{"id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","client_id":"demo-backend","name":"demo-backend","type":"confidential","enabled":false,"full_scope_allowed":false,"registration_origin":"operator","created_at":"2026-09-25T05:14:53.164Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"scopes":[{"id":"01a0d6fc-3628-7829-8b29-5697c271d92e","name":"openid","assignment":"default"},{"id":"01a0d6fc-3629-7e64-a89c-2804355f56cf","name":"profile","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0ed3f11a86","name":"email","assignment":"default"},{"id":"01a0d6fc-362a-7075-bcf5-dd0f8bb7530a","name":"address","assignment":"default"},{"id":"01a0d6fc-362b-7e0c-8a4d-4d3d27f20576","name":"phone","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af72e19f1886","name":"roles","assignment":"default"},{"id":"01a0d6fc-362c-7c77-a383-af737fd4358b","name":"groups","assignment":"default"},{"id":"01a0d6fc-362d-7533-bab9-7ea5ea57ba8d","name":"offline_access","assignment":"optional"}],"client_secret":"_0B83ooNdhzevzQk9fj_7VuvRSFhldgaE6kdDd8Zy4Y"}
```

## `GET /whoami`

The identity probe: what an operator reaches for when a token is not
working and they need to know what the server thinks it is, before
debugging anything else. It requires an authenticated caller and no
capability beyond that — any admin token good enough to reach this tenant's
admin surface at all can call it.

It answers `subjectId` (the token's `sub`) and `issuerTenantId` — the
tenant that **issued** the token, not the tenant named in the URL. The
captured run is under "Getting the token" above, against
`/admin/tenants/system/whoami`; the same token against `demo` answers the
identical body, `issuerTenantId` still naming `system`:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
```

```
{"subjectId":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","issuerTenantId":"0199aa00-0000-7000-8000-000000000001"}
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

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/subjects?limit=50"
```

Three subjects by the time this ran, and the first is the point of the
paragraph above: `demo-backend`'s service account, created with the client
and carrying no `users` row, so `username` and `email` are `null` and
`?search=` would never return it. `ada` is `POST /subjects` below; `bob` is
the seeded user the sessions section needs:

```
{"items":[{"id":"01a0d6fc-e571-7685-b843-00be9303dd03","type":"service","username":null,"email":null,"enabled":true,"created_at":"2026-09-25T05:14:53.164Z"},{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":true,"created_at":"2026-09-25T05:15:37.939Z"},{"id":"01a0d6fd-ede7-704b-8d83-fa3801d427a0","type":"user","username":"bob","email":"bob@demo.example","enabled":true,"created_at":"2026-09-25T05:16:00.867Z"}]}
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

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"username": "ada", "email": "ada@demo.example"}' \
  http://localhost:3000/admin/tenants/demo/subjects
```

```
HTTP/1.1 201 Created
content-type: application/json; charset=utf-8

{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":true,"created_at":"2026-09-25T05:15:37.939Z"}
```

A body carrying `password` and a username already in use, in that order.
The first refusal is the generated schema's, so its `title` is the
framework's generic one rather than a `Bad Request` the usecase chose —
that is what "refused before the usecase ever runs" looks like from
outside:

```
{"type":"about:blank","title":"Error","status":400,"detail":"body must NOT have additional properties","instance":"01a0d6ff-882c-7a29-9f9d-84ab6c764a51"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the username \"ada\" is already in use","instance":"01a0d6ff-8837-7c5d-8b83-bc41dd9f6ced"}
```

## `GET /subjects/:id`

Requires `view-users`, the same capability the listing does. Carries an
`ETag` computed over the response body, the same convention every other
single-resource read in this API follows; an unknown id answers `404`.

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836
```

```
HTTP/1.1 200 OK
etag: "da3eb48382f6ee2d1dba5ab0257b85618325684e6073d398d382992fd751164c"
content-type: application/json; charset=utf-8

{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":true,"created_at":"2026-09-25T05:15:37.939Z"}
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
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836
```

```
HTTP/1.1 200 OK
etag: "e0aa2da695d68cf78750779f56f4003957282bd6a88ddab5b3aa117e2efa7a19"
content-type: application/json; charset=utf-8

{"id":"01a0d6fd-9453-7bf0-9823-a5fc6ea34836","type":"user","username":"ada","email":"ada@demo.example","enabled":false,"created_at":"2026-09-25T05:15:37.939Z"}
```

The `ETag` is the one `GET /subjects/:id` above returned, recomputed — a
caller that read before this write holds a stale one.

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
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836/credentials
```

Against `ada`, created through `POST /subjects` above, the list is empty —
and that is the rule the section states, seen from outside: a subject this
API creates has no password to list, only the `update-password` action
waiting for one.

```
{"items":[]}
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
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836/required-actions
```

The reply is the set as it now stands — and `ada` was created with
`update-password`, which this request cleared by leaving it out:

```
{"actions":["configure-totp"]}
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

The role came from `POST /roles` below:

```
{"id":"01a0d6fd-9471-7012-89c1-36ac3403705f","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-25T05:15:37.968Z"}
```

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role_ids": ["01a0d6fd-9471-7012-89c1-36ac3403705f"]}' \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-9453-7bf0-9823-a5fc6ea34836/roles
```

The response is the set as it now stands, by id and name:

```
{"items":[{"id":"01a0d6fd-9471-7012-89c1-36ac3403705f","name":"billing-viewer"}]}
```

## `GET /subjects/:id/sessions` and `DELETE /subjects/:id/sessions/:sid`

Both require `manage-sessions`; there is no `view-sessions`, the same
reasoning that leaves clients with no `view-clients` — a session is reached
only by an operator who can also end one.

`GET` lists the subject's **live** sessions — the same liveness arithmetic
every other session consumer applies, each session measured against the
idle window its own `remembered` column picks. This is the one read keyed
on the subject rather than on a browser's cookie, so it is also the one
place an operator can see a session the cookie no longer names — a second
concurrent login can orphan one, and a remembered orphan idles for
`remember_me_idle_seconds` before it stops appearing (ADR 0033's
amendment). Each entry carries `id`, `created_at`, `last_active_at`,
`remembered`, and `client_ids` — the OAuth `client_id` of every enabled
client the session holds a grant for. Paginated the same way every other
list in this API is: `?limit=` and `?cursor=`, a `Link: rel="next"` header
and a body `next` while more remain, ordered by `id` — a subject's sessions
are bounded per browser by `max_sessions_per_browser`, but unbounded across
however many browsers hold one, so this listing pages exactly like the
others rather than trusting that bound.

`DELETE` ends one session through the same call the RP-Initiated Logout
usecase makes (`endSession`, `packages/protocol-oidc/src/usecase/end-session.ts`) —
there is one path that ends a session, not two. It revokes every grant the
session holds and enqueues a Back-Channel Logout Token for each registered
client that used it and has a `backchannel_logout_uri` configured (§2.5 of
the spec). **Front-Channel Logout does not apply here**: §3 renders an
iframe per relying party in the End-User's own browser, and an
admin-initiated end has no browser to render one in, so only the
back-channel delivery is attempted. A second `DELETE` of the same session
is idempotent and answers `204`: ending an already-ended session only
moves `expires_at` earlier, and a repeat delivery for the same client is
deduped by `backchannel_logout_deliveries_dedupe`. "Only moves earlier" is
what `least(expires_at, now)` and `coalesce(revoked_at, now)` make true — a
bare assignment would push both stamps forward on every repeat, so a second
`DELETE` at a later moment would delay the reaping the first one started
rather than changing nothing. An unknown session id,
or one belonging to a different subject, answers `404`.

A session needs a login, and a subject this API created has no password, so
this section runs against `bob` — seeded with
`seed user --tenant demo --username bob --password …`, subject
`01a0d6fd-ede7-704b-8d83-fa3801d427a0` — signing in through `demo-app`, a
public `authorization_code` client created for it. **`verify_email` was set
back to `false` first**: `PATCH /settings` above had turned it on, and with
it on the login ends on "Can't sign in yet" rather than in a session.

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions
```

```
{"items":[{"id":"01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb","created_at":"2026-09-25T05:16:45.837Z","last_active_at":"2026-09-25T05:16:45.837Z","remembered":false,"client_ids":["demo-app"]}]}
```

`DELETE` twice over the same id, then the listing again — `204` both times,
and nothing left:

```bash
curl -sS -D - -X DELETE \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/subjects/01a0d6fd-ede7-704b-8d83-fa3801d427a0/sessions/01a0d6fe-9d8f-783b-b244-ea4a85ab9bfb
```

```
HTTP/1.1 204 No Content
x-request-id: 01a0d6fe-9df1-760b-8e13-7763f4c28a3d

HTTP/1.1 204 No Content
x-request-id: 01a0d6fe-9e09-7004-9844-b3c1b3abb219

{"items":[]}
```

## `GET /roles`, `POST /roles`, `GET /roles/:id`, `PATCH /roles/:id` and `DELETE /roles/:id`

All five require `manage-tenant`. A role is either a tenant role
(`client_id` is `null`) or scoped to one client, in which case a token's
`roles` claim carries it qualified by that client's own name rather than
plain — `packages/domain-authz/src/service/role-name.ts` has the format.
`PATCH` amends only `description`; every other field, `name`,
`client_id` and `default_for_new_subjects` included, is refused with a
reason, the same shape `PATCH /subjects/:id` refuses `id`, `type` and
`username`. A duplicate name — per tenant for a tenant role, per client for
a client-scoped one — answers `409`, and a `client_id` naming no client
answers `400`. `DELETE` cascades: every
`role_composites` edge, `subject_roles` assignment and `client_scope_roles`
mapping naming the role goes with it.

That cascade is why **a role belonging to the tenant's built-in admin
client cannot be deleted at all** — `409`, naming the role and the client.
The capability roles live on that client, and `subject_roles_role_fk` would
strip a deleted one from every administrator holding it: a caller with
`manage-tenant` and nothing else could delete `tenant-admin`, or
`manage-tenant` itself, and lock the tenant out of its own admin API. It is
the same guard `PATCH /clients/{id}` puts on that client's own lockout
fields, on the roles the client owns. The check reads the `builtin_admin`
column, so renaming the client in the database does not evade it.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing-viewer", "description": "read-only access to invoices"}' \
  http://localhost:3000/admin/tenants/demo/roles
```

```
{"id":"01a0d6fd-9471-7012-89c1-36ac3403705f","name":"billing-viewer","description":"read-only access to invoices","client_id":null,"default_for_new_subjects":false,"created_at":"2026-09-25T05:15:37.968Z"}
```

## `POST /roles/:id/composites`

Requires `manage-tenant`, and enforces the same capability ceiling
`PUT /subjects/:id/roles` does: nesting `child_role_id` under the role
named by `:id` must never hand that role a capability the caller does not
itself hold, checked by expanding `child_role_id` through
`role_composites` (`rolesReachableFrom`,
`packages/domain-authz/src/repository/effective-roles.ts`) rather than
comparing names, so a composite that nests a capability instead of naming
it cannot smuggle the escalation past a check on the request body. A cycle
— nesting a role under one it already (transitively) contains — answers
`409` rather than the generic `500` a raw constraint violation would leave
this as; `role_composite_cycle` is raised and caught in the domain
(`roleRepository.addComposite`, `packages/domain-authz/src/repository/roles.ts`),
never re-derived here.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"child_role_id": "01a0d6fd-9471-7012-89c1-36ac3403705f"}' \
  http://localhost:3000/admin/tenants/demo/roles/01a0d708-2df9-74c8-ae36-b9181d5b5b11/composites
```

`billing-viewer` nested under a second role, `billing-admin`, then the
reverse nesting attempted on the pair that now exists:

```
HTTP/1.1 204 No Content
x-request-id: 01a0d708-2e22-71ab-8a25-e41d970f8e2d

{"type":"about:blank","title":"Conflict","status":409,"detail":"would create a role composite cycle","instance":"01a0d708-2e41-73a0-be98-e03b41380809"}
```

## `GET /groups`, `POST /groups`, `GET /groups/:id`, `PATCH /groups/:id` and `DELETE /groups/:id`

All five require `manage-tenant`. `path` is derived, never accepted: a root
group's is `/name`, a child's is its parent's with `/name` appended, and
`groupRepository` (`packages/domain-authz/src/repository/groups.ts`) is the
only writer of it. `PATCH` amends only `parent_id` — reparenting, which
recomputes `path` for the group and every descendant — every other field
is refused with a reason. A `parent_id` naming no group answers `400`, the
same refusal `POST /groups` gives for the same input. Reparenting into the
group's own subtree answers `409` (`group_reparent_cycle`), the same way a
role composite's cycle does.
`DELETE` **deletes the whole subtree**, not one group: `groups_parent_fk`
cascades on the parent, so every descendant is deleted with it, and each
of those takes its own `group_roles` mappings and `subject_groups`
memberships along. A child does not survive as a new root, and there is no
confirmation step — a `DELETE` of a group near the top of a tree removes
everything under it.

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"parent_id": "01a0d708-2e61-7569-8143-4d8ac66c4b6c"}' \
  http://localhost:3000/admin/tenants/demo/groups/01a0d708-2e77-75f4-8458-1a6b6dedc8d7
```

Two roots, `engineering` and `platform`, then `platform` reparented under
`engineering` — `path` is recomputed by the write, never sent — then the
reverse, refused:

```
{"id":"01a0d708-2e61-7569-8143-4d8ac66c4b6c","name":"engineering","parent_id":null,"path":"/engineering","created_at":"2026-09-25T05:27:12.736Z"}
{"id":"01a0d708-2e77-75f4-8458-1a6b6dedc8d7","name":"platform","parent_id":null,"path":"/platform","created_at":"2026-09-25T05:27:12.759Z"}
{"id":"01a0d708-2e77-75f4-8458-1a6b6dedc8d7","name":"platform","parent_id":"01a0d708-2e61-7569-8143-4d8ac66c4b6c","path":"/engineering/platform","created_at":"2026-09-25T05:27:12.759Z"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"would create a group reparent cycle","instance":"01a0d708-2ed8-73c7-905f-bb2adf113b10"}
```

## `PUT /groups/:id/roles`

Requires `manage-tenant`. Replaces the group's role mapping wholesale — a
role left out of the list is one the caller clears, not one left alone —
the same replace-all shape `PUT /subjects/:id/roles` uses for a subject's
own assignments. An unknown role id answers `400`.

## `GET /scopes`, `POST /scopes`, `GET /scopes/:id`, `PATCH /scopes/:id` and `DELETE /scopes/:id`

All five require `manage-tenant`. `include_in_id_token` and
`include_in_access_token` (both default `true`) decide which token a
scope's claims land in; `PATCH` amends either, plus `description` — `name`
is refused, since it is the scope token a client requests and a token
carries. A duplicate name answers `409`. `DELETE` cascades:
`client_scope_assignments_scope_fk` and `client_scope_roles_scope_fk`
(`packages/db/drizzle/0016_client_scopes.sql`, `0017_roles.sql`) both name
`ON DELETE CASCADE`, not `RESTRICT`, so deleting an assigned, role-mapped
scope removes it and both dependent rows together rather than refusing.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "billing", "include_in_id_token": false}' \
  http://localhost:3000/admin/tenants/demo/scopes
```

```
{"id":"01a0d708-2ef8-7963-8d7a-3df5dff7cdf6","name":"billing","description":null,"include_in_id_token":false,"include_in_access_token":true,"created_at":"2026-09-25T05:27:12.887Z"}
```

## `PUT /scopes/:id/roles`

Requires `manage-tenant`. Replaces the scope's role mapping wholesale, the
same replace-all shape `PUT /groups/:id/roles` uses. An unknown role id
answers `400`.

## `PUT /scopes/:id/clients/:clientId`

Requires `manage-tenant`. Assigns the scope to the client as `default` or
`optional`, narrowing or widening any existing assignment rather than
colliding with it (`clientScopeRepository.assignOrUpdate`,
`packages/domain-tenant/src/repository/client-scopes.ts`) — the same
behaviour the seed CLI's own assign-scope command depends on. Answers with
the client's scope assignments — `client_id` and `scopes` — so the result
is visible immediately without a second `GET /clients/:id`, and **nothing
else**: this route asks for `manage-tenant`, where reading a client asks
for the stricter `manage-clients`, so answering with the client's own
representation would hand the weaker holder `redirect_uris`, `jwks`,
`audiences` and every grant setting through a side door. An unknown scope
or client id answers `404`.

Re-captured against the same later stack the SMTP section names, so the
ids below are that run's rather than the ones the sections above show.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"assignment": "default"}' \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d767-b5e6-74f8-89a0-f3afa7e2f6c0/clients/01a0d767-a054-7a00-b96d-eea9492c4e4d
```

The assignments come back, with `billing` appended to the eight scopes
`demo-app` already carried — the same `scopes` shape `GET /clients/:id`
carries, and nothing besides:

```
{"client_id":"01a0d767-a054-7a00-b96d-eea9492c4e4d","scopes":[{"id":"01a0d764-e837-75cb-b5eb-bf56c1193e85","name":"openid","assignment":"default"},{"id":"01a0d764-e83b-7c1c-84cc-624bbbe5947d","name":"profile","assignment":"default"},{"id":"01a0d764-e83c-76ee-976a-14b79a5f8c8b","name":"email","assignment":"default"},{"id":"01a0d764-e83d-74c0-a341-bfc8dc17ece7","name":"address","assignment":"default"},{"id":"01a0d764-e83d-74c0-a341-bfc97cd8d0bd","name":"phone","assignment":"default"},{"id":"01a0d764-e83e-778c-8fe8-0b8122e3d178","name":"roles","assignment":"default"},{"id":"01a0d764-e83f-7e65-bb51-c62daaadd27d","name":"groups","assignment":"default"},{"id":"01a0d764-e83f-7e65-bb51-c62e4d176cc8","name":"offline_access","assignment":"optional"},{"id":"01a0d767-b5e6-74f8-89a0-f3afa7e2f6c0","name":"billing","assignment":"default"}]}
```

## `GET /scopes/:id/mappers` and `PUT /scopes/:id/mappers`

Both require `manage-tenant`. `GET` returns `available` — every mapper name
the process's `ClaimMapperRegistry` carries, the same registry ID token and
`/userinfo` issuance assemble claims from — and `bound`, the names this
tenant bound to this scope, empty when the scope has no binding rows and
falls back to whichever mappers declare it. `PUT` replaces the whole binding
set; binding a name the registry does not carry answers `400`, listing the
known names. Neither route carries an `ETag`, the same as `PUT
/scopes/:id/roles`.

A scope with no bindings is unaffected by another scope's: binding
`profile` to `sub` alone narrows only `profile`'s own claims, never
`email`'s or any other scope's in the same tenant.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mapper_names": ["sub"]}' \
  http://localhost:3000/admin/tenants/demo/scopes/01a0d6fc-3629-7e64-a89c-2804355f56cf/mappers
```

`demo`'s `profile` scope, read before and after the write above. The empty
`bound` is the fallback case, not an error:

```
{"available":["sub","profile","email","roles","groups","address","phone"],"bound":[]}
{"available":["sub","profile","email","roles","groups","address","phone"],"bound":["sub"]}
```

A name the registry does not carry, refused with the names it does:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown mapper name(s): nonesuch; known: sub, profile, email, roles, groups, address, phone","instance":"01a0d6fe-e63f-7986-9ffb-04987c0cf19c"}
```

## `GET /keys`, `POST /keys`, `POST /keys/:id/promote` and `POST /keys/:id/retire`

All four require `manage-keys`, never `manage-tenant` — a tenant admin who
may reconfigure clients need not also be trusted to rotate what signs their
tokens. `GET /keys` lists `id`, `status`, `kid`, `alg`, `created_at` and
`not_after`; it never carries `public_jwk` or `private_jwk_encrypted`, the
signing key's own admin representation being metadata about it rather than
the key itself.

`POST /keys` generates a key of the given `alg` (`RS256` or `ES256`) and
stores it as `rotating`, published in `/certs` (JWKS) immediately —
`signing_keys_one_active` constrains `active` alone, so staging never
collides with it. `POST /keys/:id/promote` demotes the tenant's current
`active` key to `rotating` and promotes this one, in one transaction: no
window has two active keys or none. `POST /keys/:id/retire` answers `409`
in two cases, checked in that order: while the key's own status is
`active` — promote another key first, however well its algorithm is
otherwise covered — and, once that is ruled out, while a client is still
registered with a `userinfo_signed_response_alg` no remaining non-retired
key would produce, naming the offending client id(s) in the response
`detail`.

This ordering exists to dissolve a deadlock: registration itself refuses a
`userinfo_signed_response_alg` no non-retired key produces
(`client-registration.ts`'s own `algorithmsAvailable` check), so a client
cannot move to a new algorithm before something can sign it, and retiring
the old key first would leave nothing able to sign for a client still on
it. Staging a key as `rotating` makes its algorithm producible before it is
default, which is what lets a client migrate ahead of the promotion that
makes the new key the tenant's own.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"alg": "ES256"}' \
  http://localhost:3000/admin/tenants/demo/keys
```

The whole rotation against `demo`, which was provisioned with one `ES256`
key when the tenant was created. Listing, staging, promoting, listing
again:

```
{"items":[{"id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","status":"active","kid":"01a0d6fc-3654-7f93-817b-bd7eb6490305","alg":"ES256","created_at":"2026-09-25T05:14:08.294Z","not_after":null}]}
{"id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","status":"rotating","kid":"01a0d6fe-e526-7caf-9184-e66cbfab9a4b","alg":"ES256","created_at":"2026-09-25T05:17:04.166Z","not_after":null}
{"id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","status":"active","kid":"01a0d6fe-e526-7caf-9184-e66cbfab9a4b","alg":"ES256","created_at":"2026-09-25T05:17:04.166Z","not_after":null}
{"items":[{"id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","status":"rotating","kid":"01a0d6fc-3654-7f93-817b-bd7eb6490305","alg":"ES256","created_at":"2026-09-25T05:14:08.294Z","not_after":null},{"id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","status":"active","kid":"01a0d6fe-e526-7caf-9184-e66cbfab9a4b","alg":"ES256","created_at":"2026-09-25T05:17:04.166Z","not_after":null}]}
```

The promotion demoted the old key in the same transaction, so the second
listing has exactly one `active`. Retiring the newly promoted key is the
first of the two `409`s; retiring the one it demoted succeeds:

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"signing key 01a0d6fe-e527-77e6-b71d-57ed1a903cc3 is active; promote another key first","instance":"01a0d6fe-e576-778e-90bd-92480ca40cd3"}
{"id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","status":"retired","kid":"01a0d6fc-3654-7f93-817b-bd7eb6490305","alg":"ES256","created_at":"2026-09-25T05:14:08.294Z","not_after":null}
```

The second `409` — a client registered with a
`userinfo_signed_response_alg` no remaining key produces — was not
captured: `demo` held no such client, and creating one to provoke it would
have needed a key of an algorithm this tenant was then to lose.

## `GET /flow/executions` and `PUT /flow/executions`

Both require `manage-tenant`. `GET` reads the tenant's whole authentication
flow — the ordered list `authn-flows`'s executor dispatches against — as
`index`, `authenticator` and `requirement` per step.

`PUT` replaces the list wholesale; there is no partial edit, because a
flow's meaning is in its order and a flow is short. The request carries no
`index`: the array's own order is the order, and the server renumbers
`index` contiguously from it regardless of what a caller sent, so there is
no gap or duplicate to hand-manage. It refuses with `400`, each naming the
reason in `detail`: an empty list, since a tenant with no flow cannot be
logged into; a list where every step is `disabled`, the same reason; and an
`authenticator` name the executor's own registry does not resolve, which
lists the known names.

`demo`'s flow as `provisionTenant` created it — the four steps every tenant
starts with:

```
{"items":[{"index":0,"authenticator":"passkey","requirement":"alternative"},{"index":1,"authenticator":"password","requirement":"alternative"},{"index":2,"authenticator":"otp","requirement":"conditional"},{"index":3,"authenticator":"recovery-code","requirement":"conditional"}]}
```

Replacing it with a shorter, reordered one — three steps, password first,
passkey off, and `recovery-code` dropped by being left out:

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    {"authenticator": "password", "requirement": "required"},
    {"authenticator": "otp", "requirement": "conditional"},
    {"authenticator": "passkey", "requirement": "disabled"}
  ]' \
  http://localhost:3000/admin/tenants/demo/flow/executions
```

```
{"items":[{"index":0,"authenticator":"password","requirement":"required"},{"index":1,"authenticator":"otp","requirement":"conditional"},{"index":2,"authenticator":"passkey","requirement":"disabled"}]}
```

`index` is the array's own order renumbered from zero, and the request
carried none. The empty list, refused:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"a flow needs at least one step; a tenant with no flow cannot be logged into","instance":"01a0d6fe-e5e6-760a-8700-7cb5066704cd"}
```

The write reaches the executor immediately, not only the table: the very
next login dispatches against the order this `PUT` wrote, since
`initialChallenge`/`advance` read a tenant's executions fresh on every
attempt rather than caching them.

## `GET /smtp`, `PUT /smtp` and `POST /smtp/test`

All three require `manage-tenant`. `GET` reports `configured: false` and
`password_set: false` for a tenant with no row, rather than 404 — the
endpoint always exists, it is the configuration that may not. `PUT`
replaces the whole configuration; omitting `password` clears it, since
`GET` never hands one back for a caller to resend unchanged. The stored
password wraps through the same envelope a signing key's private half does
(`wrapSecret`/`unwrapSecret`, `@odudu/crypto`) — the column never carries
plaintext.

Two refusals bound what may be stored and what may be dialled.

**A configuration that authenticates requires TLS.** A `username` or a
`password` with `starttls` anything but `true` is `400`: `secure: false`
with STARTTLS unenforced puts those credentials on the wire in cleartext
(CWE-319). The transport requires TLS whenever credentials are present
whatever the row says, so this refusal is what keeps the stored row honest
about what will happen, rather than being the only thing between a
password and the network.

**The host is bounded before any connection is opened**, by the rules ADR
0028 puts on a client-supplied `jwks_uri`: the addresses `host` resolves to
are checked in the numeric domain, and loopback, link-local, private,
unspecified, multicast, broadcast and the reserved ranges are refused with
`400` naming the address and why. Without it, `POST /smtp/test` is a port
scanner — a `manage-tenant` admin stores any host and port, and the
transport's own error answers back whether something is listening.
`ODUDU_ALLOW_PRIVATE_SMTP_HOSTS` re-admits the private ranges for a
deployment whose relay genuinely is internal, the same escape hatch
`ODUDU_ALLOW_PRIVATE_CLIENT_URLS` gives that fetcher; loopback and
link-local stay refused either way. Unlike that fetcher, the connection is
opened by nodemailer resolving the name again rather than to the address
checked here, so a name that answers differently on the second lookup is
not caught.

Neither route carries an `ETag`/`If-Match`, the deliberate deviation from
the resource pattern's default: `PUT` already fully replaces the row, never
a partial amend a concurrent writer could interleave with, and the
password's own write-only shape removes the one case a race would matter
for — a caller can never read the current value to decide whether its own
write should still apply.

Resolution order when this tenant's mail is actually sent
(`apps/server/src/email.ts`'s `resolveSender`): this row first, then the
deployment's own `ODUDU_SMTP_*` sender, then the log-only adapter. ADR
0015 is unaffected — it governs where a deployment's own credentials live,
and this is a credential the deployment itself never holds.

The four transcripts below were captured against a later stack than the
sections above — `seed admin`, then `seed tenant --name demo` and nothing
else — so the tenant they run against starts with no SMTP row at all.

```bash
curl -sS -X PUT \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"host": "smtp.example.test", "port": 587, "from_address": "noreply@demo.example", "password": "hunter2"}' \
  http://localhost:3000/admin/tenants/demo/smtp
```

`GET` before that `PUT`, then the `PUT`'s own answer. The unconfigured read
is `200` with every field `null`, not `404`; the `PUT` is refused, because
it carries a password and does not ask for TLS:

```
{"configured":false,"host":null,"port":null,"from_address":null,"username":null,"password_set":false,"starttls":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"starttls must be true when a username or password is configured","instance":"01a0d767-0819-7b73-b7ae-cf7b170108d3"}
```

The same body with `"starttls": true`, then `GET` again:

```
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true}
{"configured":true,"host":"smtp.example.test","port":587,"from_address":"noreply@demo.example","username":null,"password_set":true,"starttls":true}
```

`password_set` is how the password is reported; the value itself is never
in any of these.

`POST /smtp/test` sends one message to the given address synchronously and
reports the transport's own failure as `502`, rather than an operator
discovering a bad configuration only when a user's verification mail
silently fails. That detail is still returned verbatim, now that the
destination check above has taken away what it was an oracle for: with only
public addresses reachable, the failure tells an operator about their own
relay rather than about this server's neighbourhood. `400` for a tenant
with no SMTP configuration at all, and `400` for a host this server will
not connect to.

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to": "ops@demo.example"}' \
  http://localhost:3000/admin/tenants/demo/smtp/test
```

Against a tenant with no row at all, then against the `smtp.example.test`
row the `PUT` above stored, then against the same tenant after its `host`
was re-`PUT` as `127.0.0.1` — the probe this endpoint would otherwise be:

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this tenant has no SMTP configuration","instance":"01a0d767-0802-7f87-8b85-ff1276001dde"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to smtp.example.test: it resolves to no address","instance":"01a0d767-0856-7051-b6d1-ef5da413fd73"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"this server will not connect to 127.0.0.1: address 127.0.0.1 is a loopback address","instance":"01a0d767-0887-7e7b-88b3-c1ecf3df5f9a"}
```

No `502` is shown: this stack has no mail server and no host it is willing
to dial, so nothing here reaches a transport for one to be reported from.

## `GET /audit`

Requires `view-audit`, which carries no `manage-` counterpart: nothing ever
amends a row here, only `reap` deletes one once it is older than the
tenant's own `audit_retention_days` setting. Every admin mutation above
writes exactly one row here, in the same transaction as the change itself —
a client's `POST`, `PATCH`, `DELETE` and secret rotation; a tenant's
`POST` and its own `PATCH /settings`; and the equivalent for subjects,
roles, groups, scopes, scope mappers, sessions, signing keys, the flow and
SMTP configuration. `detail` is a redacted before/after diff, allowlisted
per resource type: a secret, a password hash or a private key never
appears in it, whichever of the two it would have been, and a field on
neither list is absent rather than shown.

`outcome` is `allowed`, `refused` or `failed`, but **only `POST /clients`
records a refused attempt today** — a reserved `client_id`, metadata
`parseClientMetadata` rejects, or a tenant at its client capacity each
write a row with `outcome: "refused"` and no other change. Every other
mutation above writes a row only when it succeeds; `?outcome=refused`
against any other resource type returns nothing yet, not because nothing
was refused.

`tenant_id` on a row is the tenant the change was made **to**, not the
tenant of whoever made it. `actor_tenant_id` and `actor_client_id` name the
caller instead — the tenant that issued the caller's own token and the
admin client it authenticated as — so a system admin's change to this
tenant is a row this tenant's own administrators can read, and can see was
made by someone outside it.

A request refused for a cross-tenant issuer mismatch — a bearer token
naming an issuer neither this tenant nor the system tenant — writes no row
here at all. That refusal is decided before the token's signature is even
checked, since a token naming an unrecognised issuer has no keys to verify
it against; auditing it at that point would let an unauthenticated caller
append a row per request, which is a worse defect than the missing row.
See `docs/NEXT.md`'s `deferred:` entry for what recording it safely needs.

Paginated the same way every other list here is, over
`(occurred_at, id)` descending rather than ascending `id`: newest first.
Filters narrow the page rather than requiring one: `actor_subject_id`,
`resource_type`, `action`, `outcome`, and a `from`/`to` range on
`occurred_at` (ISO 8601, with an offset). `actor_subject_id` must be a
UUID, since the column is one — anything else answers `400` rather than
reaching Postgres and failing there.

```bash
curl -sS -G \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "action=client.create" \
  --data-urlencode "limit=20" \
  http://localhost:3000/admin/tenants/demo/audit
```

**This listing prints whatever the sections above left behind**, so every
query here is scoped. Both `client.create` rows on this stack —
`demo-backend` from `POST /clients` and `demo-app` from the sessions
section — newest first:

```
{"items":[{"id":"01a0d6fd-ee4b-7e24-94c4-8a1f089f7ff4","occurred_at":"2026-09-25T05:16:00.960Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","actor_client_id":"01a0d6fb-08e6-77ef-b8dd-69f7d63c040b","resource_type":"client","resource_id":"01a0d6fd-ee42-78c0-ab32-9077b0fc3804","request_id":null,"ip":null,"detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["authorization_code","refresh_token"]},"web_origins":{"after":[]},"redirect_uris":{"after":["http://localhost:3000/cb"]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"none"}}},{"id":"01a0d6fc-e5c3-7d6b-bf08-007f2c7af08e","occurred_at":"2026-09-25T05:14:53.164Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","actor_client_id":"01a0d6fb-08e6-77ef-b8dd-69f7d63c040b","resource_type":"client","resource_id":"01a0d6fc-e5b4-73d4-9162-e2a9893d64b0","request_id":null,"ip":null,"detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"jwks_uri":{"after":null},"audiences":{"after":[]},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"full_scope_allowed":{"after":false},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":300},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":1209600},"token_endpoint_auth_method":{"after":"client_secret_basic"}}}]}
```

`actor_tenant_id` is `system` on both, and `tenant_id` is absent from the
row's own representation — the tenant a row belongs to is the one in the
path. Neither `detail` carries a secret: `demo-backend` was created with
one, and the allowlist shows `jwks` as `{"changed": true}` rather than a
value, which is the shape every redacted field takes.

Three signing-key rows from the rotation above, narrowed by
`resource_type` alone. Their `detail` is empty, a key having no allowlisted
field to diff:

```
{"items":[{"id":"01a0d6fe-e5af-7e92-9a37-467c4486586e","occurred_at":"2026-09-25T05:17:04.301Z","event_type":"admin_mutation","action":"key.retire","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","actor_client_id":"01a0d6fb-08e6-77ef-b8dd-69f7d63c040b","resource_type":"signing_key","resource_id":"01a0d6fc-3654-7f93-817b-bd7f1bb2ff55","request_id":null,"ip":null,"detail":{}},{"id":"01a0d6fe-e558-781d-9400-1c2ec6563448","occurred_at":"2026-09-25T05:17:04.213Z","event_type":"admin_mutation","action":"key.promote","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","actor_client_id":"01a0d6fb-08e6-77ef-b8dd-69f7d63c040b","resource_type":"signing_key","resource_id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","request_id":null,"ip":null,"detail":{}},{"id":"01a0d6fe-e527-77e6-b71d-57ee38478a8b","occurred_at":"2026-09-25T05:17:04.166Z","event_type":"admin_mutation","action":"key.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","actor_client_id":"01a0d6fb-08e6-77ef-b8dd-69f7d63c040b","resource_type":"signing_key","resource_id":"01a0d6fe-e527-77e6-b71d-57ed1a903cc3","request_id":null,"ip":null,"detail":{}}]}
```

And `?outcome=refused`, which is only ever non-empty for `POST /clients`.
The row below is the reserved-`client_id` attempt shown under that section;
`resource_id` is the `client_id` string, there being no row to name:

```
{"items":[{"id":"01a0d6ff-881f-763e-85bb-c7fc66a7e1ee","occurred_at":"2026-09-25T05:17:45.887Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a0d6fb-0918-7846-b430-0a714b8bf7bf","actor_client_id":"01a0d6fb-08e6-77ef-b8dd-69f7d63c040b","resource_type":"client","resource_id":"odudu-admin","request_id":null,"ip":null,"detail":{}}]}
```

No page above needed a `next`: the stack never had more than twenty rows of
any one scope.

## `GET /admin/openapi.json`

The reference this document points at: an OpenAPI 3.1 description of every
route above, generated from the same route table the router registers from,
so the two cannot drift. It takes no `{tenant}` — it describes the API
rather than reaching into one — and is served without authentication, since
a client that cannot read it cannot generate against it:

```bash
curl -sS -D - -o openapi.json http://localhost:3000/admin/openapi.json
```

```
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 91954
```

92 KB and 32 paths, which is the whole route table. Its first bytes, and
the `bearerAuth` scheme it declares — `head -c 180 openapi.json` and the
substring at `securitySchemes`:

```
{"openapi":"3.1.0","info":{"title":"Odudu admin API","version":"0.0.0"},"security":[{"bearerAuth":[]}],"paths":{"/admin/tenants/{tenant}/whoami":{"get":{"summary":"Requires an auth
```

```
"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer","bearerFormat":"JWT","description":"An access token whose \"aud\" claim names urn:odudu:params:admin-api. A token minted for another audience, including the protocol surface itself, is refused with 401."}}
```

`security` is declared once at the top level, so every path inherits it
rather than repeating it. `/admin/openapi.json` is not among those 32
paths: the document does not describe itself, which is why serving it
unauthenticated does not contradict the blanket `security` above.

## What to do next, from wherever you are

**From here, for anything this document does not yet cover** — creating a
client, rotating a signing key, editing a tenant's authentication flow —
[docs/request-paths.md](request-paths.md) is where the rest of the server's
behaviour is documented, and its own "What to do next" section covers the
protocol surface this API sits beside.
