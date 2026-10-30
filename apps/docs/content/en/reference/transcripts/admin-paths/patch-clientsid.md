---
title: 'PATCH /clients/{id}'
description: 'Requires manage-clients, as every client route does.'
---

# `PATCH /clients/{id}`

Requires `manage-clients`, as every client route does. Amends the fields a
general-purpose amendment can safely touch — every column of `clients` and
`client_oidc_config` except identity (`id`, `client_id`, `tenant_id`), history
(`created_at`), provenance (`registration_origin`), the security-model switch
(`type`), the secret (rotated only through `POST /secret` below) and
`builtin_admin` itself. A field this excludes is refused with `400`, naming the
field and the reason (`refusalFor`) — `client_id` answers "identity: changing it
breaks every relying party and orphans the azp of every issued token", for
instance, not merely "refused".

A list field — `redirect_uris`, `post_logout_redirect_uris`, `web_origins`,
`audiences`, `grant_types`, `client_credentials_scopes` — is replaced
**wholesale**, never appended to: the body names the complete list the
field should hold afterward. Because last-write-wins on one of these
silently reinstates exactly what another admin just removed, `If-Match` is
**required** when a request touches any of the six, answered with
`428 Precondition Required` when it is missing or is `*`, which names no
version;
every other field amends with `If-Match` optional, the same concurrency
control `PATCH /settings` uses, row lock included. A stale `If-Match` is
`412` either way, and nothing is changed.

