---
title: 'Assistant changes: approvals, resume and mode'
description: 'How the console assistant proposes a change in Act mode, how its owner approves or refuses it, and how a chat moves between Ask and Act mode.'
---

# Assistant changes: approvals, resume and mode

This page covers `GET /assistant/conversations/{id}/approvals`, `POST /assistant/conversations/{id}/approvals/{approvalId}`, `POST /assistant/conversations/{id}/resume` and `PUT /assistant/conversations/{id}/mode`.

All four need `use-assistant`, answer
`404` unless a model is configured, and are the conversation's owner's alone. An AI agent's token is refused all four, and so is
another administrator's: an approval can be decided only by the person it was asked of, from their own console sign-in.

In `act` mode the assistant may propose one of twelve changes. A proposal is not a write: the server reads the target, stores an
approval for the administrator with a card (`before` is what it read, `after` is what the call would set, both written by the
server and never by the model) and the stream ends on `tool-approval-request`, with the card beside it as `data-approval_card` and
`stopReason` `awaiting_approval`. Approving lets that one call run, once, exactly as the card shows it. `POST .../resume` then
carries the conversation on: the approved change is made under a grant of its own that holds `mcp:write` alone and ends when the
call returns, and the assistant answers from its result. A refusal, an expired approval, another message or a stop closes the
change without running it. In `ask` mode a change is refused with a reason the model reads and nothing is stored.

A card also carries `tier` (`A`, `B` or `C`), `confirm_with` (the text a tier `C` decision must carry, otherwise `null`) and, for a
change that replaces a list, `diff` (the names it adds and removes), and the decision body takes an optional `confirm`. A tier `C`
approval is refused `400` and left pending unless `confirm` equals `confirm_with` exactly. The cards in the blocks below are tier `A`:
every change of this page is, except the removal of a message override, which is tier `B`. No change of tier `C` exists yet, so no
block here shows the `400`; the integration tests run it.

The model here is the same kind of stand-in as on the [conversations page](./post-assistantconversations-and-the-conversation-routes.md):
a small script behind `ODUDU_ASSISTANT_MODELS=standard=openai-compatible:demo-model` that reads the role a message names and then
proposes changing its description to the quoted text, and says what the tool returned. What the server wrote, the cards, the
decisions, the grants and the audit rows included, is real; the sentences are the script's. The page was driven once, in the
order below, by the administrator `ada` of the `system` tenant, who signed in as in [Getting the token](./getting-the-token.md). `ADMIN_TOKEN` is her token and the role `auditors` was made for the page.

```bash
API=http://localhost:3115/admin/tenants/system
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"auditors","description":"Old text"}' $API/roles
ROLE_ID=01a21f39-bae4-7246-873f-ac980d7f466c
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"act","page_context":{"route":"/roles","objectType":"role","objectId":"'$ROLE_ID'"}}' \
  $API/assistant/conversations
ID=01a21f39-bb0c-7f75-8b8c-1b3f6367137a
```

```
{"id":"01a21f39-bae4-7246-873f-ac980d7f466c","name":"auditors","description":"Old text","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-27T22:56:46.815Z","admin_reach":[]}
HTTP/1.1 201 Created
x-request-id: 01a21f39-baf6-7f00-b9fa-9663006b0104
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 191
Date: Fri, 27 Nov 2026 22:56:46 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a","profile":"free-chat","mode":"act","title":null,"created_at":"2026-11-27T22:56:46.860Z","last_active_at":"2026-11-27T22:56:46.860Z","messages":[]}
```

```
HTTP/1.1 201 Created
x-request-id: 01a2165a-3959-7be3-ac83-803197941a57
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 191
Date: Thu, 26 Nov 2026 05:35:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"id":"01a2165a-3965-75d9-89fd-5f3361452922","profile":"free-chat","mode":"act","title":null,"created_at":"2026-11-26T05:35:41.413Z","last_active_at":"2026-11-26T05:35:41.413Z","messages":[]}
```

## Propose

The message names the role and the text. The assistant reads the role (its `etag` comes back with it), then asks for
`update_role_description`. That call does not run: the stream carries the card and ends on the request.

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"message":{"id":"m1","role":"user","parts":[{"type":"text","text":"Change the description of the role '$ROLE_ID' to '"'"'Reviews the audit trail'"'"'"}]}}' \
  $API/assistant/conversations/$ID/messages
