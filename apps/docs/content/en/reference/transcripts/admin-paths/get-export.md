---
title: 'GET /export'
description: 'GET /admin/tenants/{tenant}/export requires manage-tenant and manage-clients — the second because the document carries every client, which every…'
---

# `GET /export`

`GET /admin/tenants/{tenant}/export` requires `manage-tenant` and
`manage-clients` — the second because the document carries every client,
which every other route reads with `manage-clients` — and answers
the tenant's configuration as one document of media type
`application/vnd.odudu.tenant+json`, carrying `"version": 1`: its settings,
its authentication flow, its clients, its roles and their composites, its
groups and their roles, its scopes with their role mappings, claim mapper
bindings and client assignments, its registration policy, and its SMTP
host, port, sender, username and STARTTLS. Every reference inside it is by
name — a role as its name and the `client_id` it belongs to, `null` for a
tenant role; a group by its path; a scope by its name; a client by its
`client_id` — and no row id, tenant id or timestamp appears anywhere, so
the document means the same thing in whichever tenant it is imported into.
`registration_allowed`, `verify_email` and `client_registration_policy`
travel under `registration_policy`; every other tenant setting is under
`settings`.

`settings.supported_locales`, `settings.default_locale` and `message_overrides`
(a tenant's own wording, at most 500, each `locale`, `key` and `message`) travel
with it.

The tenant's theme is not in it either: neither the published theme, nor a client's, nor the uploaded images, and `omitted` does not name them, since they are not secrets. An import therefore creates a tenant with Odudu's look (P7 plans to carry them).

No secret is in it: no client secret, SMTP password, password hash, TOTP seed,
passkey, recovery code or private signing key, and no session, consent, grant,
registration token or audit row. Each secret a reader would expect is named
under `omitted` by its JSON path instead — `clients[<i>].secret` for each
confidential client, `smtp.password` when one is set and
`subjects[<i>].credentials` for each exported subject that has any — so the gap
is visible in the file rather than silent. A client's `jwks` is exported with
any private member (`d`, `p`, `q`, `dp`, `dq`, `qi`, `k`) removed from each key,
and each key that lost one is named under `omitted` as
`clients[<i>].jwks.keys[<j>]`. Registration and `POST`/`PATCH /clients` refuse
such a key ([the request
paths](../request-paths/bootstrap.md#dynamic-client-registration) shows the
refusal), so only a row stored before that check can hold one; none in this
tenant does, so no stripped key appears below.

What a new tenant provisions for itself is marked rather than left out:
each role on the built-in `odudu-admin` client and each default scope
(`openid` and the rest) carries `"builtin": true`, so an import can merge
onto its own copies. The `odudu-admin` client itself is not among
`clients`, and no scope lists an assignment to it: an import provisions
its own. A role on it is still referenced as
`{"name": …, "client": "odudu-admin"}`, because a tenant role may carry the
same name as a capability, and a reference that dropped the client would
not tell the two apart.

`?include=subjects` adds `subjects` — each user with a sign-in, its profile
claims and verification flags, its direct roles, its groups by path and its
required actions — and additionally requires `view-users` (which `manage-users`
also reaches), refused with `403` otherwise. Above 10,000 such subjects it is
refused with `413` and `"type": "about:blank#export-too-large"`, naming inbound
provisioning, which the [roadmap](../../../roadmap.md#later) plans as the tool for moving users in bulk; nothing here
holds that many, so that refusal is not shown — an integration test covers it.
Any other `include` is refused with `400`. Every export writes a `tenant.export`
row into the tenant's trail whose `detail` says whether subjects were included.

Everything below ran in one session on a freshly built stack with `odudu seed admin
--username ada` run against it and `$ADMIN_TOKEN` got as in [Getting the
token](./getting-the-token.md). The tenant is `export-demo`, made first with a
confidential client `billing-app`, a tenant role `billing-reader`, a group
`finance` mapping it with a subject `grace` in it, an SMTP relay whose password is
`relay-password-shown-nowhere`, and a subject `tenant-operator` holding
`manage-tenant` alone. `$OPERATOR_TOKEN` is `tenant-operator`'s token, got the same
way as `$ADMIN_TOKEN` but through the tenant's own `odudu-admin` client.
`RUN_START=$(date -u +%FT%T.000Z)` is set first, so every trail read below is scoped
to `from=$RUN_START`:

```bash
A="Authorization: Bearer $ADMIN_TOKEN"; J='Content-Type: application/json'
T=http://localhost:3000/admin/tenants/export-demo
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"export-demo"}' http://localhost:3000/admin/tenants -o /dev/null
curl -sS -X POST -H "$A" -H "$J" \
  -d '{"client_id":"billing-app","grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic"}' $T/clients -o /dev/null
ROLE=$(curl -sS -X POST -H "$A" -H "$J" -d '{"name":"billing-reader"}' $T/roles | jq -r .id)
GROUP=$(curl -sS -X POST -H "$A" -H "$J" -d '{"name":"finance"}' $T/groups | jq -r .id)
curl -sS -X PUT -H "$A" -H "$J" -d "{\"role_ids\":[\"$ROLE\"]}" $T/groups/$GROUP/roles -o /dev/null
GRACE=$(curl -sS -X POST -H "$A" -H "$J" -d '{"username":"grace","email":"grace@example.com"}' $T/subjects | jq -r .id)
curl -sS -X PUT -H "$A" -H "$J" -d "{\"group_ids\":[\"$GROUP\"]}" $T/subjects/$GRACE/groups -o /dev/null
curl -sS -X PUT -H "$A" -H "$J" \
  -d '{"host":"smtp.example.test","port":587,"starttls":true,"from_address":"noreply@export.example","password":"relay-password-shown-nowhere"}' $T/smtp -o /dev/null
OPERATOR=$(curl -sS -X POST -H "$A" -H "$J" -d '{"username":"tenant-operator"}' $T/subjects | jq -r .id)
OPPW=$(curl -sS -X POST -H "$A" $T/subjects/$OPERATOR/password | jq -r .password)
MANAGE_TENANT=$(curl -sS -H "$A" "$T/roles?name=manage-tenant" | jq -r '.items[] | select(.name == "manage-tenant") | .id')
ETAG=$(curl -sS -D - -o /dev/null -H "$A" $T/subjects/$OPERATOR/roles | tr -d '\r' | sed -n 's/^etag: //p')
curl -sS -X PUT -H "$A" -H "$J" -H "If-Match: $ETAG" -d "{\"role_ids\":[\"$MANAGE_TENANT\"]}" $T/subjects/$OPERATOR/roles -o /dev/null
```

The export, without subjects. It has no message override and offers only the
default language, so `settings` carries `supported_locales` and `default_locale`,
and the document a top-level `message_overrides` list that is empty:

```bash
RUN_START=$(date -u +%FT%T.000Z)
curl -sS -D - \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export
```

```
HTTP/1.1 200 OK
x-request-id: 01a18735-7e1a-7e5e-ab5c-4362071ef72c
cache-control: no-store
content-type: application/vnd.odudu.tenant+json; charset=utf-8
content-length: 7034
Date: Thu, 29 Oct 2026 10:29:52 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"version":1,"settings":{"display_name":null,"enabled":true,"reset_password_allowed":false,"sso_session_idle_seconds":1800,"sso_session_max_seconds":36000,"password_min_length":15,"password_require_digit":false,"password_require_uppercase":false,"password_require_lowercase":false,"password_require_special":false,"password_not_username":true,"password_not_email":true,"password_history_depth":0,"password_max_age_days":0,"otp_required":false,"brute_force_max_failures":5,"brute_force_lockout_seconds":60,"brute_force_max_lockout_seconds":900,"brute_force_failure_reset_seconds":43200,"max_clients":200,"max_sessions_per_browser":25,"remember_me_allowed":false,"remember_me_idle_seconds":604800,"remember_me_max_seconds":2592000,"audit_retention_days":90,"username_editable":false,"access_token_ttl_seconds":300,"id_token_ttl_seconds":300,"refresh_token_ttl_seconds":1209600,"authorization_code_ttl_seconds":60,"login_ttl_seconds":1800,"verify_email_ttl_seconds":43200,"reset_password_ttl_seconds":300,"login_with_email":false,"audit_event_types":["admin_mutation","admin_access","authentication","session","token","credential"],"supported_locales":["en"],"default_locale":null},"flow":[{"authenticator":"passkey","requirement":"alternative"},{"authenticator":"password","requirement":"alternative"},{"authenticator":"otp","requirement":"conditional"},{"authenticator":"recovery-code","requirement":"conditional"}],"clients":[{"client_id":"billing-app","name":"billing-app","description":null,"name_i18n":{},"description_i18n":{},"type":"confidential","enabled":true,"full_scope_allowed":false,"skip_logout_confirmation":false,"registration_origin":"operator","redirect_uris":[],"grant_types":["client_credentials"],"token_endpoint_auth_method":"client_secret_basic","audiences":[],"access_token_ttl_seconds":null,"id_token_ttl_seconds":null,"refresh_token_ttl_seconds":null,"client_credentials_scopes":[],"web_origins":[],"post_logout_redirect_uris":[],"jwks":null,"jwks_uri":null,"frontchannel_logout_uri":null,"backchannel_logout_uri":null,"frontchannel_logout_session_required":false,"backchannel_logout_session_required":false,"consent_required":false,"token_exchange_impersonation_allowed":false,"userinfo_signed_response_alg":null,"userinfo_encrypted_response_alg":null,"userinfo_encrypted_response_enc":null,"tls_client_auth_subject_dn":null,"client_uri":null,"policy_uri":null,"tos_uri":null,"id_token_signed_response_alg":null,"default_max_age":null,"require_auth_time":false,"service_account_roles":[]}],"roles":[{"name":"billing-reader","client":null,"description":null,"default_for_new_subjects":false,"builtin":false,"composites":[]},{"name":"manage-clients","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-keys","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-sessions","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-tenant","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"manage-users","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[{"name":"view-users","client":"odudu-admin"}]},{"name":"tenant-admin","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[{"name":"manage-clients","client":"odudu-admin"},{"name":"manage-keys","client":"odudu-admin"},{"name":"manage-sessions","client":"odudu-admin"},{"name":"manage-tenant","client":"odudu-admin"},{"name":"manage-users","client":"odudu-admin"},{"name":"view-audit","client":"odudu-admin"},{"name":"view-users","client":"odudu-admin"}]},{"name":"view-audit","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]},{"name":"view-users","client":"odudu-admin","description":null,"default_for_new_subjects":false,"builtin":true,"composites":[]}],"groups":[{"path":"/finance","description":null,"default_for_new_subjects":false,"roles":[]}],"scopes":[{"name":"address","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"email","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"groups","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"offline_access","description":null,"include_in_id_token":false,"include_in_access_token":false,"default_client_assignment":"optional","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"optional"}]},{"name":"openid","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"phone","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"profile","description":null,"include_in_id_token":true,"include_in_access_token":false,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]},{"name":"roles","description":null,"include_in_id_token":false,"include_in_access_token":true,"default_client_assignment":"default","consent_text":null,"description_i18n":{},"consent_text_i18n":{},"display_order":0,"builtin":true,"roles":[],"mappers":[],"clients":[{"client_id":"billing-app","assignment":"default"}]}],"registration_policy":{"registration_allowed":false,"verify_email":false,"client_registration_policy":"disabled"},"smtp":{"host":"smtp.example.test","port":587,"from_address":"noreply@export.example","username":null,"starttls":true},"message_overrides":[],"omitted":["clients[0].secret","smtp.password"]}
```

The SMTP password appears nowhere in it, nor in the export with subjects:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export | grep -c relay-password-shown-nowhere
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=subjects" | grep -c relay-password-shown-nowhere
```

```
0
0
```

`tenant-operator` holds `manage-tenant` alone, and is refused `manage-clients` for
either form of the export — `?include=subjects` and the export without it both
answer `403`:

```bash
curl -sS -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/whoami
echo
curl -sS -H "Authorization: Bearer $OPERATOR_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=subjects"
echo
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export
```

```
{"subjectId":"01a18735-79a2-7c97-9a5b-e62ddf183332","issuerTenantId":"01a18735-7805-7502-bb92-7bae89b3aa57","capabilities":["manage-tenant"],"crossTenant":false}
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a18735-802d-71cb-91e7-a9edd743165a"}
403 application/problem+json; charset=utf-8
```

An `include` other than `subjects` is refused by the generated schema, naming
the parameter:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=sessions"
echo
```

```
{"type":"about:blank","title":"Error","status":400,"detail":"querystring/include must be equal to constant","errors":[{"path":"include","message":"must be equal to constant"}],"instance":"01a18735-80ed-7e3b-884d-9be5e22b2a03"}
```

The trail, scoped to this run: the exports (`$ADMIN_TOKEN`'s, allowed) and then the
two refusals (`tenant-operator`'s, naming `manage-clients` both times). Each row
answers `actor_name` and `actor_origin`:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/audit?action=tenant.export&from=$RUN_START"; echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/audit?action=capability.refused&from=$RUN_START"; echo
```

```
{"items":[{"id":"01a18735-7faf-7b7d-a94d-b757079064e9","occurred_at":"2026-10-29T10:29:52.584Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a18735-7805-7502-bb92-7bae89b3aa57","request_id":"01a18735-7f0a-7479-baa2-332ba54cae9e","ip":"172.20.0.1","detail":{"include_subjects":true}},{"id":"01a18735-7ef2-78ef-b29f-3733a0b067d5","occurred_at":"2026-10-29T10:29:52.481Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a18735-7805-7502-bb92-7bae89b3aa57","request_id":"01a18735-7ec7-73a2-aa24-d47294a817b2","ip":"172.20.0.1","detail":{"include_subjects":false}},{"id":"01a18735-7eb0-7ca9-a481-a0f9afa4c37f","occurred_at":"2026-10-29T10:29:52.357Z","event_type":"admin_mutation","action":"tenant.export","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a18727-6b60-76f6-9299-36e7692328a0","actor_client_id":"01a18727-6b13-713f-8865-d215040c7828","actor_name":null,"actor_origin":"system","resource_type":"tenant","resource_id":"01a18735-7805-7502-bb92-7bae89b3aa57","request_id":"01a18735-7e1a-7e5e-ab5c-4362071ef72c","ip":"172.20.0.1","detail":{"include_subjects":false}}]}
{"items":[{"id":"01a18735-80d1-705f-a804-d8eb3f96a8f4","occurred_at":"2026-10-29T10:29:52.976Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a18735-7805-7502-bb92-7bae89b3aa57","actor_subject_id":"01a18735-79a2-7c97-9a5b-e62ddf183332","actor_client_id":"01a18735-781c-752c-96fa-5be64d7b6b7d","actor_name":"tenant-operator","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"01a18735-8096-78aa-93d5-e4af88d5dfff","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"manage-clients"}},{"id":"01a18735-807c-7123-b908-445d5dcbdc19","occurred_at":"2026-10-29T10:29:52.890Z","event_type":"admin_access","action":"capability.refused","outcome":"refused","actor_tenant_id":"01a18735-7805-7502-bb92-7bae89b3aa57","actor_subject_id":"01a18735-79a2-7c97-9a5b-e62ddf183332","actor_client_id":"01a18735-781c-752c-96fa-5be64d7b6b7d","actor_name":"tenant-operator","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":"01a18735-802d-71cb-91e7-a9edd743165a","ip":"172.20.0.1","detail":{"reason":"missing_capability","capability":"manage-clients"}}]}
```

The subjects and `omitted` of the export with subjects, selected with `jq` —
`grace` owes `update-password`, and `tenant-operator` does not, having signed in
and set a password; its password is named rather than carried:

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/export?include=subjects" \
  | jq -c '.subjects[], .omitted'
```

```
{"username":"grace","email":"grace@example.com","enabled":true,"profile":{"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null},"roles":[],"groups":[],"required_actions":["update-password"]}
{"username":"tenant-operator","email":null,"enabled":true,"profile":{"name":null,"given_name":null,"family_name":null,"middle_name":null,"nickname":null,"preferred_username":null,"profile":null,"picture":null,"website":null,"gender":null,"birthdate":null,"zoneinfo":null,"locale":null,"phone_number":null,"phone_number_verified":false,"email_verified":false,"address_formatted":null,"address_street":null,"address_locality":null,"address_region":null,"address_postal_code":null,"address_country":null},"roles":[{"name":"manage-tenant","client":"odudu-admin"}],"groups":[],"required_actions":[]}
["clients[0].secret","smtp.password","subjects[1].credentials"]
```

A caller holding `manage-tenant` without `manage-clients` is refused with `403`,
writing the same `capability.refused` row the router writes for a route's own
capability, naming `manage-clients`. Here `tenant-operator` again, with the row read
back as the system administrator:

```bash
RUN_START=$(date -u +%FT%T.000Z)
curl -sS -H "Authorization: Bearer $OPERATOR_TOKEN" \
  http://localhost:3000/admin/tenants/export-demo/export
echo
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/admin/tenants/export-demo/audit?action=capability.refused&from=$RUN_START" \
  | jq -c '.items[] | {action, outcome, actor_subject_id, detail}'
```

```
{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a18735-81d5-7c8c-8005-cb9c44203961"}
{"action":"capability.refused","outcome":"refused","actor_subject_id":"01a18735-79a2-7c97-9a5b-e62ddf183332","detail":{"reason":"missing_capability","capability":"manage-clients"}}
```

## A tenant too large for one document

The document is built in memory, so a tenant holding more than 20,000 clients,
roles or groups, or more than 200,000 rows of any one link table (composites,
group roles, scope role mappings, scope assignments, group memberships), is
refused rather than read. On a tenant `big-demo`, given 20,001 clients with
`insert into clients` and `insert into client_oidc_config` (no origins are
needed for the count):

```bash
curl -sS -X POST -H "$A" -H "$J" -d '{"name":"big-demo"}' http://localhost:3000/admin/tenants -o /dev/null
docker compose exec -T postgres psql -U odudu -d odudu -c "
insert into clients (id, tenant_id, client_id, name, type)
select gen_random_uuid(), t.id, 'c' || g, 'App ' || g, 'public'
  from tenants t cross join generate_series(1, 20001) g where t.name = 'big-demo';
insert into client_oidc_config (client_id, tenant_id, redirect_uris, grant_types, token_endpoint_auth_method, web_origins)
select id, tenant_id, '{https://app.example/cb}', '{authorization_code}', 'none', '{+}'
  from clients where tenant_id = (select id from tenants where name = 'big-demo') and client_id like 'c%';"
```

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" "http://localhost:3000/admin/tenants/big-demo/export"
```

```
HTTP/1.1 413 Payload Too Large
x-request-id: 01a18735-883a-7e4b-83a8-41514710bb07
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 218
Date: Thu, 29 Oct 2026 10:29:54 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#export-too-large","title":"Content Too Large","status":413,"detail":"the tenant holds more than 20000 clients, too many to export in one document","instance":"01a18735-883a-7e4b-83a8-41514710bb07"}
```