A list field holds at most 200 entries (`CLIENT_LIST_LIMIT`,
`@odudu/contracts`), for `redirect_uris`, `web_origins`,
`post_logout_redirect_uris`, `audiences` and `client_credentials_scopes`
alike, on a create, a `PATCH`, dynamic registration, an import and `odudu seed
client`. A client is read and listed whole, and each redirect URI and web
origin is expanded into `client_origins` rows when it is written, so this is
what keeps both small. A longer list is refused with `400` naming the field,
how many entries it held and how many it may, and nothing is changed; a list
of exactly 200 is accepted. A web origin that is not a bare origin, and a
redirect URI the registration validator refuses, are refused with the entry
named, in the same `errors` shape. Everything on this page ran in one session on a
freshly built stack with `odudu seed admin --username ada` run against it and
`$ADMIN_TOKEN` got as in [Getting the token](./getting-the-token.md). In the tenant
`client-limits-demo`, `$P` is its admin path, `$ID` the client `billing` and `$LID`
the client `legacy`; both clients were made first. Each call sent the `ETag`
the `GET` before it answered. `over-origins.json` held 201 origins `https://o0.example` to
`https://o200.example`, and `over-uris.json` 201 redirect URIs
`https://billing.example/cb/0` to `…/cb/200`:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"client-limits-demo"}' http://localhost:3000/admin/tenants -o /dev/null
P=http://localhost:3000/admin/tenants/client-limits-demo
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"billing","redirect_uris":["https://billing.example/callback"],"grant_types":["authorization_code"]}' $P/clients -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"legacy","redirect_uris":["https://legacy.example/callback"],"grant_types":["authorization_code"]}' $P/clients -o /dev/null
ID=$(curl -sS -H "$A" "$P/clients?client_id_exact=billing" | jq -r '.items[0].id')
LID=$(curl -sS -H "$A" "$P/clients?client_id_exact=legacy" | jq -r '.items[0].id')
jq -n '{web_origins: [range(0;201) | "https://o\(.).example"]}' > over-origins.json
jq -n '{web_origins: [range(0;200) | "https://o\(.).example"]}' > at-origins.json
jq -n '{redirect_uris: [range(0;201) | "https://billing.example/cb/\(.)"]}' > over-uris.json
jq -n '{redirect_uris: [range(0;201) | "https://legacy.example/cb/\(.)"]}' > patch-over.json
jq -n '{client_id: "too-many", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], redirect_uris: [range(0;201) | "https://billing.example/cb/\(.)"]}' > create-over-uris.json
jq -n '{client_id: "too-many", token_endpoint_auth_method: "none", grant_types: ["authorization_code"], redirect_uris: ["https://billing.example/callback"], web_origins: [range(0;201) | "https://o\(.).example"]}' > create-over-origins.json
ETAG=$(curl -sS -D - -o /dev/null -H "$A" $P/clients/$ID | tr -d '\r' | sed -n 's/^etag: //p')
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d @over-origins.json $P/clients/$ID; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d @over-uris.json $P/clients/$ID; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"web_origins":["https://app.example/"]}' $P/clients/$ID; echo
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"redirect_uris":["http://billing.example/cb"]}' $P/clients/$ID; echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"web_origins: holds 201 entries, at most 200","errors":[{"path":"web_origins","message":"holds 201 entries, at most 200"}],"instance":"01a18730-497d-7355-b3b9-ee98798cd76c"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris holds 201 entries, at most 200","errors":[{"path":"redirect_uris","message":"redirect_uris holds 201 entries, at most 200"}],"instance":"01a18730-4999-796e-9d7f-272a9df6ea2d"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"web_origins: web_origins entry \"https://app.example/\" is not an origin: expected a scheme and host with no path, or \"+\" for every registered redirect URI's origin","errors":[{"path":"web_origins","message":"web_origins entry \"https://app.example/\" is not an origin: expected a scheme and host with no path, or \"+\" for every registered redirect URI's origin"}],"instance":"01a18730-49b4-7c1a-b41b-d806e398464f"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris entry http://billing.example/cb is not valid","errors":[{"path":"redirect_uris","message":"redirect_uris entry http://billing.example/cb is not valid"}],"instance":"01a18730-49cf-7d3b-b3fb-c5f08b1cccf2"}
```

The same call with 200 origins, `at-origins.json`, answered `200`, and
`.web_origins | length` of the client it returned was `200`:

```bash
curl -sS -o body.json -w '%{http_code}\n' -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d @at-origins.json $P/clients/$ID
jq '.web_origins | length' body.json
```

```
200
200
```

A create is refused the same way. `create-over-uris.json` named a public client
`too-many` with 201 redirect URIs, and `create-over-origins.json` one redirect
URI and 201 web origins; no client was made by either:

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d @create-over-uris.json $P/clients; echo
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d @create-over-origins.json $P/clients; echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris holds 201 entries, at most 200","errors":[{"path":"redirect_uris","message":"redirect_uris holds 201 entries, at most 200"}],"instance":"01a18730-4a3b-7d97-9a8e-a384d677c020"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"web_origins: holds 201 entries, at most 200","errors":[{"path":"web_origins","message":"holds 201 entries, at most 200"}],"instance":"01a18730-4a56-7d07-a67e-8980df11efd6"}
```

**A client stored over the limit** — registered before it existed — is not
refused for what a write does not change. `legacy` was made through `POST
/clients`, and its `redirect_uris` then set to 201 entries with `psql`, which no
route does:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -tA -c \
  "update client_oidc_config set redirect_uris = (select array_agg('https://legacy.example/cb/' || g) from generate_series(0, 200) g) where client_id = '$LID'"
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$LID | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d '{"client_uri":"https://legacy.example/about"}' $P/clients/$LID
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -H "If-Match: $ETAG" \
  -d @patch-over.json $P/clients/$LID
```

```
UPDATE 1
200
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris holds 201 entries, at most 200","errors":[{"path":"redirect_uris","message":"redirect_uris holds 201 entries, at most 200"}],"instance":"01a18730-4b3a-74ef-9172-cfa1fea0a2d8"}
```

The `PATCH` that left `redirect_uris` alone was `200`; one that sends a list
sends one under the limit or is refused (`patch-over.json` held 201 URIs). The
export carries the stored list as it is, and importing that document is
refused at the field, with its count and the limit, until it is trimmed:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/export > export.json
jq -c '[.clients[] | {client_id, redirect_uris: (.redirect_uris | length)}]' export.json
jq '{name: "client-reimport-demo", document: .}' export.json > import.json
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d @import.json \
  http://localhost:3000/admin/tenant-imports
```

