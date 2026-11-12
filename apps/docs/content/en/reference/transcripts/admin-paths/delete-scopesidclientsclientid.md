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
x-request-id: 01a1cc87-3058-7c09-a131-51039218aa96
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 284
Date: Wed, 11 Nov 2026 21:32:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope openid on odudu-admin, this tenant’s built-in admin client, cannot be unassigned: it could leave every administrator of this tenant locked out of /authorize","instance":"01a1cc87-3058-7c09-a131-51039218aa96"}
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
x-request-id: 01a1cc87-313b-77a1-ab0b-a78f1a3fea97
cache-control: no-store
etag: "0785937633506e60f5da50ee1d5b2ffc4c91f16061f7f9ea02be8e5a3dff8d2f"
Date: Wed, 11 Nov 2026 21:32:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a1cc87-30d4-77dd-832d-43a0c1dac83e","client_id":"scope-unassign-app","name":"scope-unassign-app","description":null,"name_i18n":{},"description_i18n":{},"type":"public","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-11-11T21:32:54.353Z","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"token_exchange_allowed_for_public":false,"token_exchange_actor_from_other_client":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"allowed_actions":[],"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a1cc87-307e-7e6f-985c-b0698f5b905c","name":"address","assignment":"default"},{"id":"01a1cc87-307d-76d6-82bc-c641bec0c70c","name":"email","assignment":"default"},{"id":"01a1cc87-3081-7a7e-aa91-408c26009c98","name":"groups","assignment":"default"},{"id":"01a1cc87-3083-789b-85e7-8e0a4e44115b","name":"offline_access","assignment":"optional"},{"id":"01a1cc87-307f-7b95-877d-19c1668b2842","name":"phone","assignment":"default"},{"id":"01a1cc87-307b-7e18-a3b3-d14339a6e1b2","name":"profile","assignment":"default"},{"id":"01a1cc87-3080-7bc2-aed1-804ef855885e","name":"roles","assignment":"default"}],"service_account_admin_reach":[],"supported_locales":["en"]}
HTTP/1.1 404 Not Found
x-request-id: 01a1cc87-316b-7e27-bf3a-59d5fcf11212
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 222
Date: Wed, 11 Nov 2026 21:32:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"scope 01a1cc87-307a-76b7-8ff4-0dcdbefae2b4 is not assigned to client 01a1cc87-30d4-77dd-832d-43a0c1dac83e","instance":"01a1cc87-316b-7e27-bf3a-59d5fcf11212"}
```

`/authorize`, asked for `openid` again, now refuses it the same way an
unregistered scope would — `state` and `iss` still carried back, the same
as any other redirect-side refusal:

```bash
curl -sS -D - -o /dev/null "$AUTHORIZE"
```

```
HTTP/1.1 302 Found
x-request-id: 01a1cc87-3181-7a59-8982-baebdd227c8c
location: https://app.example/callback?error=invalid_scope&error_description=A+requested+scope+is+not+available+to+this+client.&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fscope-unassign-demo
content-length: 0
Date: Wed, 11 Nov 2026 21:32:54 GMT
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
x-request-id: 01a1cc87-321f-779c-b44b-92cba0982cc1
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 501
Date: Wed, 11 Nov 2026 21:32:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope me:read stays while a client may start an action, since that client reads the outcome through it: clear the client's allowed_actions first","errors":[{"path":"allowed_actions","message":"the scope me:read stays while a client may start an action, since that client reads the outcome through it: clear the client's allowed_actions first","code":"allowed_actions_need_me_read"}],"instance":"01a1cc87-321f-779c-b44b-92cba0982cc1"}
```

Once the actions are cleared the scope comes off, with the `204` every unassignment answers:

```bash
curl -sS -X PATCH -H "$A" -H "$J" -H "If-Match: $(etag)" -d '{"allowed_actions":[]}' $U/clients/$ACTIONS | jq -c '{allowed_actions}'
curl -sS -D - -X DELETE -H "$A" $U/scopes/$ME_READ/clients/$ACTIONS
```

```
{"allowed_actions":[]}
HTTP/1.1 204 No Content
x-request-id: 01a1cc87-326a-7803-9993-ed50d89abfea
cache-control: no-store
etag: "42f94d64d60608bf099f9cafa97d0ccdd4d171dde6fa44341c0337c1685f2693"
Date: Wed, 11 Nov 2026 21:32:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```
