---
title: 'DELETE /scopes/:id/clients/:clientId'
description: "Requires manage-tenant. Removes the client's assignment of the scope, whether it was default or optional — the inverse of PUT…"
---

# `DELETE /scopes/:id/clients/:clientId`

Requires `manage-tenant`. Removes the client's assignment of the scope, whether
it was `default` or `optional` — the inverse of `PUT
/scopes/:id/clients/:clientId` above, and the only way to take a scope back off
a client once assigned; `clientScopeRepository.unassign` deletes the row
outright rather than narrowing it. Answers `204`; a scope not currently assigned
to the client, an unknown scope id or an unknown client id all answer `404`; and
the same `403` as `PUT` above refuses a client whose service account holds what
the caller does not.

**The tenant's built-in admin client keeps every scope assignment**: unassigning
one answers `409`, naming the scope and the client. That client is public, with
no secret, and supports no grant but `authorization_code`/`refresh_token`
(`provisionAdminClient`) — an administrator's only path to a fresh admin token
is `/authorize`, and `scopesAreGrantable` refuses any scope the client is not
assigned, `openid` included, which a request naming no `scope` asks for by
default. Unassigning `openid` from this one client, or any of the others, would
lock every administrator of the tenant out of a fresh login once their existing
refresh token expired — the same lockout `PATCH /clients/{id}` and `DELETE
/roles/:id` refuse for the same client, read from the same `builtin_admin`
column. An ordinary client's own assignments carry no such guard: unassigning
its `openid` narrows what `/authorize` grants it next, exactly as an unknown
scope would.

Everything below ran in one session on a freshly built stack with `odudu seed admin
--username ada` run against it and `$ADMIN_TOKEN` got as in [Getting the
token](./getting-the-token.md). The guard, against a tenant `scope-guard-demo`
made for it, on its built-in admin client `odudu-admin` and its own `openid`
assignment:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"scope-guard-demo"}' http://localhost:3000/admin/tenants -o /dev/null
G=http://localhost:3000/admin/tenants/scope-guard-demo
GUARD_OPENID=$(curl -sS -H "$A" "$G/scopes?name=openid" | jq -r '.items[0].id')
GUARD_ADMIN=$(curl -sS -H "$A" "$G/clients?client_id_exact=odudu-admin" | jq -r '.items[0].id')
```

```bash
curl -sS -D - -X DELETE -H "$A" $G/scopes/$GUARD_OPENID/clients/$GUARD_ADMIN
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a1d3a3-0b6a-74af-b78a-1a20b0453a27
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 284
Date: Fri, 13 Nov 2026 06:40:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope openid on odudu-admin, this tenant’s built-in admin client, cannot be unassigned: it could leave every administrator of this tenant locked out of /authorize","instance":"01a1d3a3-0b6a-74af-b78a-1a20b0453a27"}
```

In a tenant `scope-unassign-demo` made for this section, on a public client
`scope-unassign-app` registered for `authorization_code`. `POST /clients`
assigned it the tenant's default vocabulary, `openid` included, so `/authorize`
first renders the login form:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"scope-unassign-demo"}' http://localhost:3000/admin/tenants -o /dev/null
U=http://localhost:3000/admin/tenants/scope-unassign-demo
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"scope-unassign-app","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $U/clients -o /dev/null
OPENID=$(curl -sS -H "$A" "$U/scopes?name=openid" | jq -r '.items[0].id')
APP=$(curl -sS -H "$A" "$U/clients?client_id_exact=scope-unassign-app" | jq -r '.items[0].id')
AUTHORIZE='http://localhost:3000/tenants/scope-unassign-demo/protocol/openid-connect/auth?response_type=code&client_id=scope-unassign-app&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&scope=openid&state=xyz&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256'
```

```bash
curl -sS -o /dev/null -w '%{http_code}\n' "$AUTHORIZE"
```

```
200
```

Unassigning `openid`, then reading the client back — the scope is gone from
`scopes`, `profile` now first — then the same removal repeated. The `204`
carries the client's new `ETag`, the one that read answers;
`scope-unassign-app` is public, so `service_subject_id` reads `null`:

```bash
curl -sS -D - -X DELETE -H "$A" $U/scopes/$OPENID/clients/$APP

curl -sS -H "$A" $U/clients/$APP
echo
curl -sS -D - -X DELETE -H "$A" $U/scopes/$OPENID/clients/$APP
```