```

```
HTTP/1.1 200 OK
x-request-id: 01a21f39-bb2e-741d-9a90-cc2ef5c0b46d
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Fri, 27 Nov 2026 22:56:46 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a21f39-bb78-7a24-ad4a-7b60f495c5e4"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795820207010","toolName":"get_role"}

data: {"type":"tool-input-delta","toolCallId":"call_1795820207010","inputTextDelta":"{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795820207010","toolName":"get_role","input":{"id":"01a21f39-bae4-7246-873f-ac980d7f466c"}}

data: {"type":"tool-output-available","toolCallId":"call_1795820207010","output":"<tool-data>{\"data\":{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\",\"name\":\"auditors\",\"description\":\"Old text\",\"client_id\":null,\"client_key\":null,\"default_for_new_subjects\":false,\"created_at\":\"2026-11-27T22:56:46.815Z\",\"admin_reach\":[]},\"etag\":\"\\\"0fd509c4ad94605efeabb18136c730223cccea0d372063eade5dc0a7233e1ea9\\\"\"}</tool-data>"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795820207137","toolName":"update_role_description"}

data: {"type":"tool-input-delta","toolCallId":"call_1795820207137","inputTextDelta":"{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\",\"if_match\":\"\\\"0fd509c4ad94605efeabb18136c730223cccea0d372063eade5dc0a7233e1ea9\\\"\",\"description\":\"Reviews the audit trail\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795820207137","toolName":"update_role_description","input":{"id":"01a21f39-bae4-7246-873f-ac980d7f466c","if_match":"\"0fd509c4ad94605efeabb18136c730223cccea0d372063eade5dc0a7233e1ea9\"","description":"Reviews the audit trail"}}

data: {"type":"data-approval_card","data":{"approval_id":"01a21f39-bc5b-7123-be61-b5d98238c157","tool_call_id":"call_1795820207137","tool":"update_role_description","title":"Change the description of a role","tier":"A","confirm_with":null,"target":{"type":"role","id":"01a21f39-bae4-7246-873f-ac980d7f466c","name":"auditors"},"before":{"description":"Old text"},"after":{"description":"Reviews the audit trail"},"expires_at":"2026-11-27T23:06:47.189Z"},"transient":true}

data: {"type":"tool-approval-request","approvalId":"aitxt-t69aWO6z60q5NDppX9yFYK9w","toolCallId":"call_1795820207137","signature":"lnS_qxVZtvMqXCtgNCfgnHnYZL0-8SpZTpE5CuldA2Y"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"tool-calls"}

data: {"type":"data-turn_end","data":{"stopReason":"awaiting_approval"},"transient":true}

data: [DONE]
```

The card, as the console lists it, and the role, which has not changed:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $API/assistant/conversations/$ID/approvals
APPROVAL=01a21f39-bc5b-7123-be61-b5d98238c157
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $API/roles/$ROLE_ID
```

```
HTTP/1.1 200 OK
x-request-id: 01a21f39-bc7c-7563-821e-f295c5f38681
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 422
Date: Fri, 27 Nov 2026 22:56:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"approval_id":"01a21f39-bc5b-7123-be61-b5d98238c157","tool_call_id":"call_1795820207137","tool":"update_role_description","title":"Change the description of a role","tier":"A","confirm_with":null,"target":{"type":"role","id":"01a21f39-bae4-7246-873f-ac980d7f466c","name":"auditors"},"before":{"description":"Old text"},"after":{"description":"Reviews the audit trail"},"expires_at":"2026-11-27T23:06:47.189Z"}]}
{"id":"01a21f39-bae4-7246-873f-ac980d7f466c","name":"auditors","description":"Old text","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-27T22:56:46.815Z","admin_reach":[]}
```

```
{"id":"01a2165a-3934-7734-8735-999817309513","name":"auditors","description":"Old text","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-26T05:35:41.362Z","admin_reach":[]}
```

## Resume while a change waits

```bash
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $API/assistant/conversations/$ID/resume
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a21f39-bcbd-784a-ac40-cf92707ed8ec
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Fri, 27 Nov 2026 22:56:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"a change still waits for your decision","instance":"01a21f39-bcbd-784a-ac40-cf92707ed8ec"}
```

## Approve, then resume

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"approve":true}' $API/assistant/conversations/$ID/approvals/$APPROVAL
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $API/assistant/conversations/$ID/resume
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $API/roles/$ROLE_ID
```

```
HTTP/1.1 200 OK
x-request-id: 01a21f39-bcfc-7450-bf5b-b63bb83f46db
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 20
Date: Fri, 27 Nov 2026 22:56:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"state":"approved"}
HTTP/1.1 200 OK
x-request-id: 01a21f39-bd25-7224-bf8d-da6cea6eb6a4
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Fri, 27 Nov 2026 22:56:47 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a-3"}

