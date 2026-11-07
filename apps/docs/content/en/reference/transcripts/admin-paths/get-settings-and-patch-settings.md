---
title: 'GET /settings and PATCH /settings'
description: 'The 39 columns tenants carries beyond identity — everything odudu seed tenant --set can already change — read and amended through one map…'
---

# `GET /settings` and `PATCH /settings`

The 39 columns `tenants` carries beyond identity — everything `odudu seed tenant
--set` can already change — read and amended through one map,
`@odudu/domain-tenant`'s `SETTINGS`: a name a caller writes and a column a
migration owns, never restated a second time. Ranges are `CHECK` constraints on
`tenants`, restated beside that map as `tenantSettingProblems` so a value
outside one is refused before the write; an integration test holds the two in
agreement, and the `CHECK` still stands behind it.

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
Setting `enabled` to `false` ends the tenant's sessions, once the change has
committed, exactly as `PATCH /admin/tenants/{tenant}` does.

In `settings-demo`, a tenant created for this section through `POST
/admin/tenants` with `display_name` "Settings Demo", so every value but
`display_name` is the migrations' own default. Everything on this page ran in one
session on a freshly built stack with `odudu seed admin --username ada` run
against it and `$ADMIN_TOKEN` got as in [Getting the token](./getting-the-token.md):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"settings-demo","display_name":"Settings Demo"}' \
  http://localhost:3000/admin/tenants -o /dev/null
```

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/settings-demo/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a1acaa-9ac9-714f-9c35-67d49817d89b
cache-control: no-store
etag: "7ca784c9991ae72f891832472ada2ecce1cd2082c1ef1b72d5c2d9b0036bf38a"
content-type: application/json; charset=utf-8
content-length: 1276
Date: Thu, 05 Nov 2026 17:03:44 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":false,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":15,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"login_with_email":false,"cimd_enabled":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"],"supported_locales":["en"],"default_locale":null}
```

Amending sends only the settings that change, and the response is the whole
object as it now reads, with a fresh `ETag` for the next `If-Match`:

```bash
curl -sS -D - -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"verify_email": true, "password_min_length": 14}' \
  http://localhost:3000/admin/tenants/settings-demo/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a1acaa-9ae9-7a87-b5c5-5da3db3ebe6b
cache-control: no-store
etag: "2b64f08f440ed4e5ac2eca1b94f63df3d4b358e822c3bc403259194330507748"
content-type: application/json; charset=utf-8
content-length: 1275
Date: Thu, 05 Nov 2026 17:03:44 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":14,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"login_with_email":false,"cimd_enabled":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"],"supported_locales":["en"],"default_locale":null}
```

A name this map does not know is refused with `400`, naming the settings it does
— which is also the one place the whole vocabulary is listed by the server
itself. In the same tenant:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"nonesuch": true}' \
  http://localhost:3000/admin/tenants/settings-demo/settings
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown tenant setting \"nonesuch\"; expected one of display_name, enabled, registration_allowed, verify_email, reset_password_allowed, sso_session_idle_seconds, sso_session_max_seconds, password_min_length, password_require_digit, password_require_uppercase, password_require_lowercase, password_require_special, password_not_username, password_not_email, password_history_depth, password_max_age_days, otp_required, brute_force_max_failures, brute_force_lockout_seconds, brute_force_max_lockout_seconds, brute_force_failure_reset_seconds, client_registration_policy, max_clients, max_sessions_per_browser, remember_me_allowed, remember_me_idle_seconds, remember_me_max_seconds, audit_retention_days, username_editable, access_token_ttl_seconds, id_token_ttl_seconds, refresh_token_ttl_seconds, authorization_code_ttl_seconds, login_ttl_seconds, verify_email_ttl_seconds, reset_password_ttl_seconds, login_with_email, cimd_enabled, audit_event_types, supported_locales, default_locale","errors":[{"path":"nonesuch","message":"is not a tenant setting"}],"instance":"01a1acaa-9b09-7f48-98e1-f3d3d29fc250"}
```

A value the map coerces but outside its range — `password_min_length` outside
`8..256`, for instance — is refused with `400` before anything is written, every
such setting listed together under `errors` by its name. An idle lifetime is
judged against the maximum it would sit under once the patch is applied, the
stored one when the patch leaves it alone. The refusals come in a fixed order: a
malformed or unknown setting answers `400` first, then a stale `If-Match`
answers `412`, and only then is an out-of-range value refused with `400` — so a
stale header on an out-of-range patch is told `412`. As `ada`, in a
tenant `settings-range-demo` created for it — its stored values first:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"settings-range-demo"}' http://localhost:3000/admin/tenants -o /dev/null
```

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/settings-range-demo/settings \
  | jq -c '{password_min_length, max_sessions_per_browser, sso_session_idle_seconds, sso_session_max_seconds}'
