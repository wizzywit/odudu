---
title: 'GET /assistant/settings and PUT /assistant/settings'
description: 'What a tenant chose for its console assistant, read and replaced on an ETag: mode, masking, retention, auditors and limits, with the audit row.'
---

# `GET /assistant/settings` and `PUT /assistant/settings`

This page covers `GET /assistant/settings` and `PUT /assistant/settings`.

A tenant's own choices for the console assistant: whether it is offered (`assistant_enabled`), the mode a person starts in
(`assistant_default_mode`, `ask` or `act`), whether email addresses are masked (`assistant_mask_emails`), how many days a trace is kept
(`assistant_trace_retention_days`, 1 to 365), whether auditors can read the text of conversations (`assistant_auditor_visible`, off by default), a month's tokens for
each model slot (`assistant_monthly_tokens_fast`, `_standard` and `_deep`, 0 to 1,000,000,000), how many answers may run at once
(`assistant_max_concurrent`, 1 to 50) and the steps of one answer (`assistant_max_steps_per_turn`, 1 to 100). A tenant that has chosen
nothing reads every default, and none of them holds a key: the model keys are read from the server's environment only.

**Not run again since the default changed.** `assistant_auditor_visible` now defaults to `false`: a holder of `read-assistant-activity`
always reads a conversation's metadata, and its text only while the setting is on. The blocks below were captured when the default was `true`, so
the first two settings bodies, and the `before` and `after` of the audit row that shows the setting changing, read the opposite of what a
tenant that has chosen nothing reads now. An integration test runs the new default and the audit row.

`GET` requires `manage-assistant`, or `read-assistant-activity`, which reads and cannot change. `PUT` requires `manage-assistant`. A
caller holding `use-assistant` alone is refused `403` by both, a request with no token `401`, and an AI agent's token is refused
whatever it holds, since an agent reads and edits nothing of the assistant that may be running it. Both answer an `ETag`, and a `PUT`
that sends an `If-Match` the settings have moved past is refused `412`. `PUT` replaces every setting, so a caller sends the whole
document: a value outside its range, a missing setting and an unknown one are each refused `400`. A change is audited as
`assistant.config`, in the same transaction, with each setting that changed as its value before and after; a `PUT` that changes nothing
writes no row. Where the server has no assistant configured both routes answer exactly as a path that was never served does. A system administrator holding `manage-tenants` and `manage-assistant` may read and change another tenant's settings; the conversation routes, which belong to the administrator who started them, are not served to such a caller. For a tenant that has turned the assistant off, starting a conversation or sending a message answers `404` too, and a conversation can still be read and stopped (these cases have no block below).

The first run is on one stack, port `3118`, from an empty volume, started with a second compose file that sets
`ODUDU_ASSISTANT_MODELS` to `standard=anthropic:claude-model-for-transcript` and `ANTHROPIC_API_KEY` to a placeholder no call uses. The
tenant and its four clients are made with the CLI, each with the capability its name says, and each client's token is got with
`client_credentials`:

```bash
docker compose exec -T odudu node dist/main.js seed tenant --name assist-demo
docker compose exec -T odudu node dist/main.js seed client --tenant assist-demo --client-id assist-manager --client-secret assist-manager-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability manage-assistant --capability use-assistant
docker compose exec -T odudu node dist/main.js seed client --tenant assist-demo --client-id assist-reader --client-secret assist-reader-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability read-assistant-activity
docker compose exec -T odudu node dist/main.js seed client --tenant assist-demo --client-id assist-user --client-secret assist-user-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability use-assistant
docker compose exec -T odudu node dist/main.js seed client --tenant assist-demo --client-id assist-auditor --client-secret assist-auditor-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability view-audit
```

