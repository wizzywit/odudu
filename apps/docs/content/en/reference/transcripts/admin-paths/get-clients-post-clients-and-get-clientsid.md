---
title: 'GET /clients, POST /clients and GET /clients/{id}'
description: 'Lists, reads and creates clients: the clients row and its OIDC configuration, joined into one resource keyed by the internal id.'
---

# `GET /clients`, `POST /clients` and `GET /clients/{id}`

Lists, reads and creates clients — the `clients` row and its OIDC
configuration (`client_oidc_config`), joined into one resource keyed by the
client's internal id (`{id}` above is that id, not the OAuth `client_id`
string a token request names). Requires `manage-clients` throughout: there
is no `view-clients`, because client metadata is configuration rather than
a population to browse. A `GET` on a single client carries an `ETag`, which
`PATCH /clients/{id}` below reads back through `If-Match`.

A create body names `client_id` — chosen by the operator, unlike RFC 7591
dynamic registration (`clients-registrations/openid-connect`, [the request
paths](../request-paths/bootstrap.md#dynamic-client-registration)) where the
server assigns it — plus the same RFC 7591 client metadata dynamic registration
accepts, narrowed by the identical validator (`parseClientMetadata`): a
`redirect_uris` entry it rejects, or `jwks` and `jwks_uri` sent together, is
refused here with the identical `400` detail. `odudu-admin` is refused as a
`client_id` with `409` — reserved for the built-in admin client every tenant is
provisioned with, and creation is a door dynamic registration never opens to it
in the first place, since RFC 7591 §2 already assigns `client_id` there and
refuses a caller that names one itself. A `client_id` that collides with an
existing client in the tenant is refused the same way, also `409`, rather than
surfacing as the database's own unique-index violation.

A create body may also carry any field `PATCH /clients/{id}` below amends —
`description`, `client_uri`, `policy_uri`, `tos_uri`, `audiences`,
`web_origins`, `post_logout_redirect_uris`, `client_credentials_scopes`,
`access_token_ttl_seconds`, `id_token_ttl_seconds`, `refresh_token_ttl_seconds`,
`consent_required`, `token_exchange_impersonation_allowed`, `enabled`,
`full_scope_allowed` and `name` — each checked by the identical validation
`PATCH` runs. A field `PATCH` refuses to amend, such as `type`, is refused here
with `PATCH`'s own reason; a key that names nothing on the client at all is
refused with `400` and the detail `<field>: <field> is not a client field`,
naming it rather than silently ignoring it; `name` sent alongside a different
`client_name` is refused the same way. `access_token_ttl_seconds` or
`id_token_ttl_seconds` outside 1 to 3600 and `refresh_token_ttl_seconds` below 1
are refused with `400`, naming the field, on a create and a `PATCH` alike — the
ranges the database's own CHECK constraints hold
(`0013_access_token_ttl_ceiling.sql`, `0014_refresh_token_ttl_floor.sql`,
`0082_tenant_lifetimes.sql`), which otherwise surfaced as a `500`. Each of the
three may be `null`, which a client created without one already is: the client
then takes the tenant's setting of the same name ([`GET
/settings`](./get-settings-and-patch-settings.md)). No transcript shows that
refusal; An integration test covers it.

A `jwks` is served public members only, by the read, the list and every response
that carries a client, the same stripping export applies (`publicJwks`).
Registration and this API refuse a private member, so only a row written before
they did can hold one; a `PATCH` that reruns the metadata is judged on the
stripped set, and writes it back without the member. No transcript shows it,
since none of these runs produced such a row; an integration test writes one
directly.

Everything on this page ran in one session on a freshly built stack with `odudu
seed admin --username ada` run against it and `$ADMIN_TOKEN` got as in [Getting
the token](./getting-the-token.md). The tenant `demo` is created first, with the
four clients the search below names beside `demo-fields-check`:
`demo-backend`, `demo-exchanger` and `demo-operator` (confidential) and
`demo-spa` (public):

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"demo"}' http://localhost:3000/admin/tenants -o /dev/null
for c in demo-backend demo-exchanger demo-operator; do
  curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"client_id\":\"$c\",\"grant_types\":[\"client_credentials\"],\"token_endpoint_auth_method\":\"client_secret_basic\"}" \
    http://localhost:3000/admin/tenants/demo/clients -o /dev/null
done
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"client_id":"demo-spa","redirect_uris":["https://spa.demo.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  http://localhost:3000/admin/tenants/demo/clients -o /dev/null
```

Creating a client that names both, against `demo`, then reading it back; the
`etag` the create answers is the one the read does:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-fields-check", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "audiences": ["https://api.demo.example"], "web_origins": ["https://app.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients
```

```
HTTP/1.1 201 Created
x-request-id: 01a1872d-c5a1-7c4d-bd7c-f3da336acb2b
cache-control: no-store
etag: "ef1807f03ba93dfbe274fc9f98cd9c0d6adb889f525854731282ea32ba01ea2e"
content-type: application/json; charset=utf-8
content-length: 2118
Date: Thu, 29 Oct 2026 10:21:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1872d-c5f8-7478-9e8b-af94e890f5ec","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:21:26.329Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1872d-c5c0-7f06-8ba9-0d74ae247824","scopes":[{"id":"01a1872d-be50-7c99-b10f-59264732dd59","name":"address","assignment":"default"},{"id":"01a1872d-be4c-7b63-b0c0-4728817f0c89","name":"email","assignment":"default"},{"id":"01a1872d-be5a-7b84-b831-65d00005856b","name":"groups","assignment":"default"},{"id":"01a1872d-be60-7e39-be4f-62cbd9d20558","name":"offline_access","assignment":"optional"},{"id":"01a1872d-be41-73ef-af64-901bdd91fa51","name":"openid","assignment":"default"},{"id":"01a1872d-be55-7d06-9f55-76fa04c0a0bc","name":"phone","assignment":"default"},{"id":"01a1872d-be47-7b6d-ba14-a31162354b1f","name":"profile","assignment":"default"},{"id":"01a1872d-be57-7e6c-81fd-34d0d5b6e4c8","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"client_secret":"rJDK_mW0gJbIOk6kgrZ6KzVaLD1sJi4tEY4vwx056nk"}
```

`GET`ting it back shows both fields still set, from the row rather than the
create response — and now also carries `builtin_admin` and
`service_subject_id`, read from the same row a create response is:

```bash
FID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/clients?client_id_exact=demo-fields-check" | jq -r '.items[0].id')
```

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/$FID
```

```
HTTP/1.1 200 OK
x-request-id: 01a1872d-c69d-71c8-bb06-b839d0b21428
cache-control: no-store
etag: "ef1807f03ba93dfbe274fc9f98cd9c0d6adb889f525854731282ea32ba01ea2e"
content-type: application/json; charset=utf-8
content-length: 2083
Date: Thu, 29 Oct 2026 10:21:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1872d-c5f8-7478-9e8b-af94e890f5ec","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:21:26.329Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1872d-c5c0-7f06-8ba9-0d74ae247824","scopes":[{"id":"01a1872d-be50-7c99-b10f-59264732dd59","name":"address","assignment":"default"},{"id":"01a1872d-be4c-7b63-b0c0-4728817f0c89","name":"email","assignment":"default"},{"id":"01a1872d-be5a-7b84-b831-65d00005856b","name":"groups","assignment":"default"},{"id":"01a1872d-be60-7e39-be4f-62cbd9d20558","name":"offline_access","assignment":"optional"},{"id":"01a1872d-be41-73ef-af64-901bdd91fa51","name":"openid","assignment":"default"},{"id":"01a1872d-be55-7d06-9f55-76fa04c0a0bc","name":"phone","assignment":"default"},{"id":"01a1872d-be47-7b6d-ba14-a31162354b1f","name":"profile","assignment":"default"},{"id":"01a1872d-be57-7e6c-81fd-34d0d5b6e4c8","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```

An unknown field, on the same tenant:

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-bad-field", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic", "colour": "blue"}' \
  http://localhost:3000/admin/tenants/demo/clients
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1872d-c6d0-7a02-8ce6-ed91030a63eb
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 225
Date: Thu, 29 Oct 2026 10:21:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"colour: colour is not a client field","errors":[{"path":"colour","message":"colour is not a client field"}],"instance":"01a1872d-c6d0-7a02-8ce6-ed91030a63eb"}
```

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

The disable and delete guards further down read `builtin_admin`, and a client's
representation carries it and `service_subject_id` too. This create, the psql
listing and the disable/delete/rotate blocks under `PATCH /clients/{id}`,
`DELETE /clients/{id}` and `POST /clients/{id}/secret` below run in a tenant of
their own, `client-facts-demo`, created for them. The create answers `201`, the
whole client, the tenant's default scope assignments, and the one-time secret.
The `scopes` ids are `client-facts-demo`'s own, created with the tenant:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"client-facts-demo"}' http://localhost:3000/admin/tenants -o /dev/null
```

