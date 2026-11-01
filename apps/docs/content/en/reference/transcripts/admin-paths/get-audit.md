---
title: 'GET /audit'
description: "Requires view-audit, which carries no manage- counterpart: nothing ever amends a row here, only reap deletes one once it is older than the tenant's…"
---

# `GET /audit`

Requires `view-audit`, which carries no `manage-` counterpart: nothing ever
amends a row here, only `reap` deletes one once it is older than the
tenant's own `audit_retention_days` setting. Every admin mutation above
writes exactly one row here, in the same transaction as the change itself —
a client's `POST`, `PATCH`, `DELETE` and secret rotation; a tenant's
`POST` and its own `PATCH /settings`; and the equivalent for subjects,
roles, groups, scopes, scope mappers, sessions, signing keys, the flow and
SMTP configuration. `detail` is a redacted before/after diff, allowlisted
per resource type: a secret, a password hash or a private key never
appears in it, whichever of the two it would have been, and a field on
neither list is absent rather than shown.

**Which event types are stored is the tenant's `audit_event_types` setting**, a
list drawn from the six types `?event_type=` filters on, every one by default.
`PATCH /settings` takes it as an array (and `odudu seed tenant --set
audit_event_types=…` comma-separated), and it is answered in the order the types
are listed here: `admin_mutation`, `admin_access`, `authentication`, `session`,
`token`, `credential`. The audit writer (`auditRepository`) reads it in the
transaction that writes each row, so **a change applies from the moment it is
saved**, to the next event on, and **it never deletes a row already stored** —
those stay until `audit_retention_days` takes them. `admin_mutation` and
`admin_access` are always stored: a value leaving either out is refused with
`400`, the error naming `audit_event_types`, and a CHECK on the column refuses
it again underneath. A security trail an attacker holding an administrator's
token could switch off is no trail.

Everything on this page above the last section ran in one session on a freshly built
stack with `odudu seed admin --username ada` run against it and `$ADMIN_TOKEN` got as
in [Getting the token](./getting-the-token.md). In a tenant `audit-types-demo`
made for it with `ivy` seeded there by `odudu seed user`, so its trail holds
nothing else: `ivy` signs in once through the tenant's `odudu-admin` client (the
sign-in "Getting the token" shows), the counts of three types are read,
`authentication` and `session` are left out — named in another order, and
answered in the listed one — a value leaving out `admin_mutation` is refused,
`ivy` signs in again, and the counts are read again. The new sign-in wrote its
`token` row and nothing of the two types left out, and the rows already stored
are still there. `$P` is the tenant's admin path:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"audit-types-demo"}' http://localhost:3000/admin/tenants -o /dev/null
P=http://localhost:3000/admin/tenants/audit-types-demo
docker compose exec -T odudu node dist/main.js seed user --tenant audit-types-demo \
  --username ivy --password 'correct-horse-battery-8c2' > /dev/null
```

The `for` loop, then the two `PATCH`es and their answers:

```bash
for t in authentication session token; do
  echo "$t $(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/count?event_type=$t")"
done
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"audit_event_types":["token","admin_access","admin_mutation","credential"]}' \
  "$P/settings" | jq -c '{audit_event_types}'
curl -sS -X PATCH -H "Authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' \
  -d '{"audit_event_types":["admin_access","token"]}' "$P/settings"; echo
```

```
authentication {"count":1,"capped":false}
session {"count":1,"capped":false}
token {"count":1,"capped":false}
{"audit_event_types":["admin_mutation","admin_access","token","credential"]}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"1 tenant setting(s) refused, listed under errors","errors":[{"path":"audit_event_types","message":"must include admin_mutation and admin_access, which can never be turned off; admin_mutation is missing"}],"instance":"01a1873a-13d0-7ee0-b408-9ddb39dd0775"}
```

`ivy` signs in again, then the same loop:

```bash
for t in authentication session token; do
  echo "$t $(curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit/count?event_type=$t")"