```
{"command":"tenant","created":true,"tenant":"assist-demo","tenantId":"01a2153d-4f07-7712-bfe7-1e43412908f3"}
{"command":"client","created":true,"tenant":"assist-demo","tenantId":"01a2153d-4f07-7712-bfe7-1e43412908f3","clientId":"assist-manager","clientDbId":"01a2153d-5251-7115-be1e-f65aae33f038","capabilities":["manage-assistant","use-assistant"]}
{"command":"client","created":true,"tenant":"assist-demo","tenantId":"01a2153d-4f07-7712-bfe7-1e43412908f3","clientId":"assist-reader","clientDbId":"01a2153d-54bb-7337-82ca-d3d4a8506092","capabilities":["read-assistant-activity"]}
{"command":"client","created":true,"tenant":"assist-demo","tenantId":"01a2153d-4f07-7712-bfe7-1e43412908f3","clientId":"assist-user","clientDbId":"01a2153d-579a-7a64-9196-77468bdc693d","capabilities":["use-assistant"]}
{"command":"client","created":true,"tenant":"assist-demo","tenantId":"01a2153d-4f07-7712-bfe7-1e43412908f3","clientId":"assist-auditor","clientDbId":"01a2153d-5ac4-7837-af17-a0e3c17e85f1","capabilities":["view-audit"]}
```

## Reading the defaults

`MANAGER_TOKEN`, `READER_TOKEN` and `USER_TOKEN` are the `assist-manager`, `assist-reader` and `assist-user` clients' tokens. The
manager and the reader read the defaults, and the user, who holds `use-assistant` only, is refused:

```bash
API=http://localhost:3118/admin/tenants/assist-demo
curl -sS -D - -H "Authorization: Bearer $MANAGER_TOKEN" $API/assistant/settings
curl -sS -D - -H "Authorization: Bearer $READER_TOKEN" $API/assistant/settings
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" $API/assistant/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a2153d-5cc1-7e05-8ddb-1c31d8420bf1
cache-control: no-store
etag: "b92c69b69767e1a14820ef6f79ec0927450aeadfdcb58c767d0f78eb132c63e7"
content-type: application/json; charset=utf-8
content-length: 343
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"assistant_enabled":true,"assistant_default_mode":"ask","assistant_mask_emails":false,"assistant_trace_retention_days":30,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}
HTTP/1.1 200 OK
x-request-id: 01a2153d-5d01-7008-ba84-a19944d67027
cache-control: no-store
etag: "b92c69b69767e1a14820ef6f79ec0927450aeadfdcb58c767d0f78eb132c63e7"
content-type: application/json; charset=utf-8
content-length: 343
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"assistant_enabled":true,"assistant_default_mode":"ask","assistant_mask_emails":false,"assistant_trace_retention_days":30,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}
HTTP/1.1 403 Forbidden
x-request-id: 01a2153d-5d1b-7c77-87ac-e2cad78adf35
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 105
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a2153d-5d1b-7c77-87ac-e2cad78adf35"}
```

## Changing them

`ETAG` is the one the first read answered. The manager replaces the document with a mode of `act`, masking on and traces kept 90
days; the same request again, on the `ETag` the first read answered, is refused as stale; the reader may not change anything; a
retention of 366 days is outside the range; and the manager's own document sent unchanged is answered with the same `ETag` and
writes nothing:

```bash
BAD='{"assistant_enabled":true,"assistant_default_mode":"act","assistant_mask_emails":true,"assistant_trace_retention_days":366,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}'
NEW='{"assistant_enabled":true,"assistant_default_mode":"act","assistant_mask_emails":true,"assistant_trace_retention_days":90,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}'
curl -sS -D - -X PUT -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" -d "$NEW" $API/assistant/settings
curl -sS -D - -X PUT -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -H "If-Match: $ETAG" -d "$NEW" $API/assistant/settings
curl -sS -D - -X PUT -H "Authorization: Bearer $READER_TOKEN" -H "Content-Type: application/json" -d "$NEW" $API/assistant/settings
curl -sS -D - -X PUT -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -d "$BAD" $API/assistant/settings
curl -sS -D - -X PUT -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -d "$NEW" $API/assistant/settings
```

