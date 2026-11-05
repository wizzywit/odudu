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
x-request-id: 01a1adb4-d430-77af-bc45-0f2c54c7ba9b
cache-control: no-store
etag: "9804abb06ece99971a4c461b5e82f7f0c6c595198336699e041a604bf2724407"
content-type: application/json; charset=utf-8
content-length: 2207
Date: Thu, 05 Nov 2026 21:54:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adb4-d459-70a7-a7e2-8c1d4c45e255","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-05T21:54:31.608Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1adb4-d439-70b8-9dc9-85f60891dabe","scopes":[{"id":"01a1adb4-d2e9-7f2f-8d13-b2bbb2945c6d","name":"openid","assignment":"default"},{"id":"01a1adb4-d2ea-7db9-8c9d-50f420e6edb4","name":"profile","assignment":"default"},{"id":"01a1adb4-d2eb-7235-a82d-82a29d170bb6","name":"email","assignment":"default"},{"id":"01a1adb4-d2ec-7866-91a2-042ff19671a9","name":"address","assignment":"default"},{"id":"01a1adb4-d2ee-7577-b038-0e40e6caf392","name":"phone","assignment":"default"},{"id":"01a1adb4-d2ef-7af0-90ce-51ed75ccbfa2","name":"roles","assignment":"default"},{"id":"01a1adb4-d2f0-72f2-b537-d032d98ed0d4","name":"groups","assignment":"default"},{"id":"01a1adb4-d2f1-762a-9da8-3b15ab42f136","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"client_secret":"5IQRKNLq2MjBByG841IdzFKKCF-uV2gF51eYUhDKg7E"}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.

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
x-request-id: 01a1adb4-d4a3-787b-81fe-c1871673c7b4
cache-control: no-store
etag: "9804abb06ece99971a4c461b5e82f7f0c6c595198336699e041a604bf2724407"
content-type: application/json; charset=utf-8
content-length: 2172
Date: Thu, 05 Nov 2026 21:54:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adb4-d459-70a7-a7e2-8c1d4c45e255","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-05T21:54:31.608Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1adb4-d439-70b8-9dc9-85f60891dabe","scopes":[{"id":"01a1adb4-d2e9-7f2f-8d13-b2bbb2945c6d","name":"openid","assignment":"default"},{"id":"01a1adb4-d2ea-7db9-8c9d-50f420e6edb4","name":"profile","assignment":"default"},{"id":"01a1adb4-d2eb-7235-a82d-82a29d170bb6","name":"email","assignment":"default"},{"id":"01a1adb4-d2ec-7866-91a2-042ff19671a9","name":"address","assignment":"default"},{"id":"01a1adb4-d2ee-7577-b038-0e40e6caf392","name":"phone","assignment":"default"},{"id":"01a1adb4-d2ef-7af0-90ce-51ed75ccbfa2","name":"roles","assignment":"default"},{"id":"01a1adb4-d2f0-72f2-b537-d032d98ed0d4","name":"groups","assignment":"default"},{"id":"01a1adb4-d2f1-762a-9da8-3b15ab42f136","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.

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
x-request-id: 01a1adb4-d52b-75b6-8e74-67fdafc72a32
cache-control: no-store
etag: "c266d195c5a3522328ccddfc8d5db33498ceb294a285e9472b42db1698e257d5"
content-type: application/json; charset=utf-8
content-length: 2145
Date: Thu, 05 Nov 2026 21:54:31 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adb4-d551-7631-b762-f01ea5c561d9","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-05T21:54:31.859Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1adb4-d534-731e-9238-4a040d843c08","scopes":[{"id":"01a1adb4-d4e4-7c0e-955f-f765235b8e3f","name":"address","assignment":"default"},{"id":"01a1adb4-d4e3-7771-8f74-ad39a5a6aef7","name":"email","assignment":"default"},{"id":"01a1adb4-d4e8-7349-b3bc-6caeff8cd1a8","name":"groups","assignment":"default"},{"id":"01a1adb4-d4ea-72f6-b6d9-1feca771f2bf","name":"offline_access","assignment":"optional"},{"id":"01a1adb4-d4e0-7e7f-a13c-df47a8fa6a8d","name":"openid","assignment":"default"},{"id":"01a1adb4-d4e6-7b97-bb20-035becb698fe","name":"phone","assignment":"default"},{"id":"01a1adb4-d4e2-7b46-94b2-0719a7f060a5","name":"profile","assignment":"default"},{"id":"01a1adb4-d4e7-79dc-b3f2-832530a138ca","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"client_secret":"NTBprs480dGXGCvBnSVxDMRVuUGFTaOL0l-zOVTTXsI"}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.

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

Every tenant is also provisioned with `odudu-mcp`, a public client for local
MCP tools: loopback redirect URIs registered without a port, the code and
refresh grants, `urn:odudu:params:admin-api` as its audience, and consent
required. Its `client_id` is reserved the same way. This and the next three
blocks were run on a freshly built stack against a tenant `mcp-demo` created
for them, so the tenant holds nothing else:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3092/admin/tenants/mcp-demo/clients" \
  | jq -c '.items[] | {client_id, type, builtin_admin, token_endpoint_auth_method, redirect_uris, grant_types, audiences, consent_required}'