done
```

```
authentication {"count":1,"capped":false}
session {"count":1,"capped":false}
token {"count":2,"capped":false}
```

**Each row names its actor when it is read**, beside the ids it stores:
`actor_name` is a user's username, or the `client_id` whose service account the
actor is, resolved within the row's own tenant at read time and never written
with the row — so the trail stays append-only, and a deleted subject's name
leaves with it, `null` from then on. `actor_origin` says where the actor came
from: `tenant`, this tenant; `system`, a system administrator acting across
tenants; `other-tenant`, the subject of a foreign token refused at the door. A
name is never resolved outside the row's tenant: an auditor of a tenant reads no
other tenant's subjects anywhere else, so a system administrator appears as
`system` with the id alone, and a system auditor reads that name in `system`'s
own trail. A name is a username, which reading takes `view-users` everywhere
else, so a caller holding `view-audit` without it reads `actor_name` as `null`
on every row, with `actor_origin` still set — the same rule that masks a
recipient under `GET /mail`. `GET /clients/:id/evaluate` and `DELETE /sessions`
above show a `system` and a `tenant` actor, and `GET /audit/export` below a
deleted one. The transcripts of this listing here and in [the request
paths](../request-paths/index.md) show both fields; those in [the console
paths](../console-paths/index.md) say at the block that they predate them.

`ivy`, seeded in `ops-demo` with `odudu seed user` and granted
`odudu-admin:view-audit` alone (`$IVY_TOKEN`, got the way "Getting the token" shows
through the tenant's own `odudu-admin` client), reads the row `DELETE /sessions`
left, then `$ADMIN_TOKEN` reads the same row:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"ops-demo"}' http://localhost:3000/admin/tenants -o /dev/null
P=http://localhost:3000/admin/tenants/ops-demo
docker compose exec -T odudu node dist/main.js seed user --tenant ops-demo \
  --username ivy --password 'correct-horse-battery-8c2' > /dev/null
IVY=$(curl -sS -H "$A" "$P/subjects?username=ivy" | jq -r '.items[0].id')
VIEW_AUDIT=$(curl -sS -H "$A" "$P/roles?name=view-audit" | jq -r '.items[] | select(.name == "view-audit") | .id')
ETAG=$(curl -sS -D - -o /dev/null -H "$A" $P/subjects/$IVY/roles | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT -H "$A" -H "$J" -H "If-Match: $ETAG" -d "{\"role_ids\":[\"$VIEW_AUDIT\"]}" $P/subjects/$IVY/roles -o /dev/null
curl -sS -X DELETE -H "$A" $P/sessions -o /dev/null
```

```bash
curl -sS -H "Authorization: Bearer $IVY_TOKEN" "$P/whoami"; echo
curl -sS -H "Authorization: Bearer $IVY_TOKEN" "$P/audit?action=session.end_all&limit=1"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$P/audit?action=session.end_all&limit=1"; echo
```

```
{"subjectId":"01a1873a-19be-711a-b3ae-a6408cfe7e79","issuerTenantId":"01a1873a-178d-7da0-912a-e976785881ac","capabilities":["view-audit"],"crossTenant":false}
{"items":[{"id":"01a1873a-1b1d-74a0-b9d5-a48ae2bd2294","occurred_at":"2026-10-29T10:34:54.617Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a1873a-178d-7da0-912a-e976785881ac","request_id":"01a1873a-1b08-75cf-8194-c970aef1a0fa","ip":"172.20.0.1","detail":{"ended":0,"remaining":0,"beyond_ceiling":0}}]}
{"items":[{"id":"01a1873a-1b1d-74a0-b9d5-a48ae2bd2294","occurred_at":"2026-10-29T10:34:54.617Z","event_type":"admin_mutation","action":"session.end_all","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a1873a-178d-7da0-912a-e976785881ac","request_id":"01a1873a-1b08-75cf-8194-c970aef1a0fa","ip":"172.20.0.1","detail":{"ended":0,"remaining":0,"beyond_ceiling":0}}]}
```

