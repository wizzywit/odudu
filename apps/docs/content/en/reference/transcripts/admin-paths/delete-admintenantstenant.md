---
title: 'DELETE /admin/tenants/{tenant}'
description: 'Requires manage-tenants, the capability every other route over the tenant collection takes, so only a system administrator reaches it.'
---

# `DELETE /admin/tenants/{tenant}`

Requires `manage-tenants`, the capability every other route over the tenant
collection takes, so only a system administrator reaches it. Deletes the tenant
and every row it holds, in one statement: every table holding a tenant's rows is
reached by a cascade from `tenants`, directly or through a subject or a client,
and an integration test counts every table carrying a `tenant_id`, read from the
catalogue, before and after. `confirm` must be the tenant's own name — a slip of
the path deletes nothing — refused with `400` naming it otherwise. The `system`
tenant is refused with `409`: every cross-tenant administrator authenticates
against it. So is a caller who does not hold every admin capability some subject
of the tenant holds, with `403`: deleting the tenant takes all of it at once
(ADR 0040's target ceiling, over every subject). The tenant's own trail goes
with it, so `tenant.delete` is recorded in the `system` tenant's, in the same
transaction (`withTenantThen`, `@odudu/db`), and so are its refusals. No
last-administrator guard is needed beside the refusal of `system`: a system
administrator's authority lives in `system`, which no deletion reaches.

No relying party is left signed in without having been sent a Back-Channel
Logout Token. So an enabled tenant is refused with `409`,
`about:blank#tenant-enabled`. Disabling it first — `PATCH /admin/tenants/{tenant}`
or `PATCH /settings` with `{"enabled": false}` — commits the disable on its
own, then ends every live session it holds, with no ceiling, 500 to a
transaction, queueing a Logout Token for each client that registered a
back-channel URI, the way `DELETE /sessions` does; each batch writes a
`session.end_all` row with `via: "tenant_disabled"`. The answer comes once
none is left. Should a batch fail, the disable stands and the answer is `500`,
`about:blank#sessions-not-ended`, saying how many sessions are still live;
sending `{"enabled": false}` again ends the rest. So a tenant that still has a
live session is refused with `409`, `about:blank#sessions-live`, naming how
many. The batches run in the request rather than in a scheduled pass: a
session ends in a few statements, so even a large tenant is done in the
request, the operator learns there whether it finished, and nothing new has
to be enabled, scheduled or watched for it. A tenant whose tokens are still
to be sent is refused with `409`, `about:blank#logout-deliveries-pending`,
naming how many; one that was delivered, or that spent its last attempt, is
not waited for, since it will never be offered again.

A disabled tenant keeps answering its discovery document and `/certs`, and
nothing else: the Logout Tokens its disable queued are signed with its keys,
and a relying party validates each against them (Back-Channel Logout 1.0
§2.6). Deleting the tenant removes them.

One window no deletion can close. A resource server that verifies access
tokens itself, against a cached copy of the tenant's JWKS, accepts one
issued before the tenant was disabled until it expires — at most 3600
seconds, the cap on `access_token_ttl_seconds`. Disabling ends the sessions
and refresh tokens behind it; it cannot recall a token already handed out.

The deletion is a single transaction, and its duration grows with the
tenant's audit trail, the largest table it cascades through: there is no
bound, batch or timeout, so a tenant holding tens of millions of audit rows
holds its locks until the last is gone. A chunked, resumable delete is
planned on [the roadmap](../../../roadmap.md#later). A tenant-scoped write
that raced it and began second fails its foreign-key check once the
deletion commits, and answers `500`; nothing is orphaned, since the row it
needed is gone and it writes nothing.

`ada` seeded in `system`, `ODUDU_ALLOW_PRIVATE_CLIENT_URLS=true` and the
server's own logout sender off, so the passes below are the ones the transcript
runs: a tenant `doomed` created through `POST /admin/tenants`, given a client
through `POST /clients`, its id `01a140bf-2b2b-7e8f-a63a-c6c8b0f964d9`.
`count-rows.sql` counts that id's rows in every table with a `tenant_id` column,
as the database's owner:

```
SELECT table_name,
       (xpath('/row/n/text()', query_to_xml(format(
         'select count(*) as n from %I where tenant_id = %L',
         table_name, '01a140bf-2b2b-7e8f-a63a-c6c8b0f964d9'), false, true, '')))[1]::text::int AS n
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'tenant_id'
 ORDER BY n DESC, table_name;
```

`ada` was seeded in it with `odudu seed user` and signed in once through
`doomed-app`, a confidential client with a back-channel logout URI of
`https://postgres:9/backchannel`, where nothing listens. Before, three
refusals — no `confirm`, a wrong one, and `system` — then the refusal of an
enabled tenant; its disabling, which ended `ada`'s session in one batch and
queued one token; the batch's row; the disabled tenant's discovery document
and key set, still served, beside a `/token` it refuses; a session written
straight into the table after the disable, and the refusal it causes; the
disable sent again, which ends it; the refusal while the token is pending;
five passes of the sender a minute apart, each a failure, the fifth its last
attempt; the deletion, with `$A` minted again first because the loop outlasts
its five minutes; a read of the tenant, its discovery document and key
set, now gone; after; and `system`'s trail:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"
T=http://localhost:3187/admin/tenants
O=http://localhost:3187/tenants/doomed
pg() { docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f -'; }
pg < count-rows.sql
curl -sS -X DELETE -H "$A" "$T/doomed"; echo
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=Doomed"; echo
curl -sS -X DELETE -H "$A" "$T/system?confirm=system"; echo
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=doomed"; echo
curl -sS -X PATCH -H "$A" -H 'content-type: application/json' -d '{"enabled":false}' "$T/doomed"; echo
curl -sS -H "$A" "$T/doomed/audit?action=session.end_all" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","actor_name","detail")})) for i in json.load(sys.stdin)["items"]]'
for p in .well-known/openid-configuration protocol/openid-connect/certs protocol/openid-connect/token; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$O/$p")"
done
curl -sS "$O/protocol/openid-connect/certs" | python3 -c 'import json,sys;print([k["kid"] for k in json.load(sys.stdin)["keys"]])'
echo "INSERT INTO sessions (id, tenant_id, subject_id, expires_at, last_active_at, secret_hash)
  SELECT gen_random_uuid(), tenant_id, subject_id, now() + interval '1 hour', now(), md5('late')
    FROM users WHERE tenant_id = '01a140bf-2b2b-7e8f-a63a-c6c8b0f964d9' AND username = 'ada';" | pg
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=doomed"; echo
curl -sS -o /dev/null -w '%{http_code}\n' -X PATCH -H "$A" -H 'content-type: application/json' \
  -d '{"enabled":false}' "$T/doomed"
curl -sS -X DELETE -H "$A" "$T/doomed?confirm=doomed"; echo
for pass in 1 2 3 4 5; do
  docker compose exec -T odudu node dist/main.js send-logouts 2>/dev/null
  [ "$pass" = 5 ] || sleep 61
done
A="Authorization: Bearer $ADMIN_TOKEN" # $ADMIN_TOKEN minted again: the loop outlasts its five minutes
curl -sS -D - -X DELETE -H "$A" "$T/doomed?confirm=doomed"
curl -sS -H "$A" "$T/doomed"; echo
for p in .well-known/openid-configuration protocol/openid-connect/certs; do
  printf '%-40s %s\n' "$p" "$(curl -s -o /dev/null -w '%{http_code}' "$O/$p")"
done
pg < count-rows.sql
curl -sS -H "$A" "$T/system/audit?action=tenant.delete&resource_type=tenant&resource_id=01a140bf-2b2b-7e8f-a63a-c6c8b0f964d9" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","outcome","actor_name","resource_id","detail")})) for i in json.load(sys.stdin)["items"]]'
curl -sS -H "$A" "$T/system/audit?action=tenant.delete&outcome=refused&limit=1" \
  | python3 -c 'import json,sys;[print(json.dumps({k:i[k] for k in ("action","outcome","actor_name","resource_id","detail")})) for i in json.load(sys.stdin)["items"]]'
```

```
          table_name           | n
-------------------------------+----
 client_scope_assignments      | 26
 client_scopes                 | 12
 role_composites               | 11
 roles                         | 10
 audit_events                  |  5
 client_oidc_config            |  3
 clients                       |  3
 authentication_sessions       |  1
 authorization_codes           |  1
 flows                         |  1
 sessions                      |  1
 signing_keys                  |  1
 subjects                      |  1
 token_grants                  |  1
 user_credentials              |  1
 users                         |  1
 action_tokens                 |  0
 backchannel_logout_deliveries |  0
 client_assertion_jti          |  0
 client_metadata_cache         |  0
 client_origins                |  0
 client_registration_tokens    |  0
 client_scope_mappers          |  0
 client_scope_roles            |  0
 consent_scopes                |  0
 consents                      |  0
 console_logins                |  0
 console_sessions              |  0
 email_outbox                  |  0
 group_roles                   |  0
 groups                        |  0
 idempotency_keys              |  0
 login_failures                |  0
 message_overrides             |  0
 pending_email_changes         |  0
 pending_registrations         |  0
 refresh_tokens                |  0
 subject_groups                |  0
 subject_roles                 |  0
 subject_terms_acceptances     |  0
 tenant_domains                |  0
 tenant_issuer_retirements     |  0
 tenant_smtp                   |  0
 theme_assets                  |  0
 theme_version_assets          |  0
 theme_versions                |  0
 user_required_actions         |  0
(47 rows)

{"type":"about:blank","title":"Error","status":400,"detail":"querystring must have required property 'confirm'","errors":[{"path":"confirm","message":"must have required property 'confirm'"}],"instance":"01a140bf-be87-77d4-877c-d365c631feba"}
{"type":"about:blank","title":"Bad Request","status":400,"detail":"confirm: must be the tenant’s own name, doomed","errors":[{"path":"confirm","message":"must be the tenant’s own name, doomed"}],"instance":"01a140bf-be92-7f53-9a9e-c3b3c55d3640"}
{"type":"about:blank","title":"Conflict","status":409,"detail":"the system tenant is where every cross-tenant administrator authenticates, and is never deleted","instance":"01a140bf-beab-7098-8d9e-d4fe29242035"}
{"type":"about:blank#tenant-enabled","title":"Conflict","status":409,"detail":"doomed is enabled: disable it first, which ends its sessions and tells their relying parties","instance":"01a140bf-bec2-7b3e-9c95-9051417c88ff"}
{"id":"01a140bf-2b2b-7e8f-a63a-c6c8b0f964d9","name":"doomed","display_name":null,"enabled":false,"created_at":"2026-10-15T18:07:12.683Z"}
{"action": "session.end_all", "actor_name": null, "detail": {"via": "tenant_disabled", "ended": 1, "remaining": 0}}
.well-known/openid-configuration         200
protocol/openid-connect/certs            200
protocol/openid-connect/token            404
['01a140bf-2b76-7cb8-a9e8-842a01ba082c']
INSERT 0 1
{"type":"about:blank#sessions-live","title":"Conflict","status":409,"detail":"sessions still live: 1; disable doomed again to end them and tell their relying parties","instance":"01a140bf-bfaf-719a-942f-8ee3a32b79f2"}
200
{"type":"about:blank#logout-deliveries-pending","title":"Conflict","status":409,"detail":"Back-Channel Logout Tokens still to be sent: 1; deleting the tenant would discard them","instance":"01a140bf-bfea-7fca-98f3-077111bac882"}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
{"ran":true,"delivered":0,"failed":1}
HTTP/1.1 204 No Content
x-request-id: 01a140c3-83f3-7be8-87b8-8f16b0b7f002
cache-control: no-store
Date: Thu, 15 Oct 2026 18:11:57 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Unauthorized","status":401,"instance":"01a140c3-8418-758b-9e00-e7deb1aa2f25"}
.well-known/openid-configuration         404
protocol/openid-connect/certs            404
          table_name           | n
-------------------------------+---
 action_tokens                 | 0
 audit_events                  | 0
 authentication_sessions       | 0
 authorization_codes           | 0
 backchannel_logout_deliveries | 0
 client_assertion_jti          | 0
 client_metadata_cache         | 0
 client_oidc_config            | 0
 client_origins                | 0
 client_registration_tokens    | 0
 client_scope_assignments      | 0
 client_scope_mappers          | 0
 client_scope_roles            | 0
 client_scopes                 | 0
 clients                       | 0
 consent_scopes                | 0
 consents                      | 0
 console_logins                | 0
 console_sessions              | 0
 email_outbox                  | 0
 flows                         | 0
 group_roles                   | 0
 groups                        | 0
 idempotency_keys              | 0
 login_failures                | 0
 message_overrides             | 0
 pending_email_changes         | 0
 pending_registrations         | 0
 refresh_tokens                | 0
 role_composites               | 0
 roles                         | 0
 sessions                      | 0
 signing_keys                  | 0
 subject_groups                | 0
 subject_roles                 | 0
 subject_terms_acceptances     | 0
 subjects                      | 0
 tenant_domains                | 0
 tenant_issuer_retirements     | 0
 tenant_smtp                   | 0
 theme_assets                  | 0
 theme_version_assets          | 0
 theme_versions                | 0
 token_grants                  | 0
 user_credentials              | 0
 user_required_actions         | 0
 users                         | 0
(47 rows)

{"action": "tenant.delete", "outcome": "allowed", "actor_name": "ada", "resource_id": "01a140bf-2b2b-7e8f-a63a-c6c8b0f964d9", "detail": {"name": "doomed"}}
{"action": "tenant.delete", "outcome": "refused", "actor_name": "ada", "resource_id": "0199aa00-0000-7000-8000-000000000001", "detail": {"name": "system", "reason": "system_tenant_guarded"}}
```

The read of `doomed` afterwards answers `401` rather than `404`: the router
resolves the tenant a path names before anything else, and an unknown one is
unauthenticated there, as it is for every route.
