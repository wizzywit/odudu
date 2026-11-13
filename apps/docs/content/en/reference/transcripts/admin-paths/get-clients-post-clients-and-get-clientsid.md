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
`full_scope_allowed`, `allowed_actions` (the credential changes the client may send a person to, [on `PATCH`](./patch-clientsid.md#the-actions-a-client-may-start)), `flow_id` (the sign-in flow the client runs, [on `PATCH`](./patch-clientsid.md#the-flow-a-client-runs)) and `name` — each checked by the identical validation
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
x-request-id: 01a1d3a2-8833-75b2-944e-e19c8fad7ed7
cache-control: no-store
etag: "e7010f2da4a30cdb8bdbaa46c825316432f436e3438c13007afbbafdc9fcb514"
content-type: application/json; charset=utf-8
content-length: 2243
Date: Fri, 13 Nov 2026 06:40:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a2-885e-75d5-8e13-108384c57ebb","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-13T06:40:06.718Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1d3a2-8860-7cd5-8cdd-e4fc1142e216","scopes":[{"id":"01a1d3a2-80ba-7e35-a5be-856f1e11bf0e","name":"openid","assignment":"default"},{"id":"01a1d3a2-80be-78cd-acb3-b9792599fc1d","name":"profile","assignment":"default"},{"id":"01a1d3a2-80c0-7834-958f-7b1b73f0d468","name":"email","assignment":"default"},{"id":"01a1d3a2-80c2-7240-80ed-e5bb5abf0a6d","name":"address","assignment":"default"},{"id":"01a1d3a2-80c5-7062-bb6e-1d784a891531","name":"phone","assignment":"default"},{"id":"01a1d3a2-80c7-7ae7-92cc-abd79a415191","name":"roles","assignment":"default"},{"id":"01a1d3a2-80c9-73a1-9d27-4ff2d6a7732d","name":"groups","assignment":"default"},{"id":"01a1d3a2-80ca-761a-8419-7769e1291760","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"client_secret":"hY183lBJQUDyo7IG1xMzTlnYoiVFe1mK1fl4CzUSy3U"}
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
x-request-id: 01a1d3a2-88c4-75f6-a6b8-bf9ae3eacdec
cache-control: no-store
etag: "e7010f2da4a30cdb8bdbaa46c825316432f436e3438c13007afbbafdc9fcb514"
content-type: application/json; charset=utf-8
content-length: 2208
Date: Fri, 13 Nov 2026 06:40:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a2-885e-75d5-8e13-108384c57ebb","client_id":"demo-fields-check","name":"demo-fields-check","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-13T06:40:06.718Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["https://api.demo.example"],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":["https://app.demo.example"],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1d3a2-8860-7cd5-8cdd-e4fc1142e216","scopes":[{"id":"01a1d3a2-80ba-7e35-a5be-856f1e11bf0e","name":"openid","assignment":"default"},{"id":"01a1d3a2-80be-78cd-acb3-b9792599fc1d","name":"profile","assignment":"default"},{"id":"01a1d3a2-80c0-7834-958f-7b1b73f0d468","name":"email","assignment":"default"},{"id":"01a1d3a2-80c2-7240-80ed-e5bb5abf0a6d","name":"address","assignment":"default"},{"id":"01a1d3a2-80c5-7062-bb6e-1d784a891531","name":"phone","assignment":"default"},{"id":"01a1d3a2-80c7-7ae7-92cc-abd79a415191","name":"roles","assignment":"default"},{"id":"01a1d3a2-80c9-73a1-9d27-4ff2d6a7732d","name":"groups","assignment":"default"},{"id":"01a1d3a2-80ca-761a-8419-7769e1291760","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"supported_locales":["en"]}
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
x-request-id: 01a1d3a2-88ef-7916-8ffa-4ec74f69678b
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 225
Date: Fri, 13 Nov 2026 06:40:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"colour: colour is not a client field","errors":[{"path":"colour","message":"colour is not a client field"}],"instance":"01a1d3a2-88ef-7916-8ffa-4ec74f69678b"}
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
x-request-id: 01a1d3a2-896c-7266-9dfc-73666afaf7b7
cache-control: no-store
etag: "20a8d4b43590f834972ef667b96bd26724acbaa6515c1b5a069452fe1c03252b"
content-type: application/json; charset=utf-8
content-length: 2181
Date: Fri, 13 Nov 2026 06:40:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a2-8995-7eeb-bf21-48ca4b862b3f","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-13T06:40:07.030Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1d3a2-8997-7d58-8907-a0f5c9d5a87b","scopes":[{"id":"01a1d3a2-8912-710c-9005-696cf93add2e","name":"openid","assignment":"default"},{"id":"01a1d3a2-8913-7690-a7cb-b4b9504c39e2","name":"profile","assignment":"default"},{"id":"01a1d3a2-8915-7ec2-b9ff-06d3ff68010b","name":"email","assignment":"default"},{"id":"01a1d3a2-8916-7ce3-91ba-77ea1dadbb1e","name":"address","assignment":"default"},{"id":"01a1d3a2-8917-74c9-9107-f84bfbec87b9","name":"phone","assignment":"default"},{"id":"01a1d3a2-8919-72a0-b486-422b815614ee","name":"roles","assignment":"default"},{"id":"01a1d3a2-891a-79ce-acaa-0362ed574ac0","name":"groups","assignment":"default"},{"id":"01a1d3a2-891b-77d6-a915-5bd4e6bd36a2","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"client_secret":"3KUfKD5aq1KUCzI6E8wP5gEuDflGs42nFqQbVgLDG30"}
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
{"type":"about:blank","title":"Conflict","status":409,"detail":"the client_id \"odudu-admin\" is reserved","instance":"01a1d3a2-89c3-70a1-9b0d-f7ba4ffac3f5"}
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
{"items":[{"id":"01a1d3a2-8921-70ce-af8e-4e1cbf000f16","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-11-13T06:40:06.928Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1d3a2-8912-710c-9005-696cf93add2e","name":"openid","assignment":"default"},{"id":"01a1d3a2-8913-7690-a7cb-b4b9504c39e2","name":"profile","assignment":"default"},{"id":"01a1d3a2-8915-7ec2-b9ff-06d3ff68010b","name":"email","assignment":"default"},{"id":"01a1d3a2-8916-7ce3-91ba-77ea1dadbb1e","name":"address","assignment":"default"},{"id":"01a1d3a2-8917-74c9-9107-f84bfbec87b9","name":"phone","assignment":"default"},{"id":"01a1d3a2-8919-72a0-b486-422b815614ee","name":"roles","assignment":"default"},{"id":"01a1d3a2-891a-79ce-acaa-0362ed574ac0","name":"groups","assignment":"default"},{"id":"01a1d3a2-891b-77d6-a915-5bd4e6bd36a2","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[]},{"id":"01a1d3a2-894b-73a4-83cc-a55b19b0d2cb","client_id":"odudu-mcp","name":"Odudu MCP","description":null,"name_i18n":{},"description_i18n":{},"type":"public","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"seeded","created_at":"2026-11-13T06:40:06.928Z","redirect_uris":["http://127.0.0.1","http://[::1]"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"none","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":true,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a1d3a2-8912-710c-9005-696cf93add2e","name":"openid","assignment":"default"},{"id":"01a1d3a2-8913-7690-a7cb-b4b9504c39e2","name":"profile","assignment":"default"},{"id":"01a1d3a2-8915-7ec2-b9ff-06d3ff68010b","name":"email","assignment":"default"},{"id":"01a1d3a2-8916-7ce3-91ba-77ea1dadbb1e","name":"address","assignment":"default"},{"id":"01a1d3a2-8917-74c9-9107-f84bfbec87b9","name":"phone","assignment":"default"},{"id":"01a1d3a2-8919-72a0-b486-422b815614ee","name":"roles","assignment":"default"},{"id":"01a1d3a2-891a-79ce-acaa-0362ed574ac0","name":"groups","assignment":"default"},{"id":"01a1d3a2-891b-77d6-a915-5bd4e6bd36a2","name":"offline_access","assignment":"optional"},{"id":"01a1d3a2-891c-7572-8a76-fc976aca7e84","name":"mcp:read","assignment":"default"},{"id":"01a1d3a2-891d-741b-9ae1-f103ff579081","name":"mcp:write","assignment":"optional"}],"service_account_admin_reach":[]},{"id":"01a1d3a2-8995-7eeb-bf21-48ca4b862b3f","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-13T06:40:07.030Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1d3a2-8997-7d58-8907-a0f5c9d5a87b","scopes":[{"id":"01a1d3a2-8912-710c-9005-696cf93add2e","name":"openid","assignment":"default"},{"id":"01a1d3a2-8913-7690-a7cb-b4b9504c39e2","name":"profile","assignment":"default"},{"id":"01a1d3a2-8915-7ec2-b9ff-06d3ff68010b","name":"email","assignment":"default"},{"id":"01a1d3a2-8916-7ce3-91ba-77ea1dadbb1e","name":"address","assignment":"default"},{"id":"01a1d3a2-8917-74c9-9107-f84bfbec87b9","name":"phone","assignment":"default"},{"id":"01a1d3a2-8919-72a0-b486-422b815614ee","name":"roles","assignment":"default"},{"id":"01a1d3a2-891a-79ce-acaa-0362ed574ac0","name":"groups","assignment":"default"},{"id":"01a1d3a2-891b-77d6-a915-5bd4e6bd36a2","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[]}]}
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
x-request-id: 01a1d3a2-8a34-73ee-93cd-30c025965171
cache-control: no-store
link: </admin/tenants/demo/clients?limit=1&client_id=DEMO&type=confidential&cursor=eyJhZnRlciI6IjAxYTFkM2EyLTg2ZGQtNzkxZi1hOWU3LTBhN2M4YzIzYjYzNSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMWQzYTItODA5Zi03NTRjLWFkNTQtMTJiYTE1YjllMjY4IiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.iqtn5gfJpnZTG6evVmz1s0oH_Ev3XLhCtgC8tYjP6I0>; rel="next"
content-type: application/json; charset=utf-8
content-length: 2451
Date: Fri, 13 Nov 2026 06:40:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a1d3a2-86dd-791f-a9e7-0a7c8c23b635","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-13T06:40:06.333Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a1d3a2-86df-775b-8702-a13dade9aea2","scopes":[{"id":"01a1d3a2-80ba-7e35-a5be-856f1e11bf0e","name":"openid","assignment":"default"},{"id":"01a1d3a2-80be-78cd-acb3-b9792599fc1d","name":"profile","assignment":"default"},{"id":"01a1d3a2-80c0-7834-958f-7b1b73f0d468","name":"email","assignment":"default"},{"id":"01a1d3a2-80c2-7240-80ed-e5bb5abf0a6d","name":"address","assignment":"default"},{"id":"01a1d3a2-80c5-7062-bb6e-1d784a891531","name":"phone","assignment":"default"},{"id":"01a1d3a2-80c7-7ae7-92cc-abd79a415191","name":"roles","assignment":"default"},{"id":"01a1d3a2-80c9-73a1-9d27-4ff2d6a7732d","name":"groups","assignment":"default"},{"id":"01a1d3a2-80ca-761a-8419-7769e1291760","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[]}],"next":"eyJhZnRlciI6IjAxYTFkM2EyLTg2ZGQtNzkxZi1hOWU3LTBhN2M4YzIzYjYzNSIsInNvcnQiOiJkZW1vLWJhY2tlbmQiLCJjb2xsZWN0aW9uIjoiY2xpZW50cyIsInRlbmFudElkIjoiMDFhMWQzYTItODA5Zi03NTRjLWFkNTQtMTJiYTE1YjllMjY4IiwiZmlsdGVycyI6Ik9BZENoUUxJNEt5UGtUMUhLc05ESld5WDM4NS1YaWFsQktSbkNXOUNPZHMifQ.iqtn5gfJpnZTG6evVmz1s0oH_Ev3XLhCtgC8tYjP6I0"}
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
{"items":[{"client_id":"demo-exchanger","name":"demo-exchanger","type":"confidential"}],"next":"eyJhZnRlciI6IjAxYTFkM2EyLTg3N2YtNzNlYi05YmU0LTVkNThmNWJmYTgzNyIsInNvcnQiOiJkZW1vLWV4Y2hhbmdlciIsImNvbGxlY3Rpb24iOiJjbGllbnRzIiwidGVuYW50SWQiOiIwMWExZDNhMi04MDlmLTc1NGMtYWQ1NC0xMmJhMTViOWUyNjgiLCJmaWx0ZXJzIjoiT0FkQ2hRTEk0S3lQa1QxSEtzTkRKV3lYMzg1LVhpYWxCS1JuQ1c5Q09kcyJ9.cPIPj7J2-ECNPWiTAaAWePfcA6KKaqmWCub0Ig7Ty7k"}
{"items":[{"client_id":"demo-spa","name":"demo-spa","type":"public"}],"next":null}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"cursor is invalid or expired","errors":[{"path":"cursor","message":"is invalid or expired"}],"instance":"01a1d3a2-8acd-73e6-947b-7656fc897cba"}
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
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/type must be equal to one of the allowed values","errors":[{"path":"type","message":"must be equal to one of the allowed values"}],"instance":"01a1d3a2-8ae6-718d-a3be-103c2ed9a692"}{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: client_id, client_id_exact or name, not more than one","errors":[{"path":"name","message":"search one field at a time: client_id, client_id_exact or name, not more than one"}],"instance":"01a1d3a2-8af0-77de-b196-83db03fcf5f9"}
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
x-request-id: 01a1d3a2-8b1f-759e-9880-bd60f98271d6
cache-control: no-store
etag: "b33bec58d39f2e601979d52bc2160007822d1686bb7a4ca5946afcb479369175"
content-type: application/json; charset=utf-8
content-length: 2477
Date: Fri, 13 Nov 2026 06:40:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a2-811e-7900-84da-991fd6a7538d","client_id":"odudu-admin","name":"Odudu administration","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":true,"registration_origin":"seeded","created_at":"2026-11-13T06:40:04.892Z","redirect_uris":["http://127.0.0.1:8080/callback","http://localhost:3000/console/auth/callback"],"grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"private_key_jwt","audiences":["urn:odudu:params:admin-api"],"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":["http://localhost:3000/console/"],"jwks":{"keys":[{"x":"aGq8ehE1zvB68TgqZayK_lkYRNm0vA6h952baJXQc8U","y":"oQ9TfiTytJOTeGH_4qdFyVQuZmlfg5GW_7ZokhBYvWg","alg":"ES256","crv":"P-256","kid":"ryDJgLR1j3NaIONgY2PD1W3iDMdkhNlsu0lel927CAs","kty":"EC","use":"sig"}]},"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":true,"service_subject_id":null,"scopes":[{"id":"01a1d3a2-80ba-7e35-a5be-856f1e11bf0e","name":"openid","assignment":"default"},{"id":"01a1d3a2-80be-78cd-acb3-b9792599fc1d","name":"profile","assignment":"default"},{"id":"01a1d3a2-80c0-7834-958f-7b1b73f0d468","name":"email","assignment":"default"},{"id":"01a1d3a2-80c2-7240-80ed-e5bb5abf0a6d","name":"address","assignment":"default"},{"id":"01a1d3a2-80c5-7062-bb6e-1d784a891531","name":"phone","assignment":"default"},{"id":"01a1d3a2-80c7-7ae7-92cc-abd79a415191","name":"roles","assignment":"default"},{"id":"01a1d3a2-80c9-73a1-9d27-4ff2d6a7732d","name":"groups","assignment":"default"},{"id":"01a1d3a2-80ca-761a-8419-7769e1291760","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```

This block was run again after the token exchange limits joined the client, so its ids and times are not those of the blocks around it.