`outcome` is `allowed`, `refused` or `failed`. Three kinds of mutation
refusal record an `admin_mutation` row. **`POST /clients`** does — a
reserved `client_id`, metadata `parseClientMetadata` rejects, or a tenant at
its client capacity. So does **every capability ceiling**: `POST /groups`
and `PATCH /groups/{id}` choosing a parent, `PUT /subjects/{id}/roles`,
`PUT /groups/{id}/roles`, `PUT /scopes/{id}/roles` and
`POST /roles/{id}/composites`; every removal judged by what it removes; the
target ceiling on every non-`GET` route under `/subjects/{id}`; and the
same ceiling on a client's service account — each writing a row whose
`detail.denied` names the capabilities the caller does not hold. And so
does **every `409` guarding the built-in admin surface**
(`builtin_admin_guarded`, the `openid` scope's delete and disabling the
system tenant), with the refusal's text under `detail.reason`, since the
caller is authenticated (ADR 0037's amendment of 2026-09-28). An attempted
privilege escalation is the refusal worth recording even while refusals in
general are not. Every other mutation above writes an `admin_mutation` row
only when it succeeds; `?outcome=refused` against a resource type with none
of those doors returns no `admin_mutation` row, not because nothing was
refused.

The door in front of every route records two refusals of its own, as
`admin_access` rows, whatever the route. A **`403`** to an authenticated
caller writes `capability.refused`, reads included, with `detail.capability`
naming the capability the caller lacked — `manage-tenants` when a system
admin without it reaches another tenant, the route's own otherwise. A
**`401` for a genuine token from another tenant** of this deployment writes
`token.foreign_issuer` into the tenant it was presented at, below. Every
other `401` — no token, a malformed or forged one, an issuer this
deployment does not serve, a dead session — writes no row, only a `warn`
log line naming the reason: the caller has proved nothing, so a row per
request would be theirs to append at will (ADR 0037).

`tenant_id` on a row is the tenant the change was made **to**, not the
tenant of whoever made it. `actor_tenant_id` and `actor_client_id` name the
caller instead — the tenant that issued the caller's own token and the
admin client it authenticated as — so a system admin's change to this
tenant is a row this tenant's own administrators can read, and can see was
made by someone outside it.

Paginated the same way every other list here is, over `(occurred_at, id)`
descending rather than ascending `id`: newest first. Filters narrow the page
rather than requiring one: `event_type`, `actor_subject_id`, `resource_type`,
`resource_id`, `action`, `outcome`, and a `from`/`to` range on `occurred_at`
(ISO 8601, with an offset). `event_type` must be one of the vocabulary's own six
values (`admin_mutation`, `admin_access`, `authentication`, `session`, `token`,
`credential`) and `actor_subject_id` must be a UUID, since the column is one —
either answers `400` rather than reaching Postgres and failing there.
`resource_id` is text, not a UUID: a reserved-`client_id` refusal names it by
the string the caller sent, and an `authentication_session` row by a sha256
digest, so the column is never narrower than what it holds ([What a refused
login leaves
behind](../request-paths/path-a-authorization-code-with-pkce.md#what-a-refused-login-leaves-behind)).
`resource_id` alone is ambiguous — a client, a role and a group can all happen
to share an id — so it answers `400` naming both fields unless `resource_type`
is given alongside it, the same way a cursor minted under one filter set is
refused when `resource_id` is added to it on replay. `request_id` and `ip` are
never filters. Both default from the request that made the change
(`withTenant`'s own `RequestContext`): `request_id` is the request's own id,
which a caller may supply as `x-request-id` (truncated to 128 characters), and
`ip` is `request.ip`, which only `ODUDU_TRUST_PROXY` lets a forwarded header
decide. So `request_id` correlates rows and `ip` is the evidence: a join on
`request_id` holds for requests you made or that came through a proxy you trust,
and shows only what the caller claimed for anyone else's (ADR 0037's third
amendment).

The examples below — this section only — show `request_id`/`ip` filled in and
the `event_type` filter working. Requests below went from the host into the
container over the compose network, so `ip` is that network's own gateway address
rather than `127.0.0.1`.

The same writes in a tenant `audit-demo` created for them, so a client's diff
carries every field it now records — `demo-backend` with a `jwks`, `demo-app`,
the reserved `client_id` refused, then a key staged, promoted and the old one
retired — with ids of a fresh run, and the actor `ada`. `actor_origin` is
`system` on every row, and `actor_name` `null`, a system administrator being
named only in `system`'s own trail:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"audit-demo"}' http://localhost:3000/admin/tenants -o /dev/null
T=http://localhost:3000/admin/tenants/audit-demo
JWK=$(node -e "
const jwk = require('node:crypto').generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({ format: 'jwk' });
console.log(JSON.stringify({ ...jwk, use: 'sig', alg: 'ES256', kid: 'demo-backend-key' }));")
curl -sS -X POST -H "$A" -H "$J" \
  -d "{\"client_id\":\"demo-backend\",\"grant_types\":[\"client_credentials\"],\"token_endpoint_auth_method\":\"private_key_jwt\",\"jwks\":{\"keys\":[$JWK]}}" $T/clients -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"demo-app","redirect_uris":["https://app.demo.example/callback"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none"}' $T/clients -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"odudu-admin","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}' $T/clients -o /dev/null
OLD=$(curl -sS -H "$A" $T/keys | jq -r '.items[] | select(.status == "active") | .id')
NEW=$(curl -sS -X POST -H "$A" -H "$J" -d '{"alg":"ES256"}' $T/keys | jq -r .id)
curl -sS -X POST -H "$A" $T/keys/$NEW/promote -o /dev/null
curl -sS -X POST -H "$A" $T/keys/$OLD/retire -o /dev/null
```

```bash
curl -sS -G \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "action=client.create" \
  --data-urlencode "limit=20" \
  http://localhost:3000/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a1873a-1ea0-7127-9069-d2e8a3a58b56","occurred_at":"2026-10-29T10:34:55.520Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"odudu-admin","request_id":"01a1873a-1e99-74e2-8069-7e38e6227914","ip":"172.20.0.1","detail":{}},{"id":"01a1873a-1e8f-7e36-a9ef-2c800677cd6a","occurred_at":"2026-10-29T10:34:55.490Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a1873a-1e83-759b-b4b2-30d82ab74fb5","request_id":"01a1873a-1e7a-763b-b9c0-73f19b91666b","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"name_i18n":{"after":{}},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["authorization_code"]},"web_origins":{"after":[]},"redirect_uris":{"after":["https://app.demo.example/callback"]},"default_max_age":{"after":null},"description_i18n":{"after":{}},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"skip_logout_confirmation":{"after":false},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"none"},"id_token_signed_response_alg":{"after":null}}},{"id":"01a1873a-1e6f-72b9-afdc-731e38bfde18","occurred_at":"2026-10-29T10:34:55.411Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a1873a-1e53-7e37-ad66-edc32cb587f6","request_id":"01a1873a-1e2b-7c2c-abef-0d465c1ea844","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"name_i18n":{"after":{}},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"default_max_age":{"after":null},"description_i18n":{"after":{}},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"skip_logout_confirmation":{"after":false},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"private_key_jwt"},"id_token_signed_response_alg":{"after":null}}}]}
```

That is all three `client.create` rows, newest first: the reserved-`client_id`
refusal, attempted last, then `demo-app` and `demo-backend` below it — both
created directly through `POST /clients`, oldest last.

`actor_tenant_id` is `system` on all three, and `tenant_id` is absent from
the row's own representation — the tenant a row belongs to is the one in
the path. None of the three `detail`s carries a secret: the refusal's is
empty, there being no row to diff, and `demo-backend` was created with
one — the allowlist shows `jwks` as `{"changed": true}` rather than a
value, which is the shape every redacted field takes. Every `request_id`
is a real request id and every `ip` the container's own view of the
caller.

Three signing-key rows from a stage/promote/retire rotation on this same
stack, narrowed by `resource_type` alone. Their `detail` is empty, a key
having no allowlisted field to diff:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=signing_key" \
  http://localhost:3000/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a1873a-1efa-74b3-a9e7-f51509a8470d","occurred_at":"2026-10-29T10:34:55.605Z","event_type":"admin_mutation","action":"key.retire","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"signing_key","resource_id":"01a1873a-1df8-725a-9104-a37002f9fac6","request_id":"01a1873a-1eed-75e9-9f6c-cac7e0cc0fe1","ip":"172.20.0.1","detail":{}},{"id":"01a1873a-1ee2-785a-8d7f-b4735ab81fcb","occurred_at":"2026-10-29T10:34:55.583Z","event_type":"admin_mutation","action":"key.promote","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"signing_key","resource_id":"01a1873a-1ec9-7a82-b261-795837633dd3","request_id":"01a1873a-1ed6-75bc-87a3-b5130f0b0e9f","ip":"172.20.0.1","detail":{}},{"id":"01a1873a-1eca-7841-83be-74eccbf23de2","occurred_at":"2026-10-29T10:34:55.560Z","event_type":"admin_mutation","action":"key.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"signing_key","resource_id":"01a1873a-1ec9-7a82-b261-795837633dd3","request_id":"01a1873a-1ebf-7ac9-ad4c-9c7f7a3b8e47","ip":"172.20.0.1","detail":{}}]}
```

And `?outcome=refused`, non-empty for `POST /clients`: the same
reserved-`client_id` row shown above, on its own —
`resource_id` is the `client_id` string, there being no row to name:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "outcome=refused" \
  http://localhost:3000/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a1873a-1ea0-7127-9069-d2e8a3a58b56","occurred_at":"2026-10-29T10:34:55.520Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"odudu-admin","request_id":"01a1873a-1e99-74e2-8069-7e38e6227914","ip":"172.20.0.1","detail":{}}]}
```

Adding `event_type=admin_mutation` to the first query —
`resource_type=client&action=client.create` — answers the same three rows byte
for byte, since every `client` mutation writes an `admin_mutation` row and no
other kind. The session `DELETE` is the one admin endpoint that also writes a
row of another kind, a `session` row beside its own:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_mutation" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "action=client.create" \
  http://localhost:3000/admin/tenants/audit-demo/audit; echo
```

```
{"items":[{"id":"01a1873a-1ea0-7127-9069-d2e8a3a58b56","occurred_at":"2026-10-29T10:34:55.520Z","event_type":"admin_mutation","action":"client.create","outcome":"refused","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"odudu-admin","request_id":"01a1873a-1e99-74e2-8069-7e38e6227914","ip":"172.20.0.1","detail":{}},{"id":"01a1873a-1e8f-7e36-a9ef-2c800677cd6a","occurred_at":"2026-10-29T10:34:55.490Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a1873a-1e83-759b-b4b2-30d82ab74fb5","request_id":"01a1873a-1e7a-763b-b9c0-73f19b91666b","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-app"},"type":{"after":"public"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"name_i18n":{"after":{}},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["authorization_code"]},"web_origins":{"after":[]},"redirect_uris":{"after":["https://app.demo.example/callback"]},"default_max_age":{"after":null},"description_i18n":{"after":{}},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"skip_logout_confirmation":{"after":false},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"none"},"id_token_signed_response_alg":{"after":null}}},{"id":"01a1873a-1e6f-72b9-afdc-731e38bfde18","occurred_at":"2026-10-29T10:34:55.411Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a1873a-1e53-7e37-ad66-edc32cb587f6","request_id":"01a1873a-1e2b-7c2c-abef-0d465c1ea844","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"demo-backend"},"type":{"after":"confidential"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"name_i18n":{"after":{}},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"default_max_age":{"after":null},"description_i18n":{"after":{}},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"skip_logout_confirmation":{"after":false},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"private_key_jwt"},"id_token_signed_response_alg":{"after":null}}}]}
```

`?event_type=token`, a vocabulary event type no admin route writes,
answers an empty page rather than an error:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=token" \
  http://localhost:3000/admin/tenants/audit-demo/audit
```

```
{"items":[]}
```

A value the vocabulary does not name answers `400`, the same shape `querystring`
validation already answers elsewhere in the admin paths:

In `audit-demo`:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=bogus" \
  http://localhost:3000/admin/tenants/audit-demo/audit
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/event_type must be equal to one of the allowed values","errors":[{"path":"event_type","message":"must be equal to one of the allowed values"}],"instance":"01a1873a-1f6e-7e8b-951e-3539dd228676"}
```

`resource_id` narrows further, and requires `resource_type` alongside it — with
a tenant created only for this subsection, `resource-audit`, so its trail holds
nothing but what it did: two clients, `resource-doc-a` and `resource-doc-b`,
created by `ada`:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"resource-audit"}' http://localhost:3000/admin/tenants -o /dev/null
R=http://localhost:3000/admin/tenants/resource-audit
for c in resource-doc-a resource-doc-b; do
  curl -sS -X POST -H "$A" -H "$J" \
    -d "{\"client_id\":\"$c\",\"grant_types\":[\"client_credentials\"],\"token_endpoint_auth_method\":\"client_secret_basic\"}" $R/clients -o /dev/null
done
RDA=$(curl -sS -H "$A" "$R/clients?client_id_exact=resource-doc-a" | jq -r '.items[0].id')
```

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "resource_type=client" \
  --data-urlencode "resource_id=$RDA" \
  http://localhost:3000/admin/tenants/resource-audit/audit; echo
```

```
{"items":[{"id":"01a1873a-2032-757b-8c5a-e78663ddf030","occurred_at":"2026-10-29T10:34:55.809Z","event_type":"admin_mutation","action":"client.create","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"client","resource_id":"01a1873a-2011-76a6-97f7-ff5d38f7992e","request_id":"01a1873a-1fb9-7e83-8df4-46de21244111","ip":"172.20.0.1","detail":{"jwks":{"changed":true},"name":{"after":"resource-doc-a"},"type":{"after":"confidential"},"enabled":{"after":true},"tos_uri":{"after":null},"jwks_uri":{"after":null},"audiences":{"after":[]},"name_i18n":{"after":{}},"client_uri":{"after":null},"policy_uri":{"after":null},"description":{"after":null},"grant_types":{"after":["client_credentials"]},"web_origins":{"after":[]},"redirect_uris":{"after":[]},"default_max_age":{"after":null},"description_i18n":{"after":{}},"require_auth_time":{"after":false},"full_scope_allowed":{"after":false},"id_token_ttl_seconds":{"after":null},"backchannel_logout_uri":{"after":null},"frontchannel_logout_uri":{"after":null},"access_token_ttl_seconds":{"after":null},"skip_logout_confirmation":{"after":false},"client_credentials_scopes":{"after":[]},"post_logout_redirect_uris":{"after":[]},"refresh_token_ttl_seconds":{"after":null},"token_endpoint_auth_method":{"after":"client_secret_basic"},"id_token_signed_response_alg":{"after":null}}}]}
```

That is `resource-doc-a`'s own row, not `resource-doc-b`'s.

`resource_id` alone, with no `resource_type`, is refused — a client, a
role and a group could all happen to share this id, so which table it
names is not optional:

In `audit-demo`, with an id no row there names — the refusal is of the query's
shape, before any row is read:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/audit-demo/audit?resource_id=01a0e150-b9ec-70a9-8e34-663280fa0514"
```

```
{"type":"about:blank","title":"Bad Request","status":400,"detail":"resource_id requires resource_type","errors":[{"path":"resource_id","message":"resource_id requires resource_type"}],"instance":"01a1873a-2104-7826-8d6a-6a57b23683da"}
```

No page above needed a `next`: no scope held more than twenty rows.

## A token from another tenant, and a caller missing a capability

This subsection runs on the same stack, with `ada` in the `system` tenant as before.
She creates the tenants `demo` and `acme` through `POST /admin/tenants`, and a
client `demo-operator` in `demo` through `POST /clients` — `client_credentials`,
`client_secret_basic`, with the admin audience in `audiences`. `demo-operator` holds no
capability in `demo`. `$DEMO_TOKEN` is its `client_credentials` token:

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"demo"}' http://localhost:3000/admin/tenants -o /dev/null
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"acme"}' http://localhost:3000/admin/tenants -o /dev/null
OPSECRET=$(curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"demo-operator","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":["urn:odudu:params:admin-api"]}' \
  http://localhost:3000/admin/tenants/demo/clients | jq -r .client_secret)
DEMO_TOKEN=$(curl -sS -u "demo-operator:$OPSECRET" -d grant_type=client_credentials \
  http://localhost:3000/tenants/demo/protocol/openid-connect/token | jq -r .access_token)
```

`demo-operator`'s `client_credentials` token is a genuine `demo` token for
the admin API. Its payload, decoded as in
[Getting the token](./getting-the-token.md), and `demo` accepting it:

```bash
echo "$DEMO_TOKEN" | cut -d. -f2 | python3 -c "
import sys, base64, json
s = sys.stdin.read().strip()
print(json.dumps(json.loads(base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))), indent=2))"
```

```
{
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a1873a-21da-720b-898d-6a669f47ae9e",
  "aud": [
    "urn:odudu:params:admin-api",
    "http://localhost:3000/tenants/demo"
  ],
  "client_id": "demo-operator",
  "scope": "",
  "iat": 1793270096,
  "exp": 1793270396,
  "jti": "01a1873a-2244-7077-9f3a-2600b3dc3eec",
  "grant_id": "01a1873a-2244-7077-9f3a-25ffc46090e2"
}
```

```bash
curl -sS -H "Authorization: Bearer $DEMO_TOKEN" \
  http://localhost:3000/admin/tenants/demo/whoami
echo
```

```
{"subjectId":"01a1873a-21da-720b-898d-6a669f47ae9e","issuerTenantId":"01a1873a-2122-72e5-b8e7-53dac5b262d5","capabilities":[],"crossTenant":false}
```

Presented at `acme` instead, it is refused with the `401` a string that is
not a token at all gets. Both requests carry the same `x-request-id`, so the
two responses differ only in `Date`:

```bash
curl -sS -D - -H "Authorization: Bearer $DEMO_TOKEN" \
  -H 'x-request-id: foreign-issuer-doc' \
  http://localhost:3000/admin/tenants/acme/subjects
curl -sS -D - -H "Authorization: Bearer not-a-token" \
  -H 'x-request-id: foreign-issuer-doc' \
  http://localhost:3000/admin/tenants/acme/subjects
```

```
HTTP/1.1 401 Unauthorized
x-request-id: foreign-issuer-doc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 90
Date: Thu, 29 Oct 2026 10:34:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"foreign-issuer-doc"}HTTP/1.1 401 Unauthorized
x-request-id: foreign-issuer-doc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 90
Date: Thu, 29 Oct 2026 10:34:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"foreign-issuer-doc"}
```

What tells them apart is behind the response. The first names an issuer
this deployment serves, and its signature verifies against `demo`'s own
keys, so it is recorded in `acme`'s trail — the tenant the attempt was made
against — naming `demo` as the caller's tenant, its subject and its client.
The second writes only a `warn` line to the server's log:

```bash
docker compose logs --no-log-prefix odudu | grep foreign-issuer-doc | grep malformed_token | tail -n 1
```

```
{"level":40,"time":1793270096555,"pid":1,"hostname":"d6283b5bbb7b","reqId":"foreign-issuer-doc","reason":"malformed_token","msg":"admin request unauthenticated"}
```

`acme` was created moments before, so its `admin_access` trail holds only what
this subsection did; `demo`'s holds nothing yet:

```bash
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3000/admin/tenants/acme/audit; echo
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3000/admin/tenants/demo/audit; echo
```

```
{"items":[{"id":"01a1873a-22a0-7756-8957-54c1c5aaca55","occurred_at":"2026-10-29T10:34:56.543Z","event_type":"admin_access","action":"token.foreign_issuer","outcome":"refused","actor_tenant_id":"01a1873a-2122-72e5-b8e7-53dac5b262d5","actor_subject_id":"01a1873a-21da-720b-898d-6a669f47ae9e","actor_client_id":"01a1873a-21f6-73ce-b689-e09db53a2937","actor_name":null,"actor_origin":"other-tenant","resource_type":null,"resource_id":null,"request_id":"foreign-issuer-doc","ip":"172.20.0.1","detail":{"reason":"foreign_issuer"}}]}
{"items":[]}
```

The same token at `demo`, where it authenticates but holds no capability,
is a `403`, and `demo`'s trail now has the `capability.refused` row naming
what `GET /subjects` needed:

```bash
curl -sS -D - -H "Authorization: Bearer $DEMO_TOKEN" \
  -H 'x-request-id: capability-refused-doc' \
  http://localhost:3000/admin/tenants/demo/subjects; echo
curl -sS -G -H "Authorization: Bearer $ADMIN_TOKEN" \
  --data-urlencode "event_type=admin_access" \
  http://localhost:3000/admin/tenants/demo/audit; echo
```

```
HTTP/1.1 403 Forbidden
x-request-id: capability-refused-doc
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 91
Date: Thu, 29 Oct 2026 10:34:56 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"instance":"capability-refused-doc"}
{"items":[{"id":"01a1873a-2365-7d0d-b1b5-d7c493a7470c","occurred_at":"2026-10-29T10:34:56.740Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a1873a-2122-72e5-b8e7-53dac5b262d5","actor_subject_id":"01a1873a-21da-720b-898d-6a669f47ae9e","actor_client_id":"01a1873a-21f6-73ce-b689-e09db53a2937","actor_name":"demo-operator","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"capability-refused-doc","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"view-users"}}]}
```

## Reads that are too broad, and instants that cannot be held

`GET /audit`, `GET /audit/count` and `GET /audit/export` walk one index, the one
serving the most selective filter, and filter by the rest. Two filters few rows share
(an action and an actor, say) leave Postgres reading all of the cheaper one, however
small the page. So each runs under a statement timeout of five seconds, set in its own
transaction and gone with it, and past it the answer is a `400` of type
`about:blank#audit-query-too-broad` whose `detail` says to narrow the time range with
`from` and `to`: they lead the time index, so a pair narrowed by them is cheap. It is a
`400` rather than a `503` because asking again unchanged can only fail the same way.
`from` and `to` are instants from 1970 to 9999; the year 0 that used to reach Postgres
as a `500` is refused at the door.

This section is a load test and ran on a stack of its own, on port `3082`, which
is why its addresses, dates and ids are not the ones above; its timings are that
machine's. From an empty volume, with `seed admin --username ada` and the token got the way
"Getting the token" shows. Twelve million rows were then inserted into
`system`'s trail as the database owner, half under the action `bulk.a` and an
actor, half under `bulk.b` and another, the last eight million fifty days older
than the rest, and `analyze` run; `$P` is
`http://localhost:3082/admin/tenants/system` and `$A` the second actor,
`22222222-2222-4222-8222-222222222222`. Each response is followed by its
`time_total`. The same pair on four million rows took 2.5 s, so the bound is
crossed from about ten million, and a hundred million is some twenty-five times
that:

```bash
curl -sS -D - -w "\n%{time_total} s\n" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?action=bulk.a&actor_subject_id=$A&limit=1"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a13cfd-82b0-7ec2-8445-39b5e544e774
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 251
Date: Thu, 15 Oct 2026 00:36:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#audit-query-too-broad","title":"Bad Request","status":400,"detail":"these filters could not be searched within 5 seconds; narrow the time range with from and to, or drop a filter","instance":"01a13cfd-82b0-7ec2-8445-39b5e544e774"}
5.022991 s
```

The same filters with a ten minute window, which the time index serves, then the
count and the export, which have no window and sit close to the bound. Both
finished inside it this time; on an earlier pass over the same rows, before
the table had been read once, each was refused with the same `400` as the
first request:

```bash
curl -sS -D - -w "\n%{time_total} s\n" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?action=bulk.a&actor_subject_id=$A&from=2026-10-27T02:09:50Z&limit=1"
curl -sS -D - -w "\n%{time_total} s\n" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit/count?action=bulk.a&actor_subject_id=$A"
curl -sS -D - -w "\n%{time_total} s\n" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit/export?action=bulk.a&actor_subject_id=$A"
```

```
HTTP/1.1 200 OK
x-request-id: 01a13cfd-96c3-7f6d-8178-6164156d37b1
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 12
Date: Thu, 15 Oct 2026 00:36:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[]}
0.014213 s
```

```
HTTP/1.1 200 OK
x-request-id: 01a13cfd-96e7-76eb-9fd3-f4e2b838f8dc
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 26
Date: Thu, 15 Oct 2026 00:36:58 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"count":0,"capped":false}
4.528085 s
```

```
HTTP/1.1 200 OK
x-request-id: 01a13cfd-a709-7603-815f-a3c9f0ad99a0
cache-control: no-store
content-type: application/x-ndjson; charset=utf-8
content-length: 0
Date: Thu, 15 Oct 2026 00:37:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72


3.268358 s
```

And an instant before 1970, refused by the contract with a sentence naming the
field and the range, as the same `errors[]` every other admin `400` carries (the
count and the export answer the same with `to`):

```bash
curl -sS -D - -w "\n%{time_total} s\n" -H "Authorization: Bearer $ADMIN_TOKEN" \
  "$P/audit?from=0000-01-01T00:00:00Z"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a13d62-c82f-7859-866d-bb29899ca1a1
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 241
Date: Thu, 15 Oct 2026 02:27:26 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Bad Request","status":400,"detail":"from must be a date between 1970 and 9999","errors":[{"path":"from","message":"from must be a date between 1970 and 9999"}],"instance":"01a13d62-c82f-7859-866d-bb29899ca1a1"}
0.011033 s
```

The last block ran on a further stack, on port `3187`. A year after 9999 is refused earlier, by the route's own date pattern rather
than the contract, so its `400` is titled `Error` and its `detail` is the
pattern itself, which accepts four-digit years only; `from`, the count and the
export answer the same.

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3187/admin/tenants/system/audit?to=10000-01-01T00:00:00Z"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a140be-b3f5-7530-9aa8-b1346cc2c373
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 822
Date: Thu, 15 Oct 2026 18:06:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Error","status":400,"detail":"querystring/to must match pattern \"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$\"","errors":[{"path":"to","message":"must match pattern \"^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$\""}],"instance":"01a140be-b3f5-7530-9aa8-b1346cc2c373"}
```