```bash
curl -sS -D - -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3000/admin/tenants/client-facts-demo/clients
```

```
HTTP/1.1 201 Created
x-request-id: 01a1872d-c73f-70fe-a2ef-06853375ddb0
cache-control: no-store
etag: "82045632406d2b91727aece090bf9626679ec3df6c1d9cc4d7390f7dc98920c5"
content-type: application/json; charset=utf-8
content-length: 2056
Date: Thu, 29 Oct 2026 10:21:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1872d-c76a-77e4-8519-64b40eb15bd3","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:21:26.728Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1872d-c749-7dba-bcc8-443229d49614","scopes":[{"id":"01a1872d-c704-7f62-a40d-081ec8160606","name":"address","assignment":"default"},{"id":"01a1872d-c702-7e6d-a142-0e0097274ba5","name":"email","assignment":"default"},{"id":"01a1872d-c70b-70ea-bbd7-e5a9db6159a9","name":"groups","assignment":"default"},{"id":"01a1872d-c70d-7624-b58c-08ed34102f26","name":"offline_access","assignment":"optional"},{"id":"01a1872d-c6fe-7efd-a260-c3ef29ebfd71","name":"openid","assignment":"default"},{"id":"01a1872d-c706-7ac1-9ac1-ffe1a20f7433","name":"phone","assignment":"default"},{"id":"01a1872d-c700-755f-bd49-9886f34423c1","name":"profile","assignment":"default"},{"id":"01a1872d-c709-7853-b1a6-04ab0bac68a7","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"client_secret":"yeVuKAKE2WFjWES2TWFm489Zl1QX4fnHR0lV3q504ek"}
```