```
HTTP/1.1 204 No Content
x-request-id: 01a1d3a3-0c6f-7383-bda5-b66a8d5a2b1f
cache-control: no-store
etag: "d227a6d16f766f6e2e4b508d0e9cd24f274cf1c7ff59d0e0f49e4e1959c6d415"
Date: Fri, 13 Nov 2026 06:40:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1d3a3-0c05-706b-b83c-75d0982962eb","client_id":"scope-unassign-app","name":"scope-unassign-app","description":null,"name_i18n":{},"description_i18n":{},"type":"public","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-13T06:40:40.451Z","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"flow_id":null,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a1d3a3-0b92-73e4-b7e0-d9e30c83b926","name":"profile","assignment":"default"},{"id":"01a1d3a3-0b94-7dc3-a4c5-1814fd000714","name":"email","assignment":"default"},{"id":"01a1d3a3-0b95-7a60-9520-956e16afa8fe","name":"address","assignment":"default"},{"id":"01a1d3a3-0b97-73fd-bd75-4d6912ae5ea2","name":"phone","assignment":"default"},{"id":"01a1d3a3-0b98-7621-8776-f17ac3575183","name":"roles","assignment":"default"},{"id":"01a1d3a3-0b99-7825-aa37-0318c3f139e3","name":"groups","assignment":"default"},{"id":"01a1d3a3-0b9b-72dd-9ede-e95de80f5cf5","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"supported_locales":["en"]}
HTTP/1.1 404 Not Found
x-request-id: 01a1d3a3-0c9e-764d-99b2-2996e58005aa
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 222
Date: Fri, 13 Nov 2026 06:40:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"scope 01a1d3a3-0b90-733e-ada3-035b4eb9c3a8 is not assigned to client 01a1d3a3-0c05-706b-b83c-75d0982962eb","instance":"01a1d3a3-0c9e-764d-99b2-2996e58005aa"}
```

`/authorize`, asked for `openid` again, now refuses it the same way an
unregistered scope would — `state` and `iss` still carried back, the same
as any other redirect-side refusal:

```bash
curl -sS -D - -o /dev/null "$AUTHORIZE"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1d3a3-0cb8-717b-b7b3-60dc72a06a13
location: https://app.example/callback?error=invalid_scope&error_description=A+requested+scope+is+not+available+to+this+client.&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fscope-unassign-demo
content-length: 0
Date: Fri, 13 Nov 2026 06:40:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

## A client that may start an action keeps `me:read`

A client that may start an action through `/authorize` (`allowed_actions`, on [`PATCH /clients/{id}`](./patch-clientsid.md#the-actions-a-client-may-start))
reads the outcome through the scope `me:read`, so the scope cannot be taken from it while the allowance stands. Unassigning it
answers `409` with the code `allowed_actions_need_me_read`, and it says to clear the actions first. Deleting the scope itself is
refused the same way while any client that holds it may start an action, which [the scope's own page](./get-scopes-post-scopes-get-scopesid-patch-scopesid-and-delete-scopesid.md) shows.
In the tenant `scope-unassign-demo` above, a client `actions-app` is given `me:read`, then an action:

```bash
ME_READ=$(curl -sS -H "$A" "$U/scopes?name=me:read" | jq -r '.items[0].id')
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"actions-app","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' \
  $U/clients -o /dev/null
ACTIONS=$(curl -sS -H "$A" "$U/clients?client_id_exact=actions-app" | jq -r '.items[0].id')
curl -sS -X PUT -H "$A" -H "$J" -d '{"assignment":"optional"}' $U/scopes/$ME_READ/clients/$ACTIONS -o /dev/null
etag() { curl -sS -D - -o /dev/null -H "$A" $U/clients/$ACTIONS | tr -d '\r' | sed -n 's/^etag: //p'; }
curl -sS -X PATCH -H "$A" -H "$J" -H "If-Match: $(etag)" -d '{"allowed_actions":["configure-totp"]}' $U/clients/$ACTIONS | jq -c '{allowed_actions}'
curl -sS -D - -X DELETE -H "$A" $U/scopes/$ME_READ/clients/$ACTIONS
```

```
{"allowed_actions":["configure-totp"]}
HTTP/1.1 409 Conflict
x-request-id: 01a1d3a3-0d93-7cfe-9745-7c55edad0602
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 501
Date: Fri, 13 Nov 2026 06:40:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope me:read stays while a client may start an action, since that client reads the outcome through it: clear the client's allowed_actions first","errors":[{"path":"allowed_actions","message":"the scope me:read stays while a client may start an action, since that client reads the outcome through it: clear the client's allowed_actions first","code":"allowed_actions_need_me_read"}],"instance":"01a1d3a3-0d93-7cfe-9745-7c55edad0602"}
```

Once the actions are cleared the scope comes off, with the `204` every unassignment answers:

```bash
curl -sS -X PATCH -H "$A" -H "$J" -H "If-Match: $(etag)" -d '{"allowed_actions":[]}' $U/clients/$ACTIONS | jq -c '{allowed_actions}'
curl -sS -D - -X DELETE -H "$A" $U/scopes/$ME_READ/clients/$ACTIONS
```

```
{"allowed_actions":[]}
HTTP/1.1 204 No Content
x-request-id: 01a1d3a3-0dff-741a-8b1d-b37ad819aeb9
cache-control: no-store
etag: "2f0f56dc455b7e45d832a7c3a9104373ab2204364a513ed8cd13330ea482cf20"
Date: Fri, 13 Nov 2026 06:40:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```