```
[{"client_id":"billing","redirect_uris":1},{"client_id":"legacy","redirect_uris":201}]
{"type":"about:blank","title":"Bad Request","status":400,"detail":"the import was refused for 1 problem(s), listed under errors","errors":[{"path":"document.clients[1].redirect_uris","message":"holds 201 entries, at most 200"}],"instance":"01a18730-4b87-71a8-82df-8a0ee75c6692"}
```

`odudu seed client` refuses a list over the limit in the same words, before it
writes anything; given 201 `--redirect-uri` flags it ends with:

```bash
docker compose exec -T odudu node dist/main.js seed client --tenant client-limits-demo \
  --client-id too-many --public \
  $(for i in $(seq 0 200); do printf -- '--redirect-uri https://billing.example/cb/%s ' $i; done) 2>&1 \
  | grep '^OduduError'
```

```
OduduError: redirect_uris holds 201 entries, at most 200
```

**A client answers what its service account holds.** `service_account_admin_reach`
is the admin capabilities the client's service account holds, in the
vocabulary's order, which every write on the client is judged against (the
target ceiling): derived on every read, one query for a whole page, and outside
the `ETag`, which is taken over the stored fields alone, as a group's
`admin_reach` is outside its own. It is empty for a client with no service
account. A caller needs no `view-users` to read it, so a console can judge the
ceiling from the record. `billing`'s service account was then given
`manage-users`, which nests `view-users`, with `psql` (no route assigns a role
to a service account):

```bash
curl -sS -D - -o body.json -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$ID | grep -i '^etag'
jq -c '{client_id, service_account_admin_reach}' body.json
docker compose exec -T postgres psql -U odudu -d odudu -tA -c \
  "insert into subject_roles (tenant_id, subject_id, role_id) select c.tenant_id, c.service_subject_id, r.id from clients c join clients a on a.tenant_id = c.tenant_id and a.client_id = 'odudu-admin' join roles r on r.client_id = a.id and r.name = 'manage-users' where c.id = '$ID'"
curl -sS -D - -o body.json -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$ID | grep -i '^etag'
jq -c '{client_id, service_account_admin_reach}' body.json
```

```
etag: "ccb1d256a6bee75fef0c52ec2c7800c58b18cd4767b5788fb8b41adff4ecadfe"
{"client_id":"billing","service_account_admin_reach":[]}
INSERT 0 1
etag: "ccb1d256a6bee75fef0c52ec2c7800c58b18cd4767b5788fb8b41adff4ecadfe"
{"client_id":"billing","service_account_admin_reach":["view-users","manage-users"]}
```