```
HTTP/1.1 200 OK
x-request-id: 01a2153d-5d35-7316-b7fe-35a804dc1d95
cache-control: no-store
etag: "63f6823a7f476026c3326c4ff793648b70e48499714f3330ddd36f2ab2129e8b"
content-type: application/json; charset=utf-8
content-length: 342
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"assistant_enabled":true,"assistant_default_mode":"act","assistant_mask_emails":true,"assistant_trace_retention_days":90,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}
HTTP/1.1 412 Precondition Failed
x-request-id: 01a2153d-5d55-7d07-823e-b467fc15dd3f
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 153
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Precondition Failed","status":412,"detail":"If-Match no longer matches","instance":"01a2153d-5d55-7d07-823e-b467fc15dd3f"}
HTTP/1.1 403 Forbidden
x-request-id: 01a2153d-5d6f-734d-9564-356bf095b00a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 105
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Forbidden","status":403,"instance":"01a2153d-5d6f-734d-9564-356bf095b00a"}
HTTP/1.1 400 Bad Request
x-request-id: 01a2153d-5d8f-7c4a-a676-8dbed79d68bd
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 243
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Error","status":400,"detail":"body/assistant_trace_retention_days must be <= 365","errors":[{"path":"assistant_trace_retention_days","message":"must be <= 365"}],"instance":"01a2153d-5d8f-7c4a-a676-8dbed79d68bd"}
HTTP/1.1 200 OK
x-request-id: 01a2153d-5da9-747d-9730-bd7bebd93d8d
cache-control: no-store
etag: "63f6823a7f476026c3326c4ff793648b70e48499714f3330ddd36f2ab2129e8b"
content-type: application/json; charset=utf-8
content-length: 342
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"assistant_enabled":true,"assistant_default_mode":"act","assistant_mask_emails":true,"assistant_trace_retention_days":90,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}
```

## What it does to the status

The status route reads the tenant's own row. With the mode set to `act` it offers `act` as the default. Then the manager turns the
assistant off for this tenant, and the status of this tenant reads `{"enabled":false}` while the deployment is unchanged:

```bash
OFF=${NEW/\"assistant_enabled\":true/\"assistant_enabled\":false}
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" $API/assistant/status
curl -sS -D - -X PUT -H "Authorization: Bearer $MANAGER_TOKEN" -H "Content-Type: application/json" -d "$OFF" $API/assistant/settings
curl -sS -D - -H "Authorization: Bearer $USER_TOKEN" $API/assistant/status
```

```
HTTP/1.1 200 OK
x-request-id: 01a2153d-5dc2-7f59-9919-e37fed581dda
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 262
Date: Thu, 26 Nov 2026 00:24:32 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"enabled":true,"slots":{"fast":"claude-model-for-transcript","standard":"claude-model-for-transcript","deep":"claude-model-for-transcript"},"modes":["ask","act"],"defaultMode":"act","modelChoices":["claude-model-for-transcript"],"provider":{"kind":"anthropic"}}
HTTP/1.1 200 OK
x-request-id: 01a2153d-5ddc-7987-9d60-37539eeeefac
cache-control: no-store
etag: "9046cdfad41f8a5ecfc85acfab5a7fb7e33be1ab7a6ce3374fd9b30b9e4a97d2"
content-type: application/json; charset=utf-8
content-length: 343
Date: Thu, 26 Nov 2026 00:24:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"assistant_enabled":false,"assistant_default_mode":"act","assistant_mask_emails":true,"assistant_trace_retention_days":90,"assistant_auditor_visible":true,"assistant_monthly_tokens_fast":2000000,"assistant_monthly_tokens_standard":5000000,"assistant_monthly_tokens_deep":1000000,"assistant_max_concurrent":5,"assistant_max_steps_per_turn":20}
HTTP/1.1 200 OK
x-request-id: 01a2153d-5e12-7d89-9431-13da7e561146
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 17
Date: Thu, 26 Nov 2026 00:24:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"enabled":false}
```

