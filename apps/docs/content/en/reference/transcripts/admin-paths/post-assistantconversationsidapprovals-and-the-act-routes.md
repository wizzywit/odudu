---
title: 'Assistant changes: approvals, resume and mode'
description: 'How the console assistant proposes a change in Act mode, how its owner approves or refuses it, how the conversation carries on, and how Ask and Act are switched.'
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

The model here is the same kind of stand-in as on the [conversations page](./post-assistantconversations-and-the-conversation-routes.md):
a small script behind `ODUDU_ASSISTANT_MODELS=standard=openai-compatible:demo-model` that reads the role a message names and then
proposes changing its description to the quoted text, and says what the tool returned. What the server wrote, the cards, the
decisions, the grants and the audit rows included, is real; the sentences are the script's. The page was driven once, in the
order below, by the administrator `ada` of the `system` tenant, who signed in as in [Getting the token](./getting-the-token.md). `ADMIN_TOKEN` is her token and the role `auditors` was made for the page.

```bash
API=http://localhost:3115/admin/tenants/system
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"auditors","description":"Old text"}' $API/roles
ROLE_ID=01a2165a-3934-7734-8735-999817309513
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"mode":"act","page_context":{"route":"/roles","objectType":"role","objectId":"'$ROLE_ID'"}}' \
  $API/assistant/conversations
ID=01a2165a-3965-75d9-89fd-5f3361452922
```

```
{"id":"01a2165a-3934-7734-8735-999817309513","name":"auditors","description":"Old text","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-26T05:35:41.362Z","admin_reach":[]}
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
x-request-id: 01a2165a-3992-7ea8-8a51-bf5691eb8a4e
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Thu, 26 Nov 2026 05:35:41 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a2165a-39cc-722c-bbdf-efcb7de2e074"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795671341562","toolName":"get_role"}

data: {"type":"tool-input-delta","toolCallId":"call_1795671341562","inputTextDelta":"{\"id\":\"01a2165a-3934-7734-8735-999817309513\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795671341562","toolName":"get_role","input":{"id":"01a2165a-3934-7734-8735-999817309513"}}

data: {"type":"tool-output-available","toolCallId":"call_1795671341562","output":"<tool-data>{\"data\":{\"id\":\"01a2165a-3934-7734-8735-999817309513\",\"name\":\"auditors\",\"description\":\"Old text\",\"client_id\":null,\"client_key\":null,\"default_for_new_subjects\":false,\"created_at\":\"2026-11-26T05:35:41.362Z\",\"admin_reach\":[]},\"etag\":\"\\\"365aebb82c34954fb61b783a318915f35abb9ea13b490fd47a441fede59044d7\\\"\"}</tool-data>"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795671341662","toolName":"update_role_description"}

data: {"type":"tool-input-delta","toolCallId":"call_1795671341662","inputTextDelta":"{\"id\":\"01a2165a-3934-7734-8735-999817309513\",\"if_match\":\"\\\"365aebb82c34954fb61b783a318915f35abb9ea13b490fd47a441fede59044d7\\\"\",\"description\":\"Reviews the audit trail\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795671341662","toolName":"update_role_description","input":{"id":"01a2165a-3934-7734-8735-999817309513","if_match":"\"365aebb82c34954fb61b783a318915f35abb9ea13b490fd47a441fede59044d7\"","description":"Reviews the audit trail"}}

data: {"type":"data-approval_card","data":{"approval_id":"01a2165a-3a7d-7327-b962-4163d72fe8de","tool_call_id":"call_1795671341662","tool":"update_role_description","title":"Change the description of a role","target":{"type":"role","id":"01a2165a-3934-7734-8735-999817309513","name":"auditors"},"before":{"description":"Old text"},"after":{"description":"Reviews the audit trail"},"expires_at":"2026-11-26T05:45:41.690Z"},"transient":true}

data: {"type":"tool-approval-request","approvalId":"aitxt-dKzIwGW0Og05aRtTuJnBQLlx","toolCallId":"call_1795671341662"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"tool-calls"}

data: {"type":"data-turn_end","data":{"stopReason":"awaiting_approval"},"transient":true}

data: [DONE]
```

The card, as the console lists it, and the role, which has not changed:

```bash
curl -sS -D - -H "Authorization: Bearer $ADMIN_TOKEN" $API/assistant/conversations/$ID/approvals
APPROVAL=01a2165a-3a7d-7327-b962-4163d72fe8de
curl -sS -H "Authorization: Bearer $ADMIN_TOKEN" $API/roles/$ROLE_ID
```