data: {"type":"tool-output-available","toolCallId":"call_1795820207137","output":"<tool-data>{\"data\":{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\",\"name\":\"auditors\",\"description\":\"Reviews the audit trail\",\"client_id\":null,\"client_key\":null,\"default_for_new_subjects\":false,\"created_at\":\"2026-11-27T22:56:46.815Z\",\"admin_reach\":[]},\"etag\":\"\\\"c8f6ace47afe17a3f3020016abac1e6bee1e130cc9d0b50683f69e7a21596cc6\\\"\"}</tool-data>"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt-0"}

data: {"type":"text-delta","id":"txt-0","delta":"Done. The role now has the new description."}

data: {"type":"text-end","id":"txt-0"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"stop"}

data: {"type":"data-turn_end","data":{"stopReason":"done"},"transient":true}

data: [DONE]
{"id":"01a21f39-bae4-7246-873f-ac980d7f466c","name":"auditors","description":"Reviews the audit trail","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-27T22:56:46.815Z","admin_reach":[]}
```

```
HTTP/1.1 200 OK
x-request-id: 01a2165a-3b21-7e02-9562-6614fd551564
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Thu, 26 Nov 2026 05:35:41 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a2165a-3965-75d9-89fd-5f3361452922-3"}

data: {"type":"tool-output-available","toolCallId":"call_1795671341662","output":"<tool-data>{\"data\":{\"id\":\"01a2165a-3934-7734-8735-999817309513\",\"name\":\"auditors\",\"description\":\"Reviews the audit trail\",\"client_id\":null,\"client_key\":null,\"default_for_new_subjects\":false,\"created_at\":\"2026-11-26T05:35:41.362Z\",\"admin_reach\":[]},\"etag\":\"\\\"df27a849250e0bc882dae0e23516de2a19db976ac22e5e9a510e220ff8968ba6\\\"\"}</tool-data>"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt-0"}

data: {"type":"text-delta","id":"txt-0","delta":"Done. The description of the role now re"}

data: {"type":"text-delta","id":"txt-0","delta":"ads: Reviews the audit trail"}

data: {"type":"text-end","id":"txt-0"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"stop"}

data: {"type":"data-turn_end","data":{"stopReason":"done"},"transient":true}

data: [DONE]
```

```
{"id":"01a2165a-3934-7734-8735-999817309513","name":"auditors","description":"Reviews the audit trail","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-26T05:35:41.362Z","admin_reach":[]}
```

The approval is spent. A second decision and a second resume find nothing to do:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"approve":false}' $API/assistant/conversations/$ID/approvals/$APPROVAL
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $API/assistant/conversations/$ID/resume
```

```
HTTP/1.1 409 Conflict
x-request-id: 01a21f39-be01-7309-b7bf-fd47cb54381b
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 162
Date: Fri, 27 Nov 2026 22:56:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"this change was already decided or has expired","instance":"01a21f39-be01-7309-b7bf-fd47cb54381b"}
HTTP/1.1 409 Conflict
x-request-id: 01a21f39-be27-739b-a070-e6620618fc63
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 155
Date: Fri, 27 Nov 2026 22:56:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"no decision is waiting to be carried on","instance":"01a21f39-be27-739b-a070-e6620618fc63"}
```

## What it left behind

The approval is `consumed` and was decided from the console. The conversation's own grant is still `mcp:read`; the write had a
grant of its own, named for the approval, holding `mcp:write`, derived from the console sign-in, and it is revoked. As the database
owner, in the same project:

```bash
docker compose exec -T postgres psql -U odudu -d odudu -c "select a.state, a.decided_via, a.kind, (a.expires_at > a.created_at) as has_expiry from agent_approvals a order by a.created_at"
docker compose exec -T postgres psql -U odudu -d odudu -c "select g.scope, g.revoked_at is not null as revoked, g.id = '$APPROVAL' as for_the_approval, g.exchanged_from_grant_id is not null as derived from token_grants g join clients c on c.id = g.client_id where c.client_id = 'odudu-assistant' order by g.created_at"
```

```
  state   | decided_via |      kind       | has_expiry
----------+-------------+-----------------+------------
 consumed | console     | assistant_write | t
(1 row)

   scope   | revoked | for_the_approval | derived
-----------+---------+------------------+---------
 mcp:read  | f       | f                | t
 mcp:write | t       | t                | t
(2 rows)
```

The audit trail names the decision (`assistant.approval`: who, the conversation, the approval, the tool and the state, and no text of
the change) and each tool call (`agent.tool_call`: the two reads, and the write, which reached `PATCH /admin/tenants/:tenant/roles/:id`):

```bash
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$API/audit?action=assistant.approval&limit=5"
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" "$API/audit?action=agent.tool_call&limit=10"
```

```
{"items":[{"id":"01a21f39-bd1a-71a5-a12c-fd1e1d75c3a6","occurred_at":"2026-11-27T22:56:47.376Z","event_type":"admin_mutation","action":"assistant.approval","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","actor_client_id":null,"actor_name":"ada","actor_origin":"tenant","resource_type":"assistant_conversation","resource_id":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a","request_id":null,"ip":null,"detail":{"via":"console","tool":"update_role_description","state":"approved","tenant":"0199aa00-0000-7000-8000-000000000001","subject":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","approval":"01a21f39-bc5b-7123-be61-b5d98238c157","conversation":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a"}}]}
{"items":[{"id":"01a21f39-bda4-730c-b8bd-9c1e4cb6914a","occurred_at":"2026-11-27T22:56:47.521Z","event_type":"admin_access","action":"agent.tool_call","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","actor_client_id":"01a21f39-b54c-7701-99bc-63f335a57e1a","actor_name":"ada","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":null,"ip":null,"detail":{"tool":"update_role_description","turn":"01a21f39-bd3d-75a4-a69a-2a677d12d87c","owner":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","route":"PATCH /admin/tenants/:tenant/roles/:id","agent_client":"01a21f39-b54c-7701-99bc-63f335a57e1a","conversation":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a"}},{"id":"01a21f39-bc53-7a06-bd14-8244b80899e4","occurred_at":"2026-11-27T22:56:47.184Z","event_type":"admin_access","action":"agent.tool_call","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","actor_client_id":"01a21f39-b54c-7701-99bc-63f335a57e1a","actor_name":"ada","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":null,"ip":null,"detail":{"tool":"get_role","turn":"01a21f39-bb47-72b9-96d2-4432bebb8047","owner":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","route":"GET /admin/tenants/:tenant/roles/:id","agent_client":"01a21f39-b54c-7701-99bc-63f335a57e1a","conversation":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a"}},{"id":"01a21f39-bbf9-74c4-8a93-3d85f4babe90","occurred_at":"2026-11-27T22:56:47.094Z","event_type":"admin_access","action":"agent.tool_call","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","actor_client_id":"01a21f39-b54c-7701-99bc-63f335a57e1a","actor_name":"ada","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":null,"ip":null,"detail":{"tool":"get_role","turn":"01a21f39-bb47-72b9-96d2-4432bebb8047","owner":"01a21f39-b5c2-7d77-952e-45b0a858ae1f","route":"GET /admin/tenants/:tenant/roles/:id","agent_client":"01a21f39-b54c-7701-99bc-63f335a57e1a","conversation":"01a21f39-bb0c-7f75-8b8c-1b3f6367137a"}}]}
```

## Ask mode, and a refusal

A new conversation starts in `ask` mode. The same message makes the assistant ask for the change and the server refuse it, with a
reason the model reads; nothing is stored. After `PUT .../mode` the same request is proposed, the administrator refuses it, and the
resumed conversation ends without a write.

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "$MSG" $API/assistant/conversations/$CONV2/messages
```

```
HTTP/1.1 200 OK
x-request-id: 01a21f39-bf3b-747d-9947-7a1368b6cb15
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Fri, 27 Nov 2026 22:56:47 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a21f39-bf78-76de-bd33-25eb656b2533"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795820208017","toolName":"get_role"}

data: {"type":"tool-input-delta","toolCallId":"call_1795820208017","inputTextDelta":"{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795820208017","toolName":"get_role","input":{"id":"01a21f39-bae4-7246-873f-ac980d7f466c"}}

data: {"type":"tool-output-available","toolCallId":"call_1795820208017","output":"<tool-data>{\"data\":{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\",\"name\":\"auditors\",\"description\":\"Reviews the audit trail\",\"client_id\":null,\"client_key\":null,\"default_for_new_subjects\":false,\"created_at\":\"2026-11-27T22:56:46.815Z\",\"admin_reach\":[]},\"etag\":\"\\\"c8f6ace47afe17a3f3020016abac1e6bee1e130cc9d0b50683f69e7a21596cc6\\\"\"}</tool-data>"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795820208115","toolName":"update_role_description"}

data: {"type":"tool-input-delta","toolCallId":"call_1795820208115","inputTextDelta":"{\"id\":\"01a21f39-bae4-7246-873f-ac980d7f466c\",\"if_match\":\"\\\"c8f6ace47afe17a3f3020016abac1e6bee1e130cc9d0b50683f69e7a21596cc6\\\"\",\"description\":\"Reviews the audit trail\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795820208115","toolName":"update_role_description","input":{"id":"01a21f39-bae4-7246-873f-ac980d7f466c","if_match":"\"c8f6ace47afe17a3f3020016abac1e6bee1e130cc9d0b50683f69e7a21596cc6\"","description":"Reviews the audit trail"}}

data: {"type":"tool-approval-request","approvalId":"aitxt-acnCIkeU2R3123w3RFbBegaI","toolCallId":"call_1795820208115","isAutomatic":true}

data: {"type":"tool-approval-response","approvalId":"aitxt-acnCIkeU2R3123w3RFbBegaI","approved":false,"reason":"This conversation is in Ask mode, so nothing was changed. If the person wants this done, tell them to switch the conversation to Act mode and ask again."}

data: {"type":"tool-output-denied","toolCallId":"call_1795820208115"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt-0"}

data: {"type":"text-delta","id":"txt-0","delta":"Nothing was changed."}

data: {"type":"text-end","id":"txt-0"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"stop"}

data: {"type":"data-turn_end","data":{"stopReason":"done"},"transient":true}

data: [DONE]
```

```bash
curl -sS -D - -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"mode":"act"}' $API/assistant/conversations/$CONV2/mode
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d '{"approve":false}' $API/assistant/conversations/$CONV2/approvals/$APPROVAL2
curl -sS -D - -X POST -H "Authorization: Bearer $ADMIN_TOKEN" $API/assistant/conversations/$CONV2/resume
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $API/roles/$ROLE_ID
```

```
HTTP/1.1 200 OK
x-request-id: 01a21f39-c031-7c9c-ab46-ea3f286f0229
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 14
Date: Fri, 27 Nov 2026 22:56:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"mode":"act"}
HTTP/1.1 200 OK
x-request-id: 01a21f39-c160-7ba8-b1ea-2d36569690cd
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 18
Date: Fri, 27 Nov 2026 22:56:48 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"state":"denied"}
HTTP/1.1 200 OK
x-request-id: 01a21f39-c18a-74d0-84a4-04f7a55b8b66
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Fri, 27 Nov 2026 22:56:48 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a21f39-bf19-7439-ae78-3eb13deb5281-5"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt-0"}

data: {"type":"text-delta","id":"txt-0","delta":"Done. The role now has the new description."}

data: {"type":"text-end","id":"txt-0"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"stop"}

data: {"type":"data-turn_end","data":{"stopReason":"done"},"transient":true}

data: [DONE]
{"id":"01a21f39-bae4-7246-873f-ac980d7f466c","name":"auditors","description":"Reviews the audit trail","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-27T22:56:46.815Z","admin_reach":[]}
```

Not shown here, because no sign-in on this stack can produce the token: the assistant's own token, or another administrator's,
calling the decision route. An integration test runs both: the door answers `403` to the assistant's token and the route answers `404` to another administrator.