```

```
{"client_id":"odudu-admin","type":"confidential","builtin_admin":true,"token_endpoint_auth_method":"private_key_jwt","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3092/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"audiences":["urn:odudu:params:admin-api"],"consent_required":false}
{"client_id":"odudu-mcp","type":"public","builtin_admin":false,"token_endpoint_auth_method":"none","redirect_uris":["http://127.0.0.1","http://[::1]"],"grant_types":["authorization_code","refresh_token"],"audiences":["urn:odudu:params:admin-api"],"consent_required":true}
```

The client is reserved at creation, like `odudu-admin`:

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "odudu-mcp", "token_endpoint_auth_method": "none"}' \
  http://localhost:3092/admin/tenants/mcp-demo/clients
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"the client_id \"odudu-mcp\" is reserved","instance":"01a1ac04-0eae-7942-8cef-2fd94ae8d699"}
```

`/authorize` accepts any port for a loopback IP literal that a public client
registered without one (RFC 8252 section 7.3), and nothing else: the same
request with `localhost`, or with a path the registration does not carry, is
refused on the page and never redirected to. The three requests, by status
(the first is the sign-in page; the others carry the body `Unregistered redirect
URI`):

```bash
Q='response_type=code&client_id=odudu-mcp&scope=mcp%3Aread&resource=urn%3Aodudu%3Aparams%3Aadmin-api&state=s&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
for R in 'http%3A%2F%2F127.0.0.1%3A53211%2F' 'http%3A%2F%2Flocalhost%3A53211%2F' 'http%3A%2F%2F127.0.0.1%3A53211%2Fcallback'; do
  curl -sS -o /dev/null -w '%{http_code}\n' "http://localhost:3092/tenants/mcp-demo/protocol/openid-connect/auth?$Q&redirect_uri=$R"
done
```

```
200
400
400
```

Listing pages the same way `GET /admin/tenants` does — `?limit=`, `?cursor=`,
ordered by `id`, a `Link: rel="next"` header and a `next` body member once a
further page exists, no total (`GET /clients/count` below has one). Here the
page of `client-facts-demo` held two clients, the tenant's own `odudu-admin` and
`demo-backend` above. That run predates `odudu-mcp`: a tenant created now holds it
as a third (the block above), and the counts in the blocks below that page through
`demo` were not re-run:

```bash
curl -sS \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/client-facts-demo/clients?limit=50
```

```
{"items":[{"id":"01a1adb4-d4ed-78d5-a658-827de0dbadf1","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-11-05T21:54:31.775Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1adb4-d4e4-7c0e-955f-f765235b8e3f","name":"address","assignment":"default"},{"id":"01a1adb4-d4e3-7771-8f74-ad39a5a6aef7","name":"email","assignment":"default"},{"id":"01a1adb4-d4e8-7349-b3bc-6caeff8cd1a8","name":"groups","assignment":"default"},{"id":"01a1adb4-d4ea-72f6-b6d9-1feca771f2bf","name":"offline_access","assignment":"optional"},{"id":"01a1adb4-d4e0-7e7f-a13c-df47a8fa6a8d","name":"openid","assignment":"default"},{"id":"01a1adb4-d4e6-7b97-bb20-035becb698fe","name":"phone","assignment":"default"},{"id":"01a1adb4-d4e2-7b46-94b2-0719a7f060a5","name":"profile","assignment":"default"},{"id":"01a1adb4-d4e7-79dc-b3f2-832530a138ca","name":"roles","assignment":"default"}],"service_account_admin_reach":[]},{"id":"01a1adb4-d510-7798-a34a-adb472ab1617","client_id":"odudu-mcp","name":"Odudu MCP","description":null,"name_i18n":{},"description_i18n":{},"type":"public","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"seeded","created_at":"2026-11-05T21:54:31.775Z","redirect_uris":["http://127.0.0.1","http://[::1]"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"none","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":true,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a1adb4-d4e4-7c0e-955f-f765235b8e3f","name":"address","assignment":"default"},{"id":"01a1adb4-d4e3-7771-8f74-ad39a5a6aef7","name":"email","assignment":"default"},{"id":"01a1adb4-d4e8-7349-b3bc-6caeff8cd1a8","name":"groups","assignment":"default"},{"id":"01a1adb4-d4ea-72f6-b6d9-1feca771f2bf","name":"offline_access","assignment":"optional"},{"id":"01a1adb4-d4e0-7e7f-a13c-df47a8fa6a8d","name":"openid","assignment":"default"},{"id":"01a1adb4-d4e6-7b97-bb20-035becb698fe","name":"phone","assignment":"default"},{"id":"01a1adb4-d4e2-7b46-94b2-0719a7f060a5","name":"profile","assignment":"default"},{"id":"01a1adb4-d4e7-79dc-b3f2-832530a138ca","name":"roles","assignment":"default"},{"id":"01a1adb4-d4ea-72f6-b6d9-1fed9452a3ca","name":"mcp:read","assignment":"default"},{"id":"01a1adb4-d4eb-79ad-8100-08e0f29805b1","name":"mcp:write","assignment":"optional"}],"service_account_admin_reach":[]},{"id":"01a1adb4-d551-7631-b762-f01ea5c561d9","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-05T21:54:31.859Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1adb4-d534-731e-9238-4a040d843c08","scopes":[{"id":"01a1adb4-d4e4-7c0e-955f-f765235b8e3f","name":"address","assignment":"default"},{"id":"01a1adb4-d4e3-7771-8f74-ad39a5a6aef7","name":"email","assignment":"default"},{"id":"01a1adb4-d4e8-7349-b3bc-6caeff8cd1a8","name":"groups","assignment":"default"},{"id":"01a1adb4-d4ea-72f6-b6d9-1feca771f2bf","name":"offline_access","assignment":"optional"},{"id":"01a1adb4-d4e0-7e7f-a13c-df47a8fa6a8d","name":"openid","assignment":"default"},{"id":"01a1adb4-d4e6-7b97-bb20-035becb698fe","name":"phone","assignment":"default"},{"id":"01a1adb4-d4e2-7b46-94b2-0719a7f060a5","name":"profile","assignment":"default"},{"id":"01a1adb4-d4e7-79dc-b3f2-832530a138ca","name":"roles","assignment":"default"}],"service_account_admin_reach":[]}]}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.

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
x-request-id: 01a1adb4-d5cf-7099-9739-079cae3d3570
cache-control: no-store
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTFhZGI0LWQzNjAtNzg1MS1iMmE3LTg1ZjI3NmQ4ZGM3YyIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMWFkYjQtZDJlNy03ZGZjLThiMjAtYzEyMjVmZDc2NGVjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.PhOVMPMu7PWTS78WyMPzDJDgq4RvagB6htwWLgsAISc>; rel="next"
content-type: application/json; charset=utf-8
content-length: 2415
Date: Thu, 05 Nov 2026 21:54:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1adb4-d360-7851-b2a7-85f276d8dc7c","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-05T21:54:31.344Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1adb4-d331-75fd-84a5-da6e6b4fb158","scopes":[{"id":"01a1adb4-d2e9-7f2f-8d13-b2bbb2945c6d","name":"openid","assignment":"default"},{"id":"01a1adb4-d2ea-7db9-8c9d-50f420e6edb4","name":"profile","assignment":"default"},{"id":"01a1adb4-d2eb-7235-a82d-82a29d170bb6","name":"email","assignment":"default"},{"id":"01a1adb4-d2ec-7866-91a2-042ff19671a9","name":"address","assignment":"default"},{"id":"01a1adb4-d2ee-7577-b038-0e40e6caf392","name":"phone","assignment":"default"},{"id":"01a1adb4-d2ef-7af0-90ce-51ed75ccbfa2","name":"roles","assignment":"default"},{"id":"01a1adb4-d2f0-72f2-b537-d032d98ed0d4","name":"groups","assignment":"default"},{"id":"01a1adb4-d2f1-762a-9da8-3b15ab42f136","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[]}],"next":"eyJhZnRlciI6IjAxYTFhZGI0LWQzNjAtNzg1MS1iMmE3LTg1ZjI3NmQ4ZGM3YyIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMWFkYjQtZDJlNy03ZGZjLThiMjAtYzEyMjVmZDc2NGVjIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.PhOVMPMu7PWTS78WyMPzDJDgq4RvagB6htwWLgsAISc"}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.

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
x-request-id: 01a1adb4-d68d-7130-a0c2-cb84996670fd
cache-control: no-store
etag: "50e71bc4548ba51e81b0174e88dfc3dc8c65e7be04412d6e0368b296f8896b08"
content-type: application/json; charset=utf-8
content-length: 2441
Date: Thu, 05 Nov 2026 21:54:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1adb4-d2f4-7ce2-bdcc-e5cc595a17bc","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-11-05T21:54:31.271Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1adb4-d2ec-7866-91a2-042ff19671a9","name":"address","assignment":"default"},{"id":"01a1adb4-d2eb-7235-a82d-82a29d170bb6","name":"email","assignment":"default"},{"id":"01a1adb4-d2f0-72f2-b537-d032d98ed0d4","name":"groups","assignment":"default"},{"id":"01a1adb4-d2f1-762a-9da8-3b15ab42f136","name":"offline_access","assignment":"optional"},{"id":"01a1adb4-d2e9-7f2f-8d13-b2bbb2945c6d","name":"openid","assignment":"default"},{"id":"01a1adb4-d2ee-7577-b038-0e40e6caf392","name":"phone","assignment":"default"},{"id":"01a1adb4-d2ea-7db9-8c9d-50f420e6edb4","name":"profile","assignment":"default"},{"id":"01a1adb4-d2ef-7af0-90ce-51ed75ccbfa2","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.
