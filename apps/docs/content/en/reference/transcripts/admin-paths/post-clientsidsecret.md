---
title: 'POST /clients/{id}/secret'
description: "Requires manage-clients. Rotates a confidential client's secret: generates a fresh one, stores only its hash, and returns the plaintext exactly…"
---

# `POST /clients/{id}/secret`

Requires `manage-clients`. Rotates a confidential client's secret: generates a fresh one, stores only
its hash, and returns the plaintext **exactly once, in this response** —
the same guarantee `POST /clients` makes for a client's first secret.
Nothing reads it back afterward. By default the previous secret stops
authenticating at `/token`, `/introspect` and `/revoke` immediately, which is
the answer to a leaked one. `?grace_seconds=N`, from `0` to `604800` (a
week), keeps it authenticating beside the new one for `N` seconds instead,
so a client's deployments can move over without an outage; the response's
`previous_secret_expires_at` says when it stops, and every read of the
client says the same until then. A week covers a weekly deployment picking
up the new secret; a longer window would leave a second standing credential
nobody is tracking. Rotating again inside a window keeps only the secret
that rotation replaced, so at most two ever authenticate. Only the old
secret's hash is kept, never shown, and the audit row records
`grace_seconds` and `previous_secret_expires_at`, never a secret or a hash.
`odudu reap` clears the kept hash once the window has passed and audits
each one as `client.secret_expired`; the secret is refused from the instant
the window ends whether or not that pass has run. A public client
(`token_endpoint_auth_method: "none"`) has no secret to rotate, refused with
`409`.