`client_secret` is the only member of that object nothing reads back.
`service_subject_id` is a confidential client's own service account,
created alongside it; `builtin_admin` is `false` here and `true` on the
tenant's own `odudu-admin`, read from the same column the disable and
delete guards below check, not asserted — the psql listing under
`PATCH /clients/{id}` shows both rows.

The reserved `client_id`, refused against `demo`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "odudu-admin", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  http://localhost:3000/admin/tenants/demo/clients
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the client_id \"odudu-admin\" is reserved","instance":"01a1872d-c793-7efe-8bf5-bc933364034f"}
```

Listing pages the same way `GET /admin/tenants` does — `?limit=`, `?cursor=`,
ordered by `id`, a `Link: rel="next"` header and a `next` body member once a
further page exists, no total (`GET /clients/count` below has one). Here the
page of `client-facts-demo` held two clients, the tenant's own `odudu-admin` and
`demo-backend` above:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/client-facts-demo/clients?limit=50
```

```
{"items":[{"id":"01a1872d-c711-7819-b793-c2f3c78540ff","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-10-29T10:21:26.650Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1872d-c704-7f62-a40d-081ec8160606","name":"address","assignment":"default"},{"id":"01a1872d-c702-7e6d-a142-0e0097274ba5","name":"email","assignment":"default"},{"id":"01a1872d-c70b-70ea-bbd7-e5a9db6159a9","name":"groups","assignment":"default"},{"id":"01a1872d-c70d-7624-b58c-08ed34102f26","name":"offline_access","assignment":"optional"},{"id":"01a1872d-c6fe-7efd-a260-c3ef29ebfd71","name":"openid","assignment":"default"},{"id":"01a1872d-c706-7ac1-9ac1-ffe1a20f7433","name":"phone","assignment":"default"},{"id":"01a1872d-c700-755f-bd49-9886f34423c1","name":"profile","assignment":"default"},{"id":"01a1872d-c709-7853-b1a6-04ab0bac68a7","name":"roles","assignment":"default"}],"service_account_admin_reach":[]},{"id":"01a1872d-c76a-77e4-8519-64b40eb15bd3","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:21:26.728Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1872d-c749-7dba-bcc8-443229d49614","scopes":[{"id":"01a1872d-c704-7f62-a40d-081ec8160606","name":"address","assignment":"default"},{"id":"01a1872d-c702-7e6d-a142-0e0097274ba5","name":"email","assignment":"default"},{"id":"01a1872d-c70b-70ea-bbd7-e5a9db6159a9","name":"groups","assignment":"default"},{"id":"01a1872d-c70d-7624-b58c-08ed34102f26","name":"offline_access","assignment":"optional"},{"id":"01a1872d-c6fe-7efd-a260-c3ef29ebfd71","name":"openid","assignment":"default"},{"id":"01a1872d-c706-7ac1-9ac1-ffe1a20f7433","name":"phone","assignment":"default"},{"id":"01a1872d-c700-755f-bd49-9886f34423c1","name":"profile","assignment":"default"},{"id":"01a1872d-c709-7853-b1a6-04ab0bac68a7","name":"roles","assignment":"default"}],"service_account_admin_reach":[]}]}
```

