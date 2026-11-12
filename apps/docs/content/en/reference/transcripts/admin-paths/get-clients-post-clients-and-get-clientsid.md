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
`full_scope_allowed`, `allowed_actions` (the credential changes the client may send a person to, [on `PATCH`](./patch-clientsid.md#the-actions-a-client-may-start)) and `name` — each checked by the identical validation
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
x-request-id: 01a1cc86-4f48-7ec5-bcd7-16d08bd38cbd
cache-control: no-store
etag: "5bb3780b3199d7e203fc4f169bdad4a595dbda9bb2591429f92a46b8abf0c69c"
content-type: application/json; charset=utf-8
content-length: 2228
Date: Wed, 11 Nov 2026 21:31:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1cc86-4f6f-75ab-a706-a969eedc0094","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-11T21:31:56.625Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1cc86-4f71-75c9-a787-66dafba863b1","scopes":[{"id":"01a1cc86-4de5-75e0-a429-f722b2f4c037","name":"address","assignment":"default"},{"id":"01a1cc86-4de3-72bc-802e-a7472e413ba3","name":"email","assignment":"default"},{"id":"01a1cc86-4de9-76e2-a760-ab8ec92856f2","name":"groups","assignment":"default"},{"id":"01a1cc86-4dea-7c26-9475-b58b29ca827e","name":"offline_access","assignment":"optional"},{"id":"01a1cc86-4de1-726c-9a0e-9ab77ba4445a","name":"openid","assignment":"default"},{"id":"01a1cc86-4de6-7a39-b189-d3ed3cf9d0f5","name":"phone","assignment":"default"},{"id":"01a1cc86-4de2-7dc9-a3f0-5584f8382285","name":"profile","assignment":"default"},{"id":"01a1cc86-4de8-7ada-9697-dcadb77a1275","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"client_secret":"yjd5oQw7199j3XLs4zu4Bfcdq576yAvHD23RUuLSPpk"}
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
x-request-id: 01a1cc86-4fc1-785f-8654-191dbdabe3cd
cache-control: no-store
etag: "5bb3780b3199d7e203fc4f169bdad4a595dbda9bb2591429f92a46b8abf0c69c"
content-type: application/json; charset=utf-8
content-length: 2193
Date: Wed, 11 Nov 2026 21:31:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1cc86-4f6f-75ab-a706-a969eedc0094","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-11T21:31:56.625Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1cc86-4f71-75c9-a787-66dafba863b1","scopes":[{"id":"01a1cc86-4de5-75e0-a429-f722b2f4c037","name":"address","assignment":"default"},{"id":"01a1cc86-4de3-72bc-802e-a7472e413ba3","name":"email","assignment":"default"},{"id":"01a1cc86-4de9-76e2-a760-ab8ec92856f2","name":"groups","assignment":"default"},{"id":"01a1cc86-4dea-7c26-9475-b58b29ca827e","name":"offline_access","assignment":"optional"},{"id":"01a1cc86-4de1-726c-9a0e-9ab77ba4445a","name":"openid","assignment":"default"},{"id":"01a1cc86-4de6-7a39-b189-d3ed3cf9d0f5","name":"phone","assignment":"default"},{"id":"01a1cc86-4de2-7dc9-a3f0-5584f8382285","name":"profile","assignment":"default"},{"id":"01a1cc86-4de8-7ada-9697-dcadb77a1275","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
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
x-request-id: 01a1cc86-4fe6-7a72-b001-7593351b65fc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 225
Date: Wed, 11 Nov 2026 21:31:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"colour: colour is not a client field","errors":[{"path":"colour","message":"colour is not a client field"}],"instance":"01a1cc86-4fe6-7a72-b001-7593351b65fc"}
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
x-request-id: 01a1cc86-504d-7569-8d82-46bca08877e4
cache-control: no-store
etag: "eeb952aeccb292f5f6667cfb7fbd36412b488a508beea55313d4e0b6fa086af1"
content-type: application/json; charset=utf-8
content-length: 2166
Date: Wed, 11 Nov 2026 21:31:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1cc86-506f-7174-b303-3399c3a72f96","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-11T21:31:56.885Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1cc86-5071-7765-b310-f6f8c2bf77fd","scopes":[{"id":"01a1cc86-5007-7057-8f8a-874d07792be7","name":"address","assignment":"default"},{"id":"01a1cc86-5006-7731-a38b-2b5f46ed3c78","name":"email","assignment":"default"},{"id":"01a1cc86-500b-7792-974f-e171b115a4cf","name":"groups","assignment":"default"},{"id":"01a1cc86-500c-79bb-bbc8-5b2332756ab3","name":"offline_access","assignment":"optional"},{"id":"01a1cc86-5003-79aa-a0ea-93f7a95c7345","name":"openid","assignment":"default"},{"id":"01a1cc86-5008-78ff-818e-569221ae6b0a","name":"phone","assignment":"default"},{"id":"01a1cc86-5005-74ec-987d-91ae01eddc9c","name":"profile","assignment":"default"},{"id":"01a1cc86-5009-7cf3-9d0b-80ee21402963","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"client_secret":"K3jDREW8rMnTyglPOSg2331_3kaOe4hZW1LpkfGsFdo"}
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
{"type":"about:blank","title":"Conflict","status":409,"detail":"the client_id \"odudu-admin\" is reserved","instance":"01a1cc86-509a-76da-a226-4e33ec7ca893"}
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
{"items":[{"id":"01a1cc86-5010-7e38-8d3d-5c3db568692c","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-11-11T21:31:56.801Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1cc86-5003-79aa-a0ea-93f7a95c7345","name":"openid","assignment":"default"},{"id":"01a1cc86-5005-74ec-987d-91ae01eddc9c","name":"profile","assignment":"default"},{"id":"01a1cc86-5006-7731-a38b-2b5f46ed3c78","name":"email","assignment":"default"},{"id":"01a1cc86-5007-7057-8f8a-874d07792be7","name":"address","assignment":"default"},{"id":"01a1cc86-5008-78ff-818e-569221ae6b0a","name":"phone","assignment":"default"},{"id":"01a1cc86-5009-7cf3-9d0b-80ee21402963","name":"roles","assignment":"default"},{"id":"01a1cc86-500b-7792-974f-e171b115a4cf","name":"groups","assignment":"default"},{"id":"01a1cc86-500c-79bb-bbc8-5b2332756ab3","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[]},{"id":"01a1cc86-5030-7b2b-b90a-8dbc66fed6ae","client_id":"odudu-mcp","name":"Odudu MCP","description":null,"name_i18n":{},"description_i18n":{},"type":"public","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"seeded","created_at":"2026-11-11T21:31:56.801Z","redirect_uris":["http://127.0.0.1","http://[::1]"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"none","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":true,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a1cc86-5003-79aa-a0ea-93f7a95c7345","name":"openid","assignment":"default"},{"id":"01a1cc86-5005-74ec-987d-91ae01eddc9c","name":"profile","assignment":"default"},{"id":"01a1cc86-5006-7731-a38b-2b5f46ed3c78","name":"email","assignment":"default"},{"id":"01a1cc86-5007-7057-8f8a-874d07792be7","name":"address","assignment":"default"},{"id":"01a1cc86-5008-78ff-818e-569221ae6b0a","name":"phone","assignment":"default"},{"id":"01a1cc86-5009-7cf3-9d0b-80ee21402963","name":"roles","assignment":"default"},{"id":"01a1cc86-500b-7792-974f-e171b115a4cf","name":"groups","assignment":"default"},{"id":"01a1cc86-500c-79bb-bbc8-5b2332756ab3","name":"offline_access","assignment":"optional"},{"id":"01a1cc86-500c-79bb-bbc8-5b243491d12a","name":"mcp:read","assignment":"default"},{"id":"01a1cc86-500d-77d9-ab38-788b4bacb099","name":"mcp:write","assignment":"optional"}],"service_account_admin_reach":[]},{"id":"01a1cc86-506f-7174-b303-3399c3a72f96","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-11T21:31:56.885Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1cc86-5071-7765-b310-f6f8c2bf77fd","scopes":[{"id":"01a1cc86-5003-79aa-a0ea-93f7a95c7345","name":"openid","assignment":"default"},{"id":"01a1cc86-5005-74ec-987d-91ae01eddc9c","name":"profile","assignment":"default"},{"id":"01a1cc86-5006-7731-a38b-2b5f46ed3c78","name":"email","assignment":"default"},{"id":"01a1cc86-5007-7057-8f8a-874d07792be7","name":"address","assignment":"default"},{"id":"01a1cc86-5008-78ff-818e-569221ae6b0a","name":"phone","assignment":"default"},{"id":"01a1cc86-5009-7cf3-9d0b-80ee21402963","name":"roles","assignment":"default"},{"id":"01a1cc86-500b-7792-974f-e171b115a4cf","name":"groups","assignment":"default"},{"id":"01a1cc86-500c-79bb-bbc8-5b2332756ab3","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[]}]}
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
x-request-id: 01a1cc86-50da-7489-b77d-1549faa8437d
cache-control: no-store
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTFjYzg2LTRlNWQtNzk4ZC05OWFhLWM1MDdiYjA3YzZlOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMWNjODYtNGRkZC03ZThiLTgzMTktNmE4MGM4N2M0ODBiIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.XavFOIA9s6FHouzN8ZnmzEEa6oOf6e_kkOoLjgCRNtM>; rel="next"
content-type: application/json; charset=utf-8
content-length: 2436
Date: Wed, 11 Nov 2026 21:31:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1cc86-4e5d-798d-99aa-c507bb07c6e9","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-11T21:31:56.353Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1cc86-4e60-7425-9771-86eec9f62bed","scopes":[{"id":"01a1cc86-4de5-75e0-a429-f722b2f4c037","name":"address","assignment":"default"},{"id":"01a1cc86-4de3-72bc-802e-a7472e413ba3","name":"email","assignment":"default"},{"id":"01a1cc86-4de9-76e2-a760-ab8ec92856f2","name":"groups","assignment":"default"},{"id":"01a1cc86-4dea-7c26-9475-b58b29ca827e","name":"offline_access","assignment":"optional"},{"id":"01a1cc86-4de1-726c-9a0e-9ab77ba4445a","name":"openid","assignment":"default"},{"id":"01a1cc86-4de6-7a39-b189-d3ed3cf9d0f5","name":"phone","assignment":"default"},{"id":"01a1cc86-4de2-7dc9-a3f0-5584f8382285","name":"profile","assignment":"default"},{"id":"01a1cc86-4de8-7ada-9697-dcadb77a1275","name":"roles","assignment":"default"}],"service_account_admin_reach":[]}],"next":"eyJhZnRlciI6IjAxYTFjYzg2LTRlNWQtNzk4ZC05OWFhLWM1MDdiYjA3YzZlOSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMWNjODYtNGRkZC03ZThiLTgzMTktNmE4MGM4N2M0ODBiIiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.XavFOIA9s6FHouzN8ZnmzEEa6oOf6e_kkOoLjgCRNtM"}
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
{"items":[{"client_id":"demo-exchanger","name":"demo-exchanger","type":"confidential"}],"next":"eyJhZnRlciI6IjAxYTFjYzg2LTRlYWMtN2IzYy05YTllLWFmMzdhNTdhMzlmNiIsInNvcnQiOiJkZW1vLWV4Y2hhbmdlciIsImNvbGxlY3Rpb24iOiJjbGllbnRzIiwidGVuYW50SWQiOiIwMWExY2M4Ni00ZGRkLTdlOGItODMxOS02YTgwYzg3YzQ4MGIiLCJmaWx0ZXJzIjoiT0FkQ2hRTEk0S3lQa1QxSEtzTkRKV3lYMzg1LVhpYWxCS1JuQ1c5Q09kcyJ9.50p667wrILXny_8UTMjIaKeqOOcOadFXP1PaBO3UV1Y"}
{"items":[{"client_id":"demo-spa","name":"demo-spa","type":"public"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a1cc86-5167-7682-b024-46e5058b2a0f"}
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
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/type must be equal to one of the allowed values","errors":[{"path":"type","message":"must be equal to one of the allowed values"}],"instance":"01a1cc86-517e-7227-8d07-5ba99c7486b7"}{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: client_id, client_id_exact or name, not more than one","errors":[{"path":"name","message":"search one field at a time: client_id, client_id_exact or name, not more than one"}],"instance":"01a1cc86-518a-71a1-b3b7-510ff552cb7c"}
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
x-request-id: 01a1cc86-51b8-70e9-a17e-32719d492eb3
cache-control: no-store
etag: "31fcc484fc2f4fa34714ad76e24304eb87c108403dddda09dccaf22c6c78af80"
content-type: application/json; charset=utf-8
content-length: 2462
Date: Wed, 11 Nov 2026 21:31:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1cc86-4def-7e6e-a14d-84450e7fa45b","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-11-11T21:31:56.254Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1cc86-4de5-75e0-a429-f722b2f4c037","name":"address","assignment":"default"},{"id":"01a1cc86-4de3-72bc-802e-a7472e413ba3","name":"email","assignment":"default"},{"id":"01a1cc86-4de9-76e2-a760-ab8ec92856f2","name":"groups","assignment":"default"},{"id":"01a1cc86-4dea-7c26-9475-b58b29ca827e","name":"offline_access","assignment":"optional"},{"id":"01a1cc86-4de1-726c-9a0e-9ab77ba4445a","name":"openid","assignment":"default"},{"id":"01a1cc86-4de6-7a39-b189-d3ed3cf9d0f5","name":"phone","assignment":"default"},{"id":"01a1cc86-4de2-7dc9-a3f0-5584f8382285","name":"profile","assignment":"default"},{"id":"01a1cc86-4de8-7ada-9697-dcadb77a1275","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.
