---
title: 'GET /settings and PATCH /settings'
description: 'The 48 columns tenants carries beyond identity — everything odudu seed tenant --set can already change — read and amended through one map…'
---

# `GET /settings` and `PATCH /settings`

The 41 columns `tenants` carries beyond identity — everything `odudu seed tenant
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
x-request-id: 01a1cfdb-ba5d-7764-ba1f-9a5bba7899c5
cache-control: no-store
etag: "d7a245d8934a65f0d08304df5cc1ef2faaf98433bde0533f76ea06beb91b8d67"
content-type: application/json; charset=utf-8
content-length: 1518
Date: Thu, 12 Nov 2026 13:04:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":false,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":15,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"session_freshness_seconds":300,"recovery_code_warn_below":3,"totp_algorithm":"SHA1","totp_digits":6,"totp_period":30,"webauthn_user_verification":"required","webauthn_resident_key":"required","recovery_code_count":10,"require_passkey":false,"login_with_email":false,"cimd_enabled":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"],"supported_locales":["en"],"default_locale":null}
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
x-request-id: 01a1cfdb-ba75-797a-8956-8dec8909154d
cache-control: no-store
etag: "1a55e29efa128099bf5918ea8e3033d8544ae4f51161ef7d2b509c3404a90edd"
content-type: application/json; charset=utf-8
content-length: 1517
Date: Thu, 12 Nov 2026 13:04:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"display_name":"Settings Demo","enabled":true,"registration_allowed":false,"verify_email":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":14,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"client_registration_policy":"disabled","max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"session_freshness_seconds":300,"recovery_code_warn_below":3,"totp_algorithm":"SHA1","totp_digits":6,"totp_period":30,"webauthn_user_verification":"required","webauthn_resident_key":"required","recovery_code_count":10,"require_passkey":false,"login_with_email":false,"cimd_enabled":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"],"supported_locales":["en"],"default_locale":null}
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"unknown tenant setting \"nonesuch\"; expected one of display_name, enabled, registration_allowed, verify_email, reset_password_allowed, sso_session_idle_seconds, sso_session_max_seconds, password_min_length, password_require_digit, password_require_uppercase, password_require_lowercase, password_require_special, password_not_username, password_not_email, password_history_depth, password_max_age_days, otp_required, brute_force_max_failures, brute_force_lockout_seconds, brute_force_max_lockout_seconds, brute_force_failure_reset_seconds, client_registration_policy, max_clients, max_sessions_per_browser, remember_me_allowed, remember_me_idle_seconds, remember_me_max_seconds, audit_retention_days, username_editable, access_token_ttl_seconds, id_token_ttl_seconds, refresh_token_ttl_seconds, authorization_code_ttl_seconds, login_ttl_seconds, verify_email_ttl_seconds, reset_password_ttl_seconds, session_freshness_seconds, recovery_code_warn_below, totp_algorithm, totp_digits, totp_period, webauthn_user_verification, webauthn_resident_key, recovery_code_count, require_passkey, login_with_email, cimd_enabled, audit_event_types, supported_locales, default_locale","errors":[{"path":"nonesuch","message":"is not a tenant setting"}],"instance":"01a1cfdb-ba91-7c3b-9be4-602c99329fff"}
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"password_min_length","message":"must be between 8 and 256"}],"instance":"01a1cbbc-921a-72c1-814c-2e54e310edbc"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"2 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"password_min_length","message":"must be between 8 and 256"},{"path":"max_sessions_per_browser","message":"must be between 1 and 32"}],"instance":"01a1cbbc-922c-715d-ae1a-e6afebb17d3f"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"sso_session_idle_seconds","message":"must not exceed sso_session_max_seconds"}],"instance":"01a1cbbc-923e-74de-a3a6-ccb0ac3be802"}
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
{"command":"tenant","created":true,"tenant":"range-demo","tenantId":"01a1cbbc-9621-7f75-a358-75db32987c9e"}
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
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a1cbbc-976d-7ab8-88b9-646697097428"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"tenant setting client_registration_policy must be one of disabled, open, token, mcp","errors":[{"path":"client_registration_policy","message":"must be one of disabled, open, token, mcp"}],"instance":"01a1cbbc-9785-73f6-8469-c64a1d5936df"}
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
{"type":"about:blank","title":"Bad Request","status":400,"detail":"3 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"access_token_ttl_seconds","message":"must be between 1 and 3600"},{"path":"authorization_code_ttl_seconds","message":"must be between 1 and 600"},{"path":"reset_password_ttl_seconds","message":"must be between 60 and 86400"}],"instance":"01a1cbbc-97c0-7389-bdc3-ae5026547b4f"}
```

## The authenticator policy