**Search and filters** follow `GET /admin/tenants` above: a prefix of
`?client_id=` or `?name=`, never both, over the stored `client_id_search` and
`name_search` columns (`0074_list_indexes_tenants_clients.sql`), ordered by that
folded column then by `id`; exact filters `?type=public|confidential` and
`?enabled=true|false`, `AND`ed with it and with each other; a cursor bound to
every filter; any other parameter refused with `400` naming it. `demo` holds
`demo-backend`, `demo-exchanger`, `demo-fields-check` and `demo-operator`
(confidential) and `demo-spa` (public):

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?client_id=DEMO&type=confidential&limit=1"
```

```
HTTP/1.1 200 OK
x-request-id: 01a1872d-c7c9-74f3-82ce-63b361724326
cache-control: no-store
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTE4NzJkLWJmNjAtNzc1Mi04YzEzLTg4OWU2MmZhN2U2YiIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMTg3MmQtYmUzYy03YjZkLWE5MTgtNTk5Yzg5ODFmNWNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.HNL7GXc70Bx4vo89exQBb0P9IZVGLU72VpYubZkEo8o>; rel="next"
content-type: application/json; charset=utf-8
content-length: 2326
Date: Thu, 29 Oct 2026 10:21:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1872d-bf60-7752-8c13-889e62fa7e6b","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:21:24.637Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1872d-bf20-7bb5-a4e3-9d10744ac261","scopes":[{"id":"01a1872d-be50-7c99-b10f-59264732dd59","name":"address","assignment":"default"},{"id":"01a1872d-be4c-7b63-b0c0-4728817f0c89","name":"email","assignment":"default"},{"id":"01a1872d-be5a-7b84-b831-65d00005856b","name":"groups","assignment":"default"},{"id":"01a1872d-be60-7e39-be4f-62cbd9d20558","name":"offline_access","assignment":"optional"},{"id":"01a1872d-be41-73ef-af64-901bdd91fa51","name":"openid","assignment":"default"},{"id":"01a1872d-be55-7d06-9f55-76fa04c0a0bc","name":"phone","assignment":"default"},{"id":"01a1872d-be47-7b6d-ba14-a31162354b1f","name":"profile","assignment":"default"},{"id":"01a1872d-be57-7e6c-81fd-34d0d5b6e4c8","name":"roles","assignment":"default"}],"service_account_admin_reach":[]}],"next":"eyJhZnRlciI6IjAxYTE4NzJkLWJmNjAtNzc1Mi04YzEzLTg4OWU2MmZhN2U2YiIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMTg3MmQtYmUzYy03YjZkLWE5MTgtNTk5Yzg5ODFmNWNjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.HNL7GXc70Bx4vo89exQBb0P9IZVGLU72VpYubZkEo8o"}
```

Following that link (`$CURSOR` is the `cursor` in its `link` header, which the
first command takes from a repeat of the request), then `?name=Demo-S`, each cut
down with `jq` to the fields that show the point; then the same cursor replayed
with `?type=` dropped:

```bash
CURSOR=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?client_id=DEMO&type=confidential&limit=1" \
  | tr -d '\r' | sed -n 's/^link: .*cursor=\([^>]*\)>.*/\1/p')
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=$CURSOR" \
  | jq -c '{items: [.items[] | {client_id, name, type}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?name=Demo-S" \
  | jq -c '{items: [.items[] | {client_id, name, type}], next}'
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?limit=1&client_id=DEMO&cursor=$CURSOR"
```

```
{"items":[{"client_id":"demo-exchanger","name":"demo-exchanger","type":"confidential"}],"next":"eyJhZnRlciI6IjAxYTE4NzJkLWMxNGQtN2UxNi1hMDIyLTgxM2I3ZjFhNjdlOSIsInNvcnQiOiJkZW1vLWV4Y2hhbmdlciIsImNvbGxlY3Rpb24iOiJjbGllbnRzIiwidGVuYW50SWQiOiIwMWExODcyZC1iZTNjLTdiNmQtYTkxOC01OTljODk4MWY1Y2MiLCJmaWx0ZXJzIjoiT0FkQ2hRTEk0S3lQa1QxSEtzTkRKV3lYMzg1LVhpYWxCS1JuQ1c5Q09kcyJ9.2Yjt37ZX-hl6-DnaqFtk38ucTW6e237QJmzR_VfJ660"}
{"items":[{"client_id":"demo-spa","name":"demo-spa","type":"public"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a1872d-c851-77c9-97c7-fea16c9ccccc"}
```

A `type` outside the enum, then two search fields at once (the second refusal
names all three searches that may not be combined, `client_id_exact` among
them):

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?type=service"
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/demo/clients?client_id=a&name=b"
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/type must be equal to one of the allowed values","errors":[{"path":"type","message":"must be equal to one of the allowed values"}],"instance":"01a1872d-c865-72af-a685-f566657f4836"}{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: client_id, client_id_exact or name, not more than one","errors":[{"path":"name","message":"search one field at a time: client_id, client_id_exact or name, not more than one"}],"instance":"01a1872d-c873-725a-bd58-5a0df17e4675"}
```

Reading one client by its internal id carries an `ETag` and never the
secret, whether or not one was ever generated:

```bash
AID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/demo/clients?client_id_exact=odudu-admin" | jq -r '.items[0].id')
```

```bash
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/demo/clients/$AID
```

```
HTTP/1.1 200 OK
x-request-id: 01a1872d-c89f-7a6c-a098-26da3bec4c42
cache-control: no-store
etag: "ada0f81eb546b89c5bda3420cdb273f6ffcb21ced963a2ff9913eebdf6f87c82"
content-type: application/json; charset=utf-8
content-length: 2352
Date: Thu, 29 Oct 2026 10:21:27 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1872d-be69-7890-84f5-19e4e449018a","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-10-29T10:21:24.412Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1872d-be50-7c99-b10f-59264732dd59","name":"address","assignment":"default"},{"id":"01a1872d-be4c-7b63-b0c0-4728817f0c89","name":"email","assignment":"default"},{"id":"01a1872d-be5a-7b84-b831-65d00005856b","name":"groups","assignment":"default"},{"id":"01a1872d-be60-7e39-be4f-62cbd9d20558","name":"offline_access","assignment":"optional"},{"id":"01a1872d-be41-73ef-af64-901bdd91fa51","name":"openid","assignment":"default"},{"id":"01a1872d-be55-7d06-9f55-76fa04c0a0bc","name":"phone","assignment":"default"},{"id":"01a1872d-be47-7b6d-ba14-a31162354b1f","name":"profile","assignment":"default"},{"id":"01a1872d-be57-7e6c-81fd-34d0d5b6e4c8","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```