The `ETag` did not move. `GET /clients?client_id_exact=` finds the one client
whose `client_id` is exactly the value, case kept, through the unique index; a
prefix finds none, and it is one of the three searches that may not be
combined:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients?client_id_exact=billing" | jq -c '[.items[] | {client_id, service_account_admin_reach}]'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients?client_id_exact=bill"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/clients?client_id_exact=billing&name=b"
```

```
[{"client_id":"billing","service_account_admin_reach":["view-users","manage-users"]}]
{"items":[]}{"type":"about:blank","title":"Bad Request","status":400,"detail":"search one field at a time: client_id, client_id_exact or name, not more than one","errors":[{"path":"name","message":"search one field at a time: client_id, client_id_exact or name, not more than one"}],"instance":"01a18730-4ed1-7ba3-80e7-0adacdd38e59"}
```

The RFC 7591 metadata fields among them — `redirect_uris`, `grant_types`,
`token_endpoint_auth_method`, `jwks`, `jwks_uri`, the two logout URIs and
their `_session_required` flags, the three `userinfo_*` response fields,
`tls_client_auth_subject_dn`, `client_uri`, `policy_uri` and `tos_uri`
— each of those three an absolute https URI, or http on a loopback
host, with no fragment, and linked from the consent screen — and
`id_token_signed_response_alg`, `default_max_age` and `require_auth_time`
are revalidated through the same
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

The built-in admin client (`builtin_admin`) is amended through an
allowlist, not an exclusion list: `name`, `description`, `client_uri`,
`policy_uri`, `tos_uri`, `consent_required`, the two logout URIs and their
`_session_required` flags, and the three `userinfo_*` algorithms. Every other field is refused with `409` naming
the field and the client, because each could leave every administrator of
the tenant locked out while the client stays enabled — `audiences` carries
the admin API's own resource identifier, `grant_types`,
`token_endpoint_auth_method` and `redirect_uris` decide how a token is
obtained at all, and recovery from any of them is through `psql`.
Disabling it (`enabled: false`) carries its own reason. Stated this way
round, a column added to `clients` or `client_oidc_config` later is
refused on this one client until somebody judges it safe, rather than
opening a fresh door by default. The guard reads the `builtin_admin`
column, not `client_id`, so renaming the client does not evade it. An
**ordinary** admin-capable client carries no such guard and may be
disabled even by the caller whose own token runs through it — the built-in
client is the recovery path that makes that permissible.

On `demo`'s `demo-operator`, created with `grant_types: ["client_credentials"]` and no
`redirect_uris`. `$OP` is its id and `$OPTAG` the `ETag` its `GET` answered.
Amending a list field without `If-Match`, and amending a field the exclusion
list names — the refusal carries the reason, not just the refusal:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"demo"}' http://localhost:3000/admin/tenants -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"demo-operator","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}' \
  http://localhost:3000/admin/tenants/demo/clients -o /dev/null
OP=$(curl -sS -H "$A" "http://localhost:3000/admin/tenants/demo/clients?client_id_exact=demo-operator" | jq -r '.items[0].id')
OPTAG=$(curl -sS -D - -o /dev/null -H "$A" http://localhost:3000/admin/tenants/demo/clients/$OP | tr -d '\r' | sed -n 's/^etag: //p')
```

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"redirect_uris": ["https://demo-operator.example/callback"]}' \
  http://localhost:3000/admin/tenants/demo/clients/$OP; echo
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "renamed"}' \
  http://localhost:3000/admin/tenants/demo/clients/$OP; echo
```

```
{"type":"about:blank","title":"Precondition Required","status":428,"detail":"If-Match is required to amend redirect_uris","instance":"01a18730-4fd6-775e-87ae-ce92645b6c8b"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"client_id: identity: changing it breaks every relying party and orphans the azp of every issued token","errors":[{"path":"client_id","message":"identity: changing it breaks every relying party and orphans the azp of every issued token"}],"instance":"01a18730-4ff6-7e25-ba6d-6bf2210836b9"}
```

The revalidation is not a formality. Widening `demo-operator`'s grants
alone, with the `ETag` its `GET` answered, is refused, because the merged
metadata no longer satisfies the rule that excused the empty list:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $OPTAG" \
  -d '{"grant_types": ["client_credentials","refresh_token"]}' \
  http://localhost:3000/admin/tenants/demo/clients/$OP; echo
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"redirect_uris is required unless grant_types is exactly [\"client_credentials\"]","errors":[{"path":"redirect_uris","message":"redirect_uris is required unless grant_types is exactly [\"client_credentials\"]"}],"instance":"01a18730-5012-78a7-92d7-67905b94297e"}
```

An amendment that does pass, with that same `ETag`, and the fresh one it
returns — its headers only:

```bash
curl -sS -D - -o /dev/null -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $OPTAG" \
  -d '{"audiences": ["https://api.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients/$OP; echo
```