for body in '{"password_min_length": 4}' \
            '{"password_min_length": 4, "max_sessions_per_browser": 99}' \
            '{"sso_session_idle_seconds": 40000}'; do
  curl -sS -X PATCH \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" \
    http://localhost:3000/admin/tenants/settings-range-demo/settings
  echo
done
```

```
{"password_min_length":15,"max_sessions_per_browser":25,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"password_min_length","message":"must be between 8 and 256"}],"instance":"01a18727-ec7c-7eb7-b5a5-cea0d35762b4"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"2 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"password_min_length","message":"must be between 8 and 256"},{"path":"max_sessions_per_browser","message":"must be between 1 and 32"}],"instance":"01a18727-ec95-78e0-9a1f-fb7f37676872"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"sso_session_idle_seconds","message":"must not exceed sso_session_max_seconds"}],"instance":"01a18727-ecaf-7971-90f8-459e7dfc1aff"}
```

A setting's value may be sent as its JSON type
(`true`, `14`) or as the equivalent string (`"true"`, `"14"`) — both reach
the same `coerceTenantSetting` the CLI uses, which reads a string either
way.

A `display_name` is trimmed wherever one is written, and a blank one is stored
as none (`null`), which the tenant's pages replace with its name: `PATCH
/settings`, `PATCH /admin/tenants/{tenant}`, `POST /admin/tenants` and, in the
request or the document, `POST /admin/tenant-imports` all go through one
function in `@odudu/domain-tenant`. (The setting is the one nullable text
setting, and a request cannot carry `null`.) With tenants `name-demo3` (created
with a blank name) and `name-demo4` (created with "Name Demo"):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"name-demo4","display_name":"Name Demo"}' \
  http://localhost:3000/admin/tenants -o /dev/null
```

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"name-demo3","display_name":"   "}' \
  http://localhost:3000/admin/tenants | jq -c '{name,display_name}'
for body in '{"display_name": "  Name Demo Inc "}' '{"display_name": "   "}'; do
  curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" -d "$body" \
    http://localhost:3000/admin/tenants/name-demo4 | jq -c '{display_name}'
done
for body in '{"display_name": "Name Demo Inc"}' '{"display_name": "   "}'; do
  curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" -d "$body" \
    http://localhost:3000/admin/tenants/name-demo4/settings | jq -c '{display_name}'
done
```

```
{"name":"name-demo3","display_name":null}
{"display_name":"Name Demo Inc"}
{"display_name":null}
{"display_name":"Name Demo Inc"}
{"display_name":null}
```

`seed tenant --set` runs the same check before it writes anything, over the
tenant's stored settings with the new values laid on them — or, for a
tenant it would create, the column defaults — and names every problem at
once. So a refused `--set` leaves no tenant behind: the second command below
creates `range-demo`, which the first did not.

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name range-demo \
  --set password_max_age_days=4000 --set sso_session_max_seconds=600 2>&1 \
  | grep -E '^OduduError|code:'
docker compose exec -T odudu node dist/main.js seed tenant --name range-demo 2>/dev/null
```

```
OduduError: tenant setting password_max_age_days must be between 0 and 3650; tenant setting sso_session_idle_seconds must not exceed sso_session_max_seconds
  code: 'seed_invalid_options'
{"command":"tenant","created":true,"tenant":"range-demo","tenantId":"01a18727-f2ea-7b3e-aa11-34755da578a2"}
```

## Who may register clients