## The audit trail

`AUDITOR_TOKEN` is the `assist-auditor` client's token. The two changes above, and nothing for the refused, stale and unchanged
saves, are in the trail, newest first, each with what changed as its value before and after:

```bash
curl -sS -D - -H "Authorization: Bearer $AUDITOR_TOKEN" "$API/audit?action=assistant.config"
```

```
HTTP/1.1 200 OK
x-request-id: 01a2153d-5e32-7782-a5a5-1d588000521b
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 1329
Date: Thu, 26 Nov 2026 00:24:33 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"id":"01a2153d-5df1-7ada-bbc8-f0d0f651a605","occurred_at":"2026-11-26T00:24:33.006Z","event_type":"admin_mutation","action":"assistant.config","outcome":"allowed","actor_tenant_id":"01a2153d-4f07-7712-bfe7-1e43412908f3","actor_subject_id":"01a2153d-5273-750c-957a-ab4e5f21875c","actor_client_id":"01a2153d-5251-7115-be1e-f65aae33f038","actor_name":null,"actor_origin":"tenant","resource_type":"assistant_settings","resource_id":"01a2153d-4f07-7712-bfe7-1e43412908f3","request_id":"01a2153d-5ddc-7987-9d60-37539eeeefac","ip":"172.20.0.1","detail":{"assistant_enabled":{"after":false,"before":true}}},{"id":"01a2153d-5d48-7f61-8e6d-44672ebcdb9c","occurred_at":"2026-11-26T00:24:32.836Z","event_type":"admin_mutation","action":"assistant.config","outcome":"allowed","actor_tenant_id":"01a2153d-4f07-7712-bfe7-1e43412908f3","actor_subject_id":"01a2153d-5273-750c-957a-ab4e5f21875c","actor_client_id":"01a2153d-5251-7115-be1e-f65aae33f038","actor_name":null,"actor_origin":"tenant","resource_type":"assistant_settings","resource_id":"01a2153d-4f07-7712-bfe7-1e43412908f3","request_id":"01a2153d-5d35-7316-b7fe-35a804dc1d95","ip":"172.20.0.1","detail":{"assistant_mask_emails":{"after":true,"before":false},"assistant_default_mode":{"after":"act","before":"ask"},"assistant_trace_retention_days":{"after":90,"before":30}}}]}
```

## With no model configured

The stack started again over the same volume with the first compose file alone, which sets none of the assistant's variables. The
settings answer the `404` a path that was never served answers, with the same body, and the status says the assistant is off:

```bash
curl -sS -D - -H "Authorization: Bearer $MANAGER_TOKEN" $API/assistant/settings
curl -sS -D - -H "Authorization: Bearer $MANAGER_TOKEN" $API/assistant/conversations
curl -sS -D - -H "Authorization: Bearer $MANAGER_TOKEN" $API/assistant/status
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a2153d-7c4b-7c5a-bc0d-568d35e2488c
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Thu, 26 Nov 2026 00:24:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a2153d-7c4b-7c5a-bc0d-568d35e2488c"}
HTTP/1.1 404 Not Found
x-request-id: 01a2153d-7c65-7ac3-8ca6-548ecc41c080
content-type: application/problem+json; charset=utf-8
content-length: 151
Date: Thu, 26 Nov 2026 00:24:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank#not-found","title":"Not Found","status":404,"detail":"No resource at this path","instance":"01a2153d-7c65-7ac3-8ca6-548ecc41c080"}
HTTP/1.1 200 OK
x-request-id: 01a2153d-7c6f-7d11-8b97-25c86a2f6ca7
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 17
Date: Thu, 26 Nov 2026 00:24:40 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"enabled":false}
```