```
HTTP/1.1 200 OK
x-request-id: 01a18730-5031-7fb7-a65c-c648f3eb32cf
cache-control: no-store
etag: "40aa3934f58d718a93d07e7fb858d976120f99cf211da7fd008493f7b0b3b19d"
content-type: application/json; charset=utf-8
content-length: 2049
Date: Thu, 29 Oct 2026 10:24:12 GMT
Connection: keep-alive
Keep-Alive: timeout=72


```

Replaying the identical request — same `If-Match`, now one generation
stale — is refused and changes nothing:

```bash
curl -sS -X PATCH \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -H "If-Match: $OPTAG" \
  -d '{"audiences": ["https://api.demo.example"]}' \
  http://localhost:3000/admin/tenants/demo/clients/$OP; echo
```

```
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a18730-506e-79b1-ad40-f6506fba7695"}
```

**The two `409`s that disabling produces are told apart by one column, and
the admin API does not expose it**, so it is read from the database beside
them rather than asserted. `client-facts-demo` holds the two clients this
guard needs: its own built-in one, and `demo-backend`, made first:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"client-facts-demo"}' http://localhost:3000/admin/tenants -o /dev/null
F=http://localhost:3000/admin/tenants/client-facts-demo
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  $F/clients -o /dev/null
BACKEND=$(curl -sS -H "$A" "$F/clients?client_id_exact=demo-backend" | jq -r '.items[0].id')
FADMIN=$(curl -sS -H "$A" "$F/clients?client_id_exact=odudu-admin" | jq -r '.items[0].id')
```

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c \
  "select client_id, builtin_admin, enabled from clients
     where tenant_id = (select id from tenants where name = 'client-facts-demo') order by client_id;"
```

```
  client_id   | builtin_admin | enabled
--------------+---------------+---------
 demo-backend | f             | t
 odudu-admin  | t             | t
(2 rows)

```

`demo-backend`, `builtin_admin` false, disables — and the response is the
whole client, so `enabled` can be read back from it, alongside
`builtin_admin` itself:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/client-facts-demo/clients/$BACKEND
```

```
{"id":"01a18730-5106-7312-9a0c-cf3f17eb0159","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":false,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:24:13.030Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a18730-50e8-7a77-b66d-ce29310c719d","scopes":[{"id":"01a18730-50a6-741e-a584-a18e0f78dcff","name":"address","assignment":"default"},{"id":"01a18730-50a5-738e-8d35-dc4011adccc8","name":"email","assignment":"default"},{"id":"01a18730-50ab-712d-8dac-a92c7f162005","name":"groups","assignment":"default"},{"id":"01a18730-50ae-7733-814b-7bbe2e121312","name":"offline_access","assignment":"optional"},{"id":"01a18730-50a1-7db4-b07c-8e5a4c7a867f","name":"openid","assignment":"default"},{"id":"01a18730-50a8-7b8c-a892-f75294f4e111","name":"phone","assignment":"default"},{"id":"01a18730-50a2-745f-b600-59c8f0b533bf","name":"profile","assignment":"default"},{"id":"01a18730-50aa-7463-a120-d041f14d0268","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
```

`odudu-admin`, `builtin_admin` true, the same request against the other id
in that listing, does not:

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled": false}' \
  http://localhost:3000/admin/tenants/client-facts-demo/clients/$FADMIN
```

```
{"type":"about:blank","title":"Conflict","status":409,"detail":"odudu-admin is this tenant's built-in admin client and cannot be disabled","instance":"01a18730-5203-7ffe-befc-1719eb23f099"}
```

## A client's pages and its ID token settings

`description` is the administrators' own note on the client, at most 1000
characters and shown nowhere else. `client_uri`, `policy_uri` and `tos_uri` are
RFC 7591 §2's pages about the client, which the consent screen links under the
client's name ([The consent
screen](../request-paths/rp-initiated-logout.md#the-consent-screen)).
`id_token_signed_response_alg`, `default_max_age` and `require_auth_time` are
OpenID Connect Dynamic Client Registration §2's: the algorithm the client's ID
tokens are signed with (`RS256` or `ES256`, and only one a non-retired key of
the tenant produces; `null` signs with the active key), the age past which a
session is re-authenticated when a request carries no `max_age` of its own, and
whether every ID token carries `auth_time`. Dynamic registration accepts the
same six and echoes them. In a tenant `client-pages-demo` created for it:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"client-pages-demo"}' http://localhost:3000/admin/tenants -o /dev/null
```

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"client_id": "billing", "redirect_uris": ["https://billing.example/callback"], "grant_types": ["authorization_code", "client_credentials"], "description": "Invoices and payment runs", "client_uri": "https://billing.example/about", "policy_uri": "https://billing.example/privacy", "tos_uri": "https://billing.example/terms", "id_token_signed_response_alg": "ES256", "default_max_age": 3600, "require_auth_time": true}' \
  http://localhost:3000/admin/tenants/client-pages-demo/clients
```