`client_registration_policy` is one of `disabled`, `open`, `token` and `mcp`, and
`cimd_enabled` switches on [client ID metadata
documents](../request-paths/authorization-server-metadata.md). Both are read and
amended like any other setting, `seed tenant --set` takes them too, and a change
to either, like a change to `display_name`, `supported_locales` or
`default_locale`, is all the audit event of a settings change names: the
value before and after, never another setting. In a new tenant, `policy-doc`,
a patch carrying the `ETag` it was read with, the same patch again with that
now-stale tag, a spelling outside the four, and the audit row:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"policy-doc","display_name":"Policy Demo"}' \
  http://localhost:3000/admin/tenants -o /dev/null
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/policy-doc/settings | awk 'tolower($1) == "etag:" {print $2}' | tr -d '\r')
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"client_registration_policy": "mcp", "cimd_enabled": true}' \
  http://localhost:3000/admin/tenants/policy-doc/settings \
  | jq -c '{client_registration_policy, cimd_enabled}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"cimd_enabled": false}' \
  http://localhost:3000/admin/tenants/policy-doc/settings
echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"client_registration_policy": "sometimes"}' \
  http://localhost:3000/admin/tenants/policy-doc/settings
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/policy-doc/audit?action=tenant.amend_settings" \
  | jq -c '.items[] | {action, detail}'
```

```
{"client_registration_policy":"mcp","cimd_enabled":true}
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1ad3e-1028-735f-9c2a-4c2ac1373c5a"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"tenant setting client_registration_policy must be one of disabled, open, token, mcp","errors":[{"path":"client_registration_policy","message":"must be one of disabled, open, token, mcp"}],"instance":"01a1ad3e-1044-7399-9efb-7f3018f783c0"}
{"action":"tenant.amend_settings","detail":{"cimd_enabled":{"after":true,"before":false},"client_registration_policy":{"after":"mcp","before":"disabled"}}}
```

## Lifetimes, and signing in with an email address

Seven of the settings are lifetimes the code used to fix, each defaulting to the
constant it replaced (`0082_tenant_lifetimes.sql`): `access_token_ttl_seconds`
and `id_token_ttl_seconds` (`300`, `1` to `3600`), `refresh_token_ttl_seconds`
(`1209600`, at least `1`), `authorization_code_ttl_seconds` (`60`, `1` to `600`
— RFC 6749 §4.1.2's ten minutes), `login_ttl_seconds` (`1800`, `60` to `86400`:
how long a login page may stay open), `verify_email_ttl_seconds` (`43200`, `60`
to `604800`) and `reset_password_ttl_seconds` (`300`, `60` to `86400`). The
three token lifetimes are defaults: a client's own `access_token_ttl_seconds`,
`id_token_ttl_seconds` or `refresh_token_ttl_seconds` overrides each, and a
client whose value is `null` takes the tenant's. Each is read where the token,
code, login or link is minted, so a change applies from the next one.
`login_with_email` (default `false`) lets the login form take a verified email
address where it takes a username — [Signing in with an email
address](../request-paths/path-a-authorization-code-with-pkce.md#signing-in-with-an-email-address)
walks through it. In the same tenant, the response narrowed to the settings this
subsection is about:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"access_token_ttl_seconds": 600, "id_token_ttl_seconds": 900, "authorization_code_ttl_seconds": 30, "login_ttl_seconds": 600, "reset_password_ttl_seconds": 900, "login_with_email": true}' \
  http://localhost:3000/admin/tenants/settings-demo/settings \
  | jq -c '{access_token_ttl_seconds, id_token_ttl_seconds, refresh_token_ttl_seconds, authorization_code_ttl_seconds, login_ttl_seconds, verify_email_ttl_seconds, reset_password_ttl_seconds, login_with_email}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"access_token_ttl_seconds": 7200, "authorization_code_ttl_seconds": 900, "reset_password_ttl_seconds": 30}' \
  http://localhost:3000/admin/tenants/settings-demo/settings
```

```
{"access_token_ttl_seconds":600,"id_token_ttl_seconds":900,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":30,"login_ttl_seconds":600,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":900,"login_with_email":true}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"3 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"access_token_ttl_seconds","message":"must be between 1 and 3600"},{"path":"authorization_code_ttl_seconds","message":"must be between 1 and 600"},{"path":"reset_password_ttl_seconds","message":"must be between 60 and 86400"}],"instance":"01a18727-f3ab-768b-8ef7-e6dea698ea15"}
```