Six settings say what a tenant's new authenticator apps, passkeys and recovery sets are made with:
`totp_algorithm` (`SHA1`, `SHA256` or `SHA512`), `totp_digits` (6 or 8), `totp_period` (30 or 60 seconds),
`webauthn_user_verification` and `webauthn_resident_key` (`required`, `preferred` or `discouraged`) and
`recovery_code_count` (8 to 16). The defaults are what every enrolment was made with before they existed. A change applies
to the next enrolment only; [Two-factor authentication with TOTP](../request-paths/two-factor-authentication-with-totp.md#a-policy-that-changes-after-somebody-enrolled)
shows an app enrolled before a change still signing in. `recovery_code_warn_below` may not exceed `recovery_code_count`. In a
tenant `policy-api-demo`, made for it: the defaults, a change and each refusal (a digit count or period nobody offers, an
algorithm that is not one, a count out of range, and a warning threshold above the count):

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/policy-api-demo/settings \
  | jq -c '{totp_algorithm, totp_digits, totp_period, webauthn_user_verification, webauthn_resident_key, recovery_code_count, recovery_code_warn_below}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"totp_algorithm":"SHA256","totp_digits":8,"totp_period":60,"webauthn_user_verification":"preferred","webauthn_resident_key":"discouraged","recovery_code_count":12}' \
  http://localhost:3000/admin/tenants/policy-api-demo/settings \
  | jq -c '{totp_algorithm, totp_digits, totp_period, webauthn_user_verification, webauthn_resident_key, recovery_code_count, recovery_code_warn_below}'
for body in '{"totp_digits": 7, "totp_period": 45}' \
            '{"totp_algorithm": "MD5"}' \
            '{"recovery_code_count": 20}' \
            '{"recovery_code_count": 8, "recovery_code_warn_below": 9}'; do
  curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "$body" http://localhost:3000/admin/tenants/policy-api-demo/settings
  echo
done
```

```
{"totp_algorithm":"SHA1","totp_digits":6,"totp_period":30,"webauthn_user_verification":"required","webauthn_resident_key":"required","recovery_code_count":10,"recovery_code_warn_below":3}
{"totp_algorithm":"SHA256","totp_digits":8,"totp_period":60,"webauthn_user_verification":"preferred","webauthn_resident_key":"discouraged","recovery_code_count":12,"recovery_code_warn_below":3}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"2 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"totp_digits","message":"must be one of 6, 8"},{"path":"totp_period","message":"must be one of 30, 60"}],"instance":"01a1cfb0-7326-7be5-817e-ec55bbaec6d1"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"tenant setting totp_algorithm must be one of SHA1, SHA256, SHA512","errors":[{"path":"totp_algorithm","message":"must be one of SHA1, SHA256, SHA512"}],"instance":"01a1cfb0-733c-78d9-aff0-6502388b4961"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"recovery_code_count","message":"must be between 8 and 16"}],"instance":"01a1cfb0-7352-70a4-961d-d2cf31446e70"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) outside the permitted range, listed under errors","errors":[{"path":"recovery_code_warn_below","message":"must not exceed recovery_code_count"}],"instance":"01a1cfb0-7369-7412-85b5-a0ac7b986e6e"}
```

## The passkey switch

`require_passkey` is one boolean, off unless a tenant turns it on. With it on, a person who signs in and holds no passkey is
given the `configure-passkey` required action at that sign-in and is shown the passkey page, which has no way to skip it. A
session that is already open is not touched, and turning the switch off does not remove an action already owed;
[Enrolling a passkey](../request-paths/enrolling-a-passkey.md#a-tenant-that-asks-everyone-for-a-passkey) runs a sign-in under
the switch. In a tenant `passkey-api-demo`, made for it: the value as the tenant starts, turned on, a value that is not a
boolean, and turned off again:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/passkey-api-demo/settings | jq -c '{require_passkey}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"require_passkey":true}' \
  http://localhost:3000/admin/tenants/passkey-api-demo/settings | jq -c '{require_passkey}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"require_passkey":"yes"}' http://localhost:3000/admin/tenants/passkey-api-demo/settings; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"require_passkey":false}' \
  http://localhost:3000/admin/tenants/passkey-api-demo/settings | jq -c '{require_passkey}'
```

```
{"require_passkey":false}
{"require_passkey":true}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"tenant setting require_passkey expects a boolean","errors":[{"path":"require_passkey","message":"expects a boolean"}],"instance":"01a1cfdb-bb33-7721-b3fb-3a9f30b66c2a"}
{"require_passkey":false}
```

The first three blocks of this page, `GET /admin/openapi.json` and the passkey switch section were run again after the switch
joined the settings, on a freshly built stack; the authenticator policy section keeps the capture from when that policy joined
(see [How the transcripts are captured](../../../contributing/transcripts.md)).