```
{"id":"01a18730-5291-7dd2-8854-48d5e5da472a","client_id":"billing","name":"billing","description":"Invoices and payment runs","name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:24:13.425Z","redirect_uris":["https://billing.example/callback"],"grant_types":["authorization_code","client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":"https://billing.example/about","policy_uri":"https://billing.example/privacy","tos_uri":"https://billing.example/terms","id_token_signed_response_alg":"ES256","default_max_age":3600,"require_auth_time":true,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a18730-5273-7b58-b0e4-e5ebf23ba25a","scopes":[{"id":"01a18730-522f-7532-a4de-7edd21d8b2e7","name":"address","assignment":"default"},{"id":"01a18730-522e-790a-8322-1ba91c502e22","name":"email","assignment":"default"},{"id":"01a18730-5235-7a37-8572-f96591a5e361","name":"groups","assignment":"default"},{"id":"01a18730-5236-7d63-aade-cb883d063dc3","name":"offline_access","assignment":"optional"},{"id":"01a18730-522a-78e8-870c-b1497e268f59","name":"openid","assignment":"default"},{"id":"01a18730-5231-7e26-aea4-4ea0128437e1","name":"phone","assignment":"default"},{"id":"01a18730-522c-7a67-9099-3444abcaa2c3","name":"profile","assignment":"default"},{"id":"01a18730-5233-7ac0-a0bc-0dcf9f53e575","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"client_secret":"5XCYri62iVFzAxYrA2Y7ay4BF4zTj9o-AjDVC1gT41o"}
```

A page that is not https, or an algorithm no key of the tenant produces,
is refused by name — the tenant holds only the `ES256` key it was created
with:

```bash
BILL=$(curl -sS -H "$A" "http://localhost:3000/admin/tenants/client-pages-demo/clients?client_id_exact=billing" | jq -r '.items[0].id')
```

```bash
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"policy_uri": "http://billing.example/privacy"}' \
  http://localhost:3000/admin/tenants/client-pages-demo/clients/$BILL
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" -d '{"id_token_signed_response_alg": "RS256"}' \
  http://localhost:3000/admin/tenants/client-pages-demo/clients/$BILL
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"policy_uri must be an absolute https URI, or http on a loopback host, with no fragment","errors":[{"path":"policy_uri","message":"policy_uri must be an absolute https URI, or http on a loopback host, with no fragment"}],"instance":"01a18730-52de-7a9b-837a-6c569862f2b5"}{"type":"about:blank","title":"Bad Request","status":400,"detail":"id_token_signed_response_alg: id_token_signed_response_alg RS256 is not produced by any of this tenant's signing keys (ES256)","errors":[{"path":"id_token_signed_response_alg","message":"id_token_signed_response_alg RS256 is not produced by any of this tenant's signing keys (ES256)"}],"instance":"01a18730-52f9-7b84-b6d1-bf258a776219"}
```

## Turning the logout confirmation off for one client

