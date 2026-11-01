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
x-request-id: 01a18729-cf3d-7b5d-a742-bcac5cb1d3a0
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 284
Date: Thu, 29 Oct 2026 10:17:06 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"the scope openid on odudu-admin, this tenant’s built-in admin client, cannot be unassigned: it could leave every administrator of this tenant locked out of /authorize","instance":"01a18729-cf3d-7b5d-a742-bcac5cb1d3a0"}
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
x-request-id: 01a18729-d156-7b6f-b17f-f01ec4d44778
cache-control: no-store
etag: "28a3b2c557cc435bd4492ae18486db8bb543f149ce9ac3cf5339011fede0b160"
Date: Thu, 29 Oct 2026 10:17:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a18729-d099-785e-821b-bed5ea4dfbad","client_id":"scope-unassign-app","name":"scope-unassign-app","description":null,"name_i18n":{},"description_i18n":{},"type":"public","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","created_at":"2026-10-29T10:17:06.965Z","redirect_uris":["https://app.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"previous_secret_expires_at":null,"builtin_admin":false,"service_subject_id":null,"scopes":[{"id":"01a18729-cfc4-73c6-a8a2-1041ca7e871b","name":"profile","assignment":"default"},{"id":"01a18729-cfc9-77b8-851c-afea1f1b683a","name":"email","assignment":"default"},{"id":"01a18729-cfcf-7a9d-8a93-67621ab986e6","name":"address","assignment":"default"},{"id":"01a18729-cfd2-70e9-a496-0db55a5846b9","name":"phone","assignment":"default"},{"id":"01a18729-cfd6-7c19-a9b6-5f686f2d9c57","name":"roles","assignment":"default"},{"id":"01a18729-cfd9-7933-9663-2f53f7aa2d17","name":"groups","assignment":"default"},{"id":"01a18729-cfdd-7da2-9143-037a96554f49","name":"offline_access","assignment":"optional"}],"service_account_admin_reach":[],"supported_locales":["en"]}
HTTP/1.1 404 Not Found
x-request-id: 01a18729-d1d8-76e4-9020-6498acc9143a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 222
Date: Thu, 29 Oct 2026 10:17:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Not Found","status":404,"detail":"scope 01a18729-cfbe-7acd-8337-03a6189b7885 is not assigned to client 01a18729-d099-785e-821b-bed5ea4dfbad","instance":"01a18729-d1d8-76e4-9020-6498acc9143a"}
```

`/authorize`, asked for `openid` again, now refuses it the same way an
unregistered scope would — `state` and `iss` still carried back, the same
as any other redirect-side refusal:

```bash
curl -sS -D - -o /dev/null "$AUTHORIZE"
```

```
HTTP/1.1 302 Found
x-request-id: 01a18729-d211-766a-8c4f-9f682f72cc3a
location: https://app.example/callback?error=invalid_scope&error_description=A+requested+scope+is+not+available+to+this+client.&state=xyz&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fscope-unassign-demo
content-length: 0
Date: Thu, 29 Oct 2026 10:17:07 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```