Everything below ran in one session on a freshly built stack with `odudu seed admin
--username ada` run against it and `$ADMIN_TOKEN` got as in [Getting the
token](./getting-the-token.md). The client is `billing`, a confidential
`client_credentials` client in a tenant `client-pages-demo`, made first; `$OLD_SECRET`
is the secret its creation answered, shown once:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"client-pages-demo"}' http://localhost:3000/admin/tenants -o /dev/null
P=http://localhost:3000/admin/tenants/client-pages-demo
OLD_SECRET=$(curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"billing","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}' \
  $P/clients | jq -r .client_secret)
BILL=$(curl -sS -H "$A" "$P/clients?client_id_exact=billing" | jq -r '.items[0].id')
```

On the same client, with an hour's grace: the response, narrowed, then
`client_credentials` at `/token` with the secret the create answered and
with the new one, then a week and a second asked for, then the audit row the
rotation wrote:

```bash
ROTATED=$(curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/$BILL/secret?grace_seconds=3600")
echo "$ROTATED" | jq -c '{client_id, previous_secret_expires_at, client_secret}'
NEW_SECRET=$(echo "$ROTATED" | jq -r .client_secret)
for secret in "$OLD_SECRET" "$NEW_SECRET"; do
  curl -sS -o /dev/null -w '%{http_code}\n' -u "billing:$secret" \
    -d grant_type=client_credentials \
    http://localhost:3000/tenants/client-pages-demo/protocol/openid-connect/token
done
curl -sS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/clients/$BILL/secret?grace_seconds=604801"
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?action=client.rotate_secret" \
  | jq -c '.items[0] | {action, outcome, detail}'
```

```
{"client_id":"billing","previous_secret_expires_at":"2026-10-29T11:31:37.846Z","client_secret":"YpMl2BNNHNU_JqPx1klC6ga9nSG4gTW599eljOSL84c"}
200
200
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/grace_seconds must be <= 604800","errors":[{"path":"grace_seconds","message":"must be <= 604800"}],"instance":"01a18737-1b0c-7c04-9727-a11219b35191"}
{"action":"client.rotate_secret","outcome":"allowed","detail":{"secret_hash":{"changed":true},"grace_seconds":3600,"previous_secret_expires_at":"2026-10-29T11:31:37.846Z"}}
```

A rotation without grace, on `demo-backend` in a tenant `client-facts-demo`, a client
that was disabled first, which is why `enabled` reads `false` here: rotating a
disabled client's secret is allowed, the guard being on the built-in client
rather than on a disabled one.

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"client-facts-demo"}' http://localhost:3000/admin/tenants -o /dev/null
F=http://localhost:3000/admin/tenants/client-facts-demo
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id": "demo-backend", "grant_types": ["client_credentials"], "token_endpoint_auth_method": "client_secret_basic"}' \
  $F/clients -o /dev/null
BACKEND=$(curl -sS -H "$A" "$F/clients?client_id_exact=demo-backend" | jq -r '.items[0].id')
curl -sS -X PATCH -H "$A" -H "$J" -d '{"enabled": false}' $F/clients/$BACKEND -o /dev/null
```

```bash
curl -sS -X POST \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/client-facts-demo/clients/$BACKEND/secret
```

```
{"id":"01a18737-1b99-7f1b-a1ac-e360ca04b8f8","client_id":"demo-backend","name":"demo-backend","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":false,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:31:38.113Z","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":"01a18737-1b82-7f64-b6ae-bcd4f02919ee","scopes":[{"id":"01a18737-1b38-7b35-96de-4772ba8bd45d","name":"openid","assignment":"default"},{"id":"01a18737-1b39-7de1-af70-c13c2fd3d118","name":"profile","assignment":"default"},{"id":"01a18737-1b3b-7531-9318-6e2ce9ccad74","name":"email","assignment":"default"},{"id":"01a18737-1b3c-7af5-8beb-9119f0ae6d11","name":"address","assignment":"default"},{"id":"01a18737-1b3d-7142-8086-819ed51dec1a","name":"phone","assignment":"default"},{"id":"01a18737-1b3f-7cf0-b18f-f207d517ce16","name":"roles","assignment":"default"},{"id":"01a18737-1b40-74a2-b868-1dbb7ce8ed7a","name":"groups","assignment":"default"},{"id":"01a18737-1b41-76de-a73f-743186bf4521","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"client_secret":"yXbU7k6lxSF_Mz1Jfl5ulv1xr3SxDCs6pJbfRRXLtQg"}
```

## The service account's ceiling

**A confidential client authenticates as its service account, so every route
that mutates one client is held to the target ceiling on that subject** — the
one the [subjects' target
ceiling](./post-subjectsidpassword.md#the-target-ceiling) applies to
`/subjects/{id}`. That is `PATCH`, `DELETE` and `POST …/secret` on
`/clients/{id}`, and `PUT` and `DELETE` on `/scopes/{id}/clients/{clientId}`.
Without it, a caller holding only `manage-clients` could rotate the secret of a
client whose service account holds `tenant-admin`, or swap its `jwks`, and then
act as `tenant-admin` through `client_credentials`. A caller missing any admin
capability the service account holds is refused with `403` naming what it lacks,
before anything else about the request is looked at, and the attempt writes a
`refused` row on the client (on the scope, for the two scope routes) with
`detail.denied`. A client with no service account, or one whose service account
holds no capability, is unaffected. An integration test reads these routes from
the route table too.

In a tenant `ceiling-clients` created for it, holding the `client_credentials`
clients below with the admin audience, each created through `POST /clients`:
`ops-robot`, whose service account was given `manage-clients` through `PUT
/subjects/:id/roles`, so `$OPS_TOKEN` is its `client_credentials` token and
carries that capability alone; `root-robot`, whose service account was given
`tenant-admin` the same way; `plain-robot`, whose service account holds
nothing; and `scopes-robot`, given `manage-tenant` alone, so `$SCOPES_TOKEN`
carries the capability the scope routes require and nothing else. The function
`robot NAME ROLE` makes one, and `ROLE` may be `-` for none:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"ceiling-clients"}' http://localhost:3000/admin/tenants -o /dev/null
C=http://localhost:3000/admin/tenants/ceiling-clients
robot() {
  local created secret svc role etag
  created=$(curl -sS -X POST -H "$A" -H "$J" \
    -d "{\"client_id\":\"$1\",\"grant_types\":[\"client_credentials\"],\"token_endpoint_auth_method\":\"client_secret_basic\",\"audiences\":[\"urn:odudu:params:admin-api\"]}" $C/clients)
  secret=$(echo "$created" | jq -r .client_secret)
  svc=$(echo "$created" | jq -r .service_subject_id)
  if [ "$2" != "-" ]; then
    role=$(curl -sS -H "$A" "$C/roles?name=$2" | jq -r --arg n "$2" '.items[] | select(.name == $n) | .id')
    etag=$(curl -sS -D - -o /dev/null -H "$A" $C/subjects/$svc/roles | tr -d '\r' | sed -n 's/^etag: //p')
    curl -sS -X PUT -H "$A" -H "$J" -H "If-Match: $etag" -d "{\"role_ids\":[\"$role\"]}" $C/subjects/$svc/roles -o /dev/null
  fi
  curl -sS -u "$1:$secret" -d grant_type=client_credentials \
    http://localhost:3000/tenants/ceiling-clients/protocol/openid-connect/token | jq -r .access_token
}
OPS_TOKEN=$(robot ops-robot manage-clients)
robot root-robot tenant-admin > /dev/null
robot plain-robot - > /dev/null
SCOPES_TOKEN=$(robot scopes-robot manage-tenant)
ROOT_ID=$(curl -sS -H "$A" "$C/clients?client_id_exact=root-robot" | jq -r '.items[0].id')
PLAIN_ID=$(curl -sS -H "$A" "$C/clients?client_id_exact=plain-robot" | jq -r '.items[0].id')
```

The rotation, a `jwks` swap and the delete on `root-robot` are refused, a
rotation on `plain-robot` is not, and the refused rows are the three on
`root-robot`:

```bash
ROOT=$C/clients/$ROOT_ID
curl -sS -X POST -H "Authorization: Bearer $OPS_TOKEN" "$ROOT/secret"
echo
curl -sS -X PATCH -H "Authorization: Bearer $OPS_TOKEN" -H 'content-type: application/json' \
  -d '{"jwks":{"keys":[]}}' "$ROOT"
echo
curl -sS -X DELETE -H "Authorization: Bearer $OPS_TOKEN" "$ROOT"
echo
curl -sS -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $OPS_TOKEN" \
  $C/clients/$PLAIN_ID/secret
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$C/audit?resource_type=client&resource_id=$ROOT_ID&outcome=refused"
echo
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a18737-20ba-708d-b446-2990612ecf70"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a18737-20d5-7e94-8acd-c212f90c9698"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-tenant, manage-keys, manage-sessions, view-audit","instance":"01a18737-20f3-79df-887f-0ab097233226"}
200
{"items":[{"id":"01a18737-2103-79bd-af5e-5627b9c72735","occurred_at":"2026-10-29T10:31:39.518Z","event_type":"admin_mutation","action":"client.delete","outcome":"refused","actor_tenant_id":"01a18737-1c63-79f7-89d0-3d37b3141d46","actor_subject_id":"01a18737-1d51-749a-aaad-4e89d4986a91","actor_client_id":"01a18737-1d6c-7dec-95b3-00aeccd90717","actor_name":"ops-robot","actor_origin":"tenant","resource_type":"client","resource_id":"01a18737-1e75-717a-a2f4-a1f4324eeac5","request_id":"01a18737-20f3-79df-887f-0ab097233226","ip":"172.20.0.1","detail":{"denied":["view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a18737-20e3-79fe-8a21-556f4c0e7d3c","occurred_at":"2026-10-29T10:31:39.488Z","event_type":"admin_mutation","action":"client.amend","outcome":"refused","actor_tenant_id":"01a18737-1c63-79f7-89d0-3d37b3141d46","actor_subject_id":"01a18737-1d51-749a-aaad-4e89d4986a91","actor_client_id":"01a18737-1d6c-7dec-95b3-00aeccd90717","actor_name":"ops-robot","actor_origin":"tenant","resource_type":"client","resource_id":"01a18737-1e75-717a-a2f4-a1f4324eeac5","request_id":"01a18737-20d5-7e94-8acd-c212f90c9698","ip":"172.20.0.1","detail":{"denied":["view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}},{"id":"01a18737-20c9-7bb7-a21a-f92376cae22a","occurred_at":"2026-10-29T10:31:39.460Z","event_type":"admin_mutation","action":"client.rotate_secret","outcome":"refused","actor_tenant_id":"01a18737-1c63-79f7-89d0-3d37b3141d46","actor_subject_id":"01a18737-1d51-749a-aaad-4e89d4986a91","actor_client_id":"01a18737-1d6c-7dec-95b3-00aeccd90717","actor_name":"ops-robot","actor_origin":"tenant","resource_type":"client","resource_id":"01a18737-1e75-717a-a2f4-a1f4324eeac5","request_id":"01a18737-20ba-708d-b446-2990612ecf70","ip":"172.20.0.1","detail":{"denied":["view-users","manage-users","manage-tenant","manage-keys","manage-sessions","view-audit"]}}]}
```

The two scope routes, from `scopes-robot`, with `$SCOPES_TOKEN`. Assigning `profile` to
`root-robot` and unassigning it are refused, assigning it to `plain-robot`
is not, and the rows on `profile` since `RUN_START` are the two refusals
and that assignment:

```bash
RUN_START=$(date -u +%FT%T.000Z)
PROFILE_ID=$(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$C/scopes?name=profile" | jq -r '.items[0].id')
PROFILE=$C/scopes/$PROFILE_ID
curl -sS -X PUT -H "Authorization: Bearer $SCOPES_TOKEN" -H 'content-type: application/json' \
  -d '{"assignment":"optional"}' "$PROFILE/clients/$ROOT_ID"
echo
curl -sS -X DELETE -H "Authorization: Bearer $SCOPES_TOKEN" \
  "$PROFILE/clients/$ROOT_ID"
echo
curl -sS -o /dev/null -w '%{http_code}\n' -X PUT -H "Authorization: Bearer $SCOPES_TOKEN" \
  -H 'content-type: application/json' -d '{"assignment":"default"}' \
  "$PROFILE/clients/$PLAIN_ID"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$C/audit?resource_type=scope&resource_id=$PROFILE_ID&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, detail}'
```

```
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a18737-2185-73c7-ba26-9a2ae98c5a62"}
{"type":"about:blank","title":"Forbidden","status":403,"detail":"the client's service account holds what the caller does not: view-users, manage-users, manage-clients, manage-keys, manage-sessions, view-audit","instance":"01a18737-21a5-7761-8cbb-84f5c1af8897"}
200
{"action":"scope.assign_to_client","outcome":"allowed","detail":{}}
{"action":"scope.unassign_from_client","outcome":"refused","detail":{"denied":["view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
{"action":"scope.assign_to_client","outcome":"refused","detail":{"denied":["view-users","manage-users","manage-clients","manage-keys","manage-sessions","view-audit"]}}
```