`skip_logout_confirmation` is a boolean on the client, `false` for every client
but the console's own, and amended here like any other field. `/logout` asks
the End-User before it signs anyone out; a client with this on is signed out
without the page, but only for an ID token it was issued that names the live
session ([RP-initiated logout](../request-paths/rp-initiated-logout.md#a-client-may-skip-the-page)
shows both answers). Anyone holding such a token can then sign that user out by
opening a link, which is why only `manage-clients` may change it, why it is
audited as every amendment is, and why Dynamic Client Registration refuses it.
The field is not a list, so `If-Match` is optional, and a stale one is `412`.
It is guarded on the built-in `odudu-admin` client like every field outside the
short list that client may be amended through.

In the tenant `demo`, `$P` is its admin path and `$ID` the client `reports`,
seeded public a moment before with `odudu seed client` and not touched since, so
it holds the default. The first request is the read, the second a stale `If-Match`, the third a value
that is not a boolean, and the last sends the `ETag` the read before it answered:

```bash
P=http://localhost:3000/admin/tenants/demo
docker compose exec -T odudu node dist/main.js seed client --tenant demo --client-id reports --public \
  --redirect-uri https://reports.example/callback | jq -c '{command, clientId}'
ID=$(curl -sS -H "$A" "$P/clients?client_id_exact=reports" | jq -r '.items[0].id')
```

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$ID | grep -iE '^HTTP|^etag|^content-length'
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$ID | grep -o '"skip_logout_confirmation":[a-z]*'
echo '# a stale If-Match'
curl -sS -D - -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -H 'If-Match: "stale"' -d '{"skip_logout_confirmation":true}' $P/clients/$ID | grep -iE '^HTTP|^\{'
echo '# not a boolean'
curl -sS -D - -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"skip_logout_confirmation":"yes"}' $P/clients/$ID | grep -iE '^HTTP|^\{'
echo '# the current If-Match'
ETAG=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $ADMIN_TOKEN" $P/clients/$ID | sed -n 's/^etag: //p' | tr -d '\r')
echo "$ETAG"
curl -sS -D - -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -H "If-Match: $ETAG" -d '{"skip_logout_confirmation":true}' $P/clients/$ID > patch.txt
grep -iE '^HTTP|^etag' patch.txt; grep -o '"skip_logout_confirmation":[a-z]*' patch.txt
```

```
HTTP/1.1 200 OK
etag: "dbd33d17d9ab2627be265dc5d5617e82d8f63a3e9c6000da6394d6f268a39b4d"
content-length: 2004
"skip_logout_confirmation":false
# a stale If-Match
HTTP/1.1 412 Precondition Failed
{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a18730-5592-79cd-b4ca-189cc51c0668"}
# not a boolean
HTTP/1.1 400 Bad Request
{"type":"about:blank","title":"Bad Request","status":400,"detail":"skip_logout_confirmation: skip_logout_confirmation must be a boolean","errors":[{"path":"skip_logout_confirmation","message":"skip_logout_confirmation must be a boolean"}],"instance":"01a18730-55ae-7d37-bccc-60185aef3d2e"}
# the current If-Match
"dbd33d17d9ab2627be265dc5d5617e82d8f63a3e9c6000da6394d6f268a39b4d"
HTTP/1.1 200 OK
etag: "f0ac6f41176584609d0ad642e9c2b53b8fc3a93a69465f180133ea9fdb265eb9"
"skip_logout_confirmation":true
```

The amendment is one audit row, `client.amend`, whose detail names only the
field that changed. The query ran as the database owner, with `psql` a function that opens the
stack's Postgres, scoped to this
client:

```bash
psql() { docker compose exec -T postgres psql -U odudu -d odudu "$@"; }
psql -c "select a.action, a.outcome, a.detail from audit_events a join tenants t on t.id = a.tenant_id where t.name = 'demo' and a.resource_id = '$ID' and a.action = 'client.amend' order by a.occurred_at;"
```

```
    action    | outcome |                             detail
--------------+---------+----------------------------------------------------------------
 client.amend | allowed | {"skip_logout_confirmation": {"after": true, "before": false}}
(1 row)

```