```
HTTP/1.1 200 OK
x-request-id: 01a2165a-3a99-7153-9b51-c651e48bf609
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 391
Date: Thu, 26 Nov 2026 05:35:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"items":[{"approval_id":"01a2165a-3a7d-7327-b962-4163d72fe8de","tool_call_id":"call_1795671341662","tool":"update_role_description","title":"Change the description of a role","target":{"type":"role","id":"01a2165a-3934-7734-8735-999817309513","name":"auditors"},"before":{"description":"Old text"},"after":{"description":"Reviews the audit trail"},"expires_at":"2026-11-26T05:45:41.690Z"}]}
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
x-request-id: 01a2165a-3ae6-77a0-bc91-3dbcd276428a
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 154
Date: Thu, 26 Nov 2026 05:35:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"a change still waits for your decision","instance":"01a2165a-3ae6-77a0-bc91-3dbcd276428a"}
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
x-request-id: 01a2165a-3b06-702b-854c-b6d417780d12
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 20
Date: Thu, 26 Nov 2026 05:35:41 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"state":"approved"}
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
x-request-id: 01a2165a-3bb3-7713-9d79-aefd7a59b6f2
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 162
Date: Thu, 26 Nov 2026 05:35:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"this change was already decided or has expired","instance":"01a2165a-3bb3-7713-9d79-aefd7a59b6f2"}

HTTP/1.1 409 Conflict
x-request-id: 01a2165a-3bc8-7fe0-af2e-2f844182145c
cache-control: no-store
content-type: application/problem+json; charset=utf-8
content-length: 155
Date: Thu, 26 Nov 2026 05:35:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"type":"about:blank","title":"Conflict","status":409,"detail":"no decision is waiting to be carried on","instance":"01a2165a-3bc8-7fe0-af2e-2f844182145c"}
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
{"items":[{"id":"01a2165a-3b15-74da-9471-6a980d706f47","occurred_at":"2026-11-26T05:35:41.840Z","event_type":"admin_mutation","action":"assistant.approval","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a2165a-3569-77ef-b7d9-ade0aca0f811","actor_client_id":null,"actor_name":"ada","actor_origin":"tenant","resource_type":"assistant_conversation","resource_id":"01a2165a-3965-75d9-89fd-5f3361452922","request_id":null,"ip":null,"detail":{"via":"console","tool":"update_role_description","state":"approved","tenant":"0199aa00-0000-7000-8000-000000000001","subject":"01a2165a-3569-77ef-b7d9-ade0aca0f811","approval":"01a2165a-3a7d-7327-b962-4163d72fe8de","conversation":"01a2165a-3965-75d9-89fd-5f3361452922"}}]}
{"items":[{"id":"01a2165a-3b74-7550-960a-0718e728af22","occurred_at":"2026-11-26T05:35:41.940Z","event_type":"admin_access","action":"agent.tool_call","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a2165a-3569-77ef-b7d9-ade0aca0f811","actor_client_id":"01a2165a-3529-7cca-9835-7ba5b07da7f3","actor_name":"ada","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":null,"ip":null,"detail":{"tool":"update_role_description","owner":"01a2165a-3569-77ef-b7d9-ade0aca0f811","route":"PATCH /admin/tenants/:tenant/roles/:id","agent_client":"01a2165a-3529-7cca-9835-7ba5b07da7f3"}},{"id":"01a2165a-3a79-7d9c-b50f-ed92762a8fe5","occurred_at":"2026-11-26T05:35:41.689Z","event_type":"admin_access","action":"agent.tool_call","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a2165a-3569-77ef-b7d9-ade0aca0f811","actor_client_id":"01a2165a-3529-7cca-9835-7ba5b07da7f3","actor_name":"ada","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":null,"ip":null,"detail":{"tool":"get_role","owner":"01a2165a-3569-77ef-b7d9-ade0aca0f811","route":"GET /admin/tenants/:tenant/roles/:id","agent_client":"01a2165a-3529-7cca-9835-7ba5b07da7f3"}},{"id":"01a2165a-3a40-7e0c-808d-171d16e3667e","occurred_at":"2026-11-26T05:35:41.632Z","event_type":"admin_access","action":"agent.tool_call","outcome":"allowed","actor_tenant_id":"0199aa00-0000-7000-8000-000000000001","actor_subject_id":"01a2165a-3569-77ef-b7d9-ade0aca0f811","actor_client_id":"01a2165a-3529-7cca-9835-7ba5b07da7f3","actor_name":"ada","actor_origin":"tenant","resource_type":null,"resource_id":null,"request_id":null,"ip":null,"detail":{"tool":"get_role","owner":"01a2165a-3569-77ef-b7d9-ade0aca0f811","route":"GET /admin/tenants/:tenant/roles/:id","agent_client":"01a2165a-3529-7cca-9835-7ba5b07da7f3"}}]}
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
x-request-id: 01a2165a-3cee-7641-af9f-693aca8ae5f5
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Thu, 26 Nov 2026 05:35:42 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a2165a-3d06-7b71-8508-b085738781f4"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795671342362","toolName":"get_role"}

data: {"type":"tool-input-delta","toolCallId":"call_1795671342362","inputTextDelta":"{\"id\":\"01a2165a-3934-7734-8735-999817309513\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795671342362","toolName":"get_role","input":{"id":"01a2165a-3934-7734-8735-999817309513"}}

data: {"type":"tool-output-available","toolCallId":"call_1795671342362","output":"<tool-data>{\"data\":{\"id\":\"01a2165a-3934-7734-8735-999817309513\",\"name\":\"auditors\",\"description\":\"Reviews the audit trail\",\"client_id\":null,\"client_key\":null,\"default_for_new_subjects\":false,\"created_at\":\"2026-11-26T05:35:41.362Z\",\"admin_reach\":[]},\"etag\":\"\\\"df27a849250e0bc882dae0e23516de2a19db976ac22e5e9a510e220ff8968ba6\\\"\"}</tool-data>"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"tool-input-start","toolCallId":"call_1795671342415","toolName":"update_role_description"}

data: {"type":"tool-input-delta","toolCallId":"call_1795671342415","inputTextDelta":"{\"id\":\"01a2165a-3934-7734-8735-999817309513\",\"if_match\":\"\\\"df27a849250e0bc882dae0e23516de2a19db976ac22e5e9a510e220ff8968ba6\\\"\",\"description\":\"Reviews the audit trail\"}"}

data: {"type":"tool-input-available","toolCallId":"call_1795671342415","toolName":"update_role_description","input":{"id":"01a2165a-3934-7734-8735-999817309513","if_match":"\"df27a849250e0bc882dae0e23516de2a19db976ac22e5e9a510e220ff8968ba6\"","description":"Reviews the audit trail"}}

data: {"type":"tool-approval-request","approvalId":"aitxt-7XyLXpt2qIliJjJ4PIRiUovF","toolCallId":"call_1795671342415","isAutomatic":true}

data: {"type":"tool-approval-response","approvalId":"aitxt-7XyLXpt2qIliJjJ4PIRiUovF","approved":false,"reason":"This conversation is in Ask mode, so nothing was changed. If the person wants this done, tell them to switch the conversation to Act mode and ask again."}

data: {"type":"tool-output-denied","toolCallId":"call_1795671342415"}

data: {"type":"finish-step"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt-0"}

data: {"type":"text-delta","id":"txt-0","delta":"I cannot change it in Ask mode: switch t"}

data: {"type":"text-delta","id":"txt-0","delta":"o Act mode and ask again."}

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
x-request-id: 01a2165a-3d75-7174-962d-51f77b3aeff4
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 14
Date: Thu, 26 Nov 2026 05:35:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"mode":"act"}

HTTP/1.1 200 OK
x-request-id: 01a2165a-3e24-74a9-bbcc-88d10c91e247
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 18
Date: Thu, 26 Nov 2026 05:35:42 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"state":"denied"}

HTTP/1.1 200 OK
x-request-id: 01a2165a-3e3d-7013-837b-188f73dc0bbc
cache-control: no-store
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
x-vercel-ai-ui-message-stream: v1
Date: Thu, 26 Nov 2026 05:35:42 GMT
Transfer-Encoding: chunked

data: {"type":"start","messageId":"01a2165a-3cd9-77d2-83aa-63730f2e2c30-5"}

data: {"type":"start-step"}

data: {"type":"text-start","id":"txt-0"}

data: {"type":"text-delta","id":"txt-0","delta":"The change was not made, and the role is"}

data: {"type":"text-delta","id":"txt-0","delta":" as it was."}

data: {"type":"text-end","id":"txt-0"}

data: {"type":"finish-step"}

data: {"type":"finish","finishReason":"stop"}

data: {"type":"data-turn_end","data":{"stopReason":"done"},"transient":true}

data: [DONE]

{"id":"01a2165a-3934-7734-8735-999817309513","name":"auditors","description":"Reviews the audit trail","client_id":null,"client_key":null,"default_for_new_subjects":false,"created_at":"2026-11-26T05:35:41.362Z","admin_reach":[]}
```

Not shown here, because no sign-in on this stack can produce the token: the assistant's own token, or another administrator's,
calling the decision route. An integration test runs both: the door answers `403` to the assistant's token and the route answers `404` to another administrator.
