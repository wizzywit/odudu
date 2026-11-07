---
title: 'The MCP write tools'
description: 'The MCP write tools: consent for mcp:write, an update under an etag, a role, group or scope under a key, sign-in wording, and what a refusal leaves.'
---

# The MCP write tools

An agent that holds `mcp:write` is offered twelve tools beyond the reads. Two change a client or a scope:
`update_client_metadata` changes a client's name, description and their per-language texts, and `update_scope_metadata`
changes a scope's description, its per-language texts and its display order. They send nothing else: not a redirect URI,
a grant, a secret, whether a client is enabled, a role or a scope's consent text, and a name that is not in the tool's
schema is refused before the admin API is asked. Two more, `update_role_description` and `update_group_description`, change
a description, and three, `create_role`, `create_group` and `create_scope`, make a role, a group or a scope that grants
nothing, under a key the agent chooses; [a section](#a-role-a-group-and-a-scope-that-grant-nothing) shows them. Three are the wording people read on the sign-in pages: `update_tenant_text_settings` changes the tenant's display name and languages, and `set_message_override` and `clear_message_override` set and remove the tenant's own text for one message; [a section](#the-wording-people-read) shows them. The last two, `update_theme_draft` and `update_client_theme_draft`, save a draft of how those pages look, which nothing shows until a person publishes it; [the section after the wording](#a-theme-draft-that-nothing-shows) shows them. Asking for `mcp:write` is itself put to the person at every sign-in. Each tool that changes something that exists takes the `etag` of a read as `if_match`, so a change made in the meantime is a `412` and not an
overwrite. The admin API decides what the token and its owner may do, as it does for a read; the
[endpoint's page](./the-mcp-endpoint.md) shows the sign-in, the headers and the budget this page does not repeat.

Every command was run, in this order, on a stack built for it and started from an empty volume (port `3000`, the
throttles at `10000`, the schedules off), driven only as far as this page goes: the tenant `demo` and its user `ada` made
as [Bootstrap](./bootstrap.md) makes them, `ada` given `view-users`, `manage-clients` and `manage-tenant`, one client made by an administrator, four sign-ins. The stack does not end TLS, so an
address is `http`. A token lives five minutes, so the calls after a sign-in ran within them; the ids, etags and times
are that run's.

## A client that may ask for `mcp:write`

A client that registered itself under the `mcp` policy, or came from a metadata document, is refused `mcp:write` however it was assigned,
so the client here is one an administrator made: public, with the tenant's MCP address as its audience and the two MCP scopes assigned to it
as optional. Creating it is an admin API call, which `ada` makes with a token for the administration client, got as
[Getting the token](../admin-paths/getting-the-token.md) shows. The `signin_code` function below is the sign-in of the
endpoint's page in one place: the authorization request, the sign-in form, and the consent page when it is shown (`SHOW=1`
prints it before the function allows it).

```bash
odudu() { docker compose -p odudu-p5a-i18 -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
odudu seed --tenant demo --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed grant-role --tenant demo --username ada --role odudu-admin:view-users
odudu seed grant-role --tenant demo --username ada --role odudu-admin:manage-clients
odudu seed grant-role --tenant demo --username ada --role odudu-admin:manage-tenant
```

```
{"created":true,"tenant":"demo","tenantId":"01a1b4cd-7bff-7cc2-bb77-0afc0461d80e","clientId":"demo-spa","userSubjectId":"01a1b4cd-7d29-72de-b262-330363e2b824"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b4cd-7bff-7cc2-bb77-0afc0461d80e","username":"ada","role":"odudu-admin:view-users"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b4cd-7bff-7cc2-bb77-0afc0461d80e","username":"ada","role":"odudu-admin:manage-clients"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b4cd-7bff-7cc2-bb77-0afc0461d80e","username":"ada","role":"odudu-admin:manage-tenant"}
```

```bash
BASE=http://localhost:3000
MCP=$BASE/tenants/demo/mcp
REDIR=http://127.0.0.1:8080/callback
signin_code() { # client_id scope [resource]
  local cid=$1 scope=$2 resource=${3:-}
  VERIFIER=$(openssl rand -hex 32)
  CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
  rm -f jar
  local extra=()
  [ -n "$resource" ] && extra=(--data-urlencode "resource=$resource")
  curl -sS -c jar -b jar -o authorize.html --get --data-urlencode response_type=code --data-urlencode "client_id=$cid" \
    --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=$scope" "${extra[@]}" --data-urlencode state=s \
    --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
    $BASE/tenants/demo/protocol/openid-connect/auth
  local as
  as=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
  curl -sS -c jar -b jar -D login.headers -o login.html --data-urlencode "auth_session_id=$as" \
    --data-urlencode username=ada --data-urlencode password=correct-horse-battery \
    $BASE/tenants/demo/login-actions/authenticate
  if grep -q 'login-actions/consent' login.html; then
    [ -n "${SHOW:-}" ] && sed -n '/<header/,/<\/form>/p' login.html
    as=$(grep -o 'name="auth_session_id" value="[^"]*"' login.html | head -1 | sed 's/.*value="//;s/"//')
    local scopes=()
    for s in $scope; do [ "$s" != openid ] && scopes+=(--data-urlencode "scope=$s"); done
    curl -sS -c jar -b jar -D login.headers -o /dev/null --data-urlencode "auth_session_id=$as" "${scopes[@]}" \
      --data-urlencode decision=allow $BASE/tenants/demo/login-actions/consent
  fi
  CODE=$(grep -i '^location:' login.headers | sed 's/.*code=//;s/&.*//' | tr -d '\r')
}

signin_code odudu-admin openid
ASSERTION=$(odudu console assertion --tenant demo)
curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=$REDIR \
  --data-urlencode client_id=odudu-admin --data-urlencode "code_verifier=$VERIFIER" \
  --data-urlencode client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer \
  --data-urlencode "client_assertion=$ASSERTION" $BASE/tenants/demo/protocol/openid-connect/token > admin.json
ADMIN=$(jq -r .access_token admin.json)
jq -c 'del(.access_token,.id_token,.refresh_token)' admin.json
```

```
{"token_type":"Bearer","expires_in":300,"scope":"openid"}
```

```bash
curl -sS -X POST -H "Authorization: Bearer $ADMIN" -H 'content-type: application/json' \
  -d '{"client_id":"agent-writer","name":"Transcript agent","redirect_uris":["'$REDIR'"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"audiences":["'$MCP'"]}' \
  $BASE/admin/tenants/demo/clients | jq -c '{client_id,name,type,audiences,consent_required}'
for s in mcp:read mcp:write; do odudu seed assign-scope --tenant demo --client-id agent-writer --scope $s --assignment optional; done
```

```
{"client_id":"agent-writer","name":"Transcript agent","type":"public","audiences":["http://localhost:3000/tenants/demo/mcp"],"consent_required":false}
{"command":"assign-scope","tenant":"demo","tenantId":"01a1b4cd-7bff-7cc2-bb77-0afc0461d80e","clientId":"agent-writer","scope":"mcp:read","assignment":"optional"}
{"command":"assign-scope","tenant":"demo","tenantId":"01a1b4cd-7bff-7cc2-bb77-0afc0461d80e","clientId":"agent-writer","scope":"mcp:write","assignment":"optional"}
```

## Two tokens, one of them able to write

The same client signs `ada` in for a read token and for a write token, both with the MCP address as the `resource`. The
client is not marked as needing consent, so the sign-in for `mcp:read` ends with a code and no screen. The sign-in for
`mcp:read mcp:write` does not: the consent page is shown whatever the client's setting is, with `mcp:write` as a box the
person ticks.

```bash
signin_code agent-writer "openid mcp:read" "$MCP"
curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=$REDIR \
  --data-urlencode client_id=agent-writer --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$MCP" \
  $BASE/tenants/demo/protocol/openid-connect/token > read.json
READ=$(jq -r .access_token read.json)
jq -c 'del(.access_token,.id_token)' read.json
echo "$READ" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq -c '{aud,scope,lifetime:(.exp-.iat)}'
```

```
{"token_type":"Bearer","expires_in":300,"scope":"openid mcp:read"}
{"aud":["http://localhost:3000/tenants/demo/mcp","http://localhost:3000/tenants/demo"],"scope":"openid mcp:read","lifetime":300}
```

```bash
SHOW=1 signin_code agent-writer "openid mcp:read mcp:write" "$MCP"
SHOW=
```

```
<header class="intro">
<h1><bdi>Transcript agent</bdi> is asking for access</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a1b4cd-8aad-7688-850e-cdfc98f901af">
  <ul>
  <li><bdi>openid</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="mcp:read"> <bdi>mcp:read</bdi> — lets the application read this tenant&#39;s settings and records on your behalf</label>
  <label><input type="checkbox" name="scope" value="mcp:write"> <bdi>mcp:write</bdi> — lets the application change this tenant&#39;s settings on your behalf</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
```

The function allowed both boxes. The write token lives as long as any access token of the tenant, five minutes here;
`mcp:write` is capped at ten, so a tenant that sets a longer life gets ten, and the answer carries no refresh token.

```bash
curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=$REDIR \
  --data-urlencode client_id=agent-writer --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$MCP" \
  $BASE/tenants/demo/protocol/openid-connect/token > write.json
WRITE=$(jq -r .access_token write.json)
jq -c 'del(.access_token,.id_token)' write.json
echo "$WRITE" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq -c '{aud,scope,lifetime:(.exp-.iat)}'
```

```
{"token_type":"Bearer","expires_in":300,"scope":"openid mcp:read mcp:write"}
{"aud":["http://localhost:3000/tenants/demo/mcp","http://localhost:3000/tenants/demo"],"scope":"openid mcp:read mcp:write","lifetime":300}
```

## Asked again, every time

An approval does not carry over. Signing in again for `mcp:write` shows the page again; `mcp:read`, approved before, is
ticked for the person and `mcp:write` is not. A request that may not show a screen (`prompt=none`) is refused with
`consent_required` and never issued the scope, though the person has a session and an earlier approval is on record.

```bash
SHOW=1 signin_code agent-writer "openid mcp:read mcp:write" "$MCP"
SHOW=
```

```
<header class="intro">
<h1><bdi>Transcript agent</bdi> is asking for access</h1>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a1b4cd-8bac-7a42-a8c0-a3f4a64ef3e6">
  <ul>
  <li><bdi>openid</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="mcp:read" checked> <bdi>mcp:read</bdi> — lets the application read this tenant&#39;s settings and records on your behalf</label>
  <label><input type="checkbox" name="scope" value="mcp:write"> <bdi>mcp:write</bdi> — lets the application change this tenant&#39;s settings on your behalf</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
```

```bash
curl -sS -c jar -b jar -D - -o /dev/null --get --data-urlencode response_type=code --data-urlencode client_id=agent-writer \
  --data-urlencode redirect_uri=$REDIR --data-urlencode "scope=openid mcp:write" --data-urlencode "resource=$MCP" \
  --data-urlencode prompt=none --data-urlencode state=s --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
  $BASE/tenants/demo/protocol/openid-connect/auth | grep -i '^location:'
```

```
location: http://127.0.0.1:8080/callback?error=consent_required&error_description=The+user+has+not+agreed+to+this+request+yet.&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
```

`rpc` posts one request with a token, in the 2025-11-25 form that needs no envelope, and `call` is a `tools/call` through it.

```bash
rpc() { local tok=$1; shift; curl -sS -X POST "$MCP" -H "Authorization: Bearer $tok" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-11-25' "$@" | sed -n 's/^data: //p'; }
call() { local tok=$1 id=$2 name=$3 args=$4; rpc "$tok" -d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"tools/call\",\"params\":{\"name\":\"$name\",\"arguments\":$args}}"; }
```

## What each token is offered

The read token's list holds no write tool. The write token's holds every one of them that `ada` can use: `manage-clients`
for the first and `manage-tenant` for the rest. `update_client_metadata` is hinted as not read-only, not destructive and idempotent
(overwriting is not destructive here: what is replaced is text, which the audit row keeps), with the schema that names its
two required arguments and the four fields it may send, and no others:

```bash
rpc "$READ" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq -c '[.result.tools[].name | select(test("^(update|create|set|clear)_"))]'
rpc "$WRITE" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq -c '[.result.tools[].name | select(test("^(update|create|set|clear)_"))]'
rpc "$WRITE" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '.result.tools[] | select(.name == "update_client_metadata") | {name, annotations, required: .inputSchema.required, fields: (.inputSchema.properties | keys)}'
```

```
[]
["clear_message_override","create_group","create_role","create_scope","set_message_override","update_client_metadata","update_client_theme_draft","update_group_description","update_role_description","update_scope_metadata","update_tenant_text_settings","update_theme_draft"]
{
  "name": "update_client_metadata",
  "annotations": {
    "readOnlyHint": false,
    "destructiveHint": false,
    "idempotentHint": true
  },
  "required": [
    "id",
    "if_match"
  ],
  "fields": [
    "description",
    "description_i18n",
    "id",
    "if_match",
    "name",
    "name_i18n"
  ]
}
```

## An update under the etag of a read

`get_client` returns the client under `data` and, beside it, the `etag` an update names as `if_match`. The ids of the clients
come from `list_clients`:

```bash
call "$WRITE" 2 list_clients '{"limit":10}' | jq -c '.result.structuredContent.data[] | {id, client_id, name}' | tee clients.txt
SPA=$(grep demo-spa clients.txt | jq -r .id)
ADMINCLIENT=$(grep odudu-admin clients.txt | jq -r .id)
call "$WRITE" 3 get_client "{\"id\":\"$SPA\"}" > get.json
jq -c '.result.structuredContent | {name: .data.name, description: .data.description, etag}' get.json
ETAG=$(jq -c '.result.structuredContent.etag' get.json)
```

```
{"id":"01a1b4cd-7c3f-78e2-8159-b775abd4e6c6","client_id":"odudu-mcp","name":"Odudu MCP"}
{"id":"01a1b4cd-7c68-7dfd-a7df-0a428f9b7666","client_id":"odudu-admin","name":"Odudu administration"}
{"id":"01a1b4cd-7cc0-78f7-86e8-78514e6a1d82","client_id":"demo-spa","name":"demo-spa"}
{"id":"01a1b4cd-8658-7d88-adf5-c172652033b9","client_id":"agent-writer","name":"Transcript agent"}
{"name":"demo-spa","description":null,"etag":"\"ce9c49ec301a150de4453a0bf9162f2e3f41a18b9295513309b1c9a94c23ed98\""}
```

The update answers the client as it is now and its new etag, which is not the one it was sent:

```bash
call "$WRITE" 4 update_client_metadata "{\"id\":\"$SPA\",\"if_match\":$ETAG,\"name\":\"Customer portal\",\"description\":\"Where customers pay their invoices\"}" > upd.json
jq -c '.result | {isError, name: .structuredContent.data.name, description: .structuredContent.data.description, etag: .structuredContent.etag}' upd.json
```

```
{"isError":false,"name":"Customer portal","description":"Where customers pay their invoices","etag":"\"c94fbd237e2b60e428f1d5d01fd5b6d7dc2c6f9d78c55926971f8573c6e8d7d4\""}
```

Sending the etag of the earlier read again is the case the etag is for: somebody changed the client since, and the
answer says to read it again rather than writing over them. The client is as the update left it.

```bash
call "$WRITE" 5 update_client_metadata "{\"id\":\"$SPA\",\"if_match\":$ETAG,\"description\":\"A second writer\"}" | jq '.result'
```

```
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":{\"type\":\"about:blank\",\"title\":\"Precondition Failed\",\"status\":412,\"detail\":\"The resource changed since it was read. Read it again with the matching get tool, then send the etag that read returned as if_match.\"}}"
    }
  ],
  "structuredContent": {
    "error": {
      "type": "about:blank",
      "title": "Precondition Failed",
      "status": 412,
      "detail": "The resource changed since it was read. Read it again with the matching get tool, then send the etag that read returned as if_match."
    }
  },
  "isError": true
}
```

## What the schema refuses

A field the tool does not name is refused before the admin API is asked, in words the model can act on, and so is a call
with no `if_match`:

```bash
call "$WRITE" 6 update_client_metadata "{\"id\":\"$SPA\",\"if_match\":$ETAG,\"enabled\":false,\"redirect_uris\":[\"https://evil.example/cb\"]}" | jq '.result.structuredContent'
call "$WRITE" 7 update_client_metadata "{\"id\":\"$SPA\",\"name\":\"no etag\"}" | jq '.result.structuredContent'
```

```
{
  "error": {
    "type": "mcp:invalid_arguments",
    "title": "The arguments are not valid",
    "status": 400,
    "detail": "arguments: Unrecognized keys: \"enabled\", \"redirect_uris\"; arguments: name at least one of name, description, name_i18n, description_i18n"
  }
}
{
  "error": {
    "type": "mcp:invalid_arguments",
    "title": "The arguments are not valid",
    "status": 400,
    "detail": "if_match: Invalid input: expected string, received undefined"
  }
}
```

## What the admin API refuses

The built-in administration client's name is what an administrator recognises on the consent screen, so the admin API
refuses an agent that would rename it, whatever the tool was willing to send. The refusal is the admin API's own `403`; the
tool says what such a refusal can mean without saying more than the admin API did, and the client is read back as it was:

```bash
call "$WRITE" 8 get_client "{\"id\":\"$ADMINCLIENT\"}" > getadmin.json
AETAG=$(jq -c '.result.structuredContent.etag' getadmin.json)
call "$WRITE" 9 update_client_metadata "{\"id\":\"$ADMINCLIENT\",\"if_match\":$AETAG,\"name\":\"Not the console\"}" | jq '.result'
call "$WRITE" 10 get_client "{\"id\":\"$ADMINCLIENT\"}" | jq -c '.result.structuredContent.data.name'
```

```
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":{\"type\":\"about:blank\",\"title\":\"Forbidden\",\"status\":403,\"detail\":\"insufficient_scope: a token holding mcp:write may change only the descriptive fields of a client or a scope, never the name of a built-in client; check the target and the fields.\"}}"
    }
  ],
  "structuredContent": {
    "error": {
      "type": "about:blank",
      "title": "Forbidden",
      "status": 403,
      "detail": "insufficient_scope: a token holding mcp:write may change only the descriptive fields of a client or a scope, never the name of a built-in client; check the target and the fields."
    }
  },
  "isError": true
}
"Odudu administration"
```

A token that holds only `mcp:read` is not offered the tool, and a call to it by name is refused before the admin API is
reached:

```bash
call "$READ" 11 update_client_metadata "{\"id\":\"$SPA\",\"if_match\":$ETAG,\"description\":\"from a read token\"}" | jq '.result'
```

```
{
  "content": [
    {
      "type": "text",
      "text": "{\"error\":{\"type\":\"mcp:insufficient_scope\",\"title\":\"The access token does not carry the scope this call needs\",\"status\":403}}"
    }
  ],
  "structuredContent": {
    "error": {
      "type": "mcp:insufficient_scope",
      "title": "The access token does not carry the scope this call needs",
      "status": 403
    }
  },
  "isError": true
}
```

## A scope

The scope tool is the same shape: the scope's description and its texts in other languages, under the etag of `get_scope`.
Its audit row, `scope.amend`, carries the description before and after, as the client's does.

```bash
call "$WRITE" 12 list_scopes '{"limit":50}' | jq -c '.result.structuredContent.data[] | select(.name=="profile") | {id, name, description}' | tee scope.txt
SCOPE=$(jq -r .id scope.txt)
call "$WRITE" 13 get_scope "{\"id\":\"$SCOPE\"}" > getscope.json
jq -c '.result.structuredContent | {name: .data.name, description: .data.description, etag}' getscope.json
call "$WRITE" 14 update_scope_metadata "{\"id\":\"$SCOPE\",\"if_match\":$(jq -c .result.structuredContent.etag getscope.json),\"description\":\"Your name, picture and birthday\"}" | jq -c '.result | {isError, description: .structuredContent.data.description, etag: .structuredContent.etag}'
```

```
{"id":"01a1b4cd-7c21-71c6-aea1-1b3d51b2577c","name":"profile","description":null}
{"name":"profile","description":null,"etag":"\"e7ee0e39e3d40a8653cb38b5a895f41a6380f34fb50c2befc5d7108025388457\""}
{"isError":false,"description":"Your name, picture and birthday","etag":"\"773325b7d9c600c27ab939200c55758c66e7c0907911d3a11f05223693e51865\""}
```

## A role, a group and a scope that grant nothing

A create takes the fields it names and a key of the agent's own, `idempotency_key`, which it sends again if it tries again, so
one role is made however often the call is sent: the key is never made from the request, which differs on every try. A new
role is held by nobody, is a default for no one and has nothing nested in it:

```bash
call "$WRITE" 15 create_role '{"idempotency_key":"transcript-role-1","name":"auditors","description":"Reads the audit trail"}' > role.json
jq -c '.result | {isError, name: .structuredContent.data.name, description: .structuredContent.data.description, default_for_new_subjects: .structuredContent.data.default_for_new_subjects, admin_reach: .structuredContent.data.admin_reach}' role.json
ROLE=$(jq -r '.result.structuredContent.data.id' role.json)
```

```
{"isError":false,"name":"auditors","description":"Reads the audit trail","default_for_new_subjects":false,"admin_reach":[]}
```

The same key again, as a client that did not see the answer would send it, is answered with the first response and makes no
second role:

```bash
call "$WRITE" 16 create_role '{"idempotency_key":"transcript-role-1","name":"auditors","description":"Reads the audit trail"}' | jq -c ".result.structuredContent.data.id == \"$ROLE\""
```

```
true
```

What decides who holds what is in no schema. A role made a default for every new subject, and a group made a child of another,
are refused before the admin API is asked:

```bash
call "$WRITE" 17 create_role '{"idempotency_key":"transcript-role-2","name":"everyone","default_for_new_subjects":true}' | jq '.result.structuredContent'
call "$WRITE" 18 create_group "{\"idempotency_key\":\"transcript-group-0\",\"name\":\"under-admin\",\"parent_id\":\"$ADMINCLIENT\"}" | jq '.result.structuredContent'
```

```
{
  "error": {
    "type": "mcp:invalid_arguments",
    "title": "The arguments are not valid",
    "status": 400,
    "detail": "arguments: Unrecognized key: \"default_for_new_subjects\""
  }
}
{
  "error": {
    "type": "mcp:invalid_arguments",
    "title": "The arguments are not valid",
    "status": 400,
    "detail": "arguments: Unrecognized key: \"parent_id\""
  }
}
```

A group and a scope are made the same way, and a scope's display order is the one new field the scope tools take:

```bash
call "$WRITE" 19 create_group '{"idempotency_key":"transcript-group-1","name":"staff","description":"Employees"}' | jq -c '.result | {isError, name: .structuredContent.data.name, path: .structuredContent.data.path, parent_id: .structuredContent.data.parent_id, default_for_new_subjects: .structuredContent.data.default_for_new_subjects}'
call "$WRITE" 20 create_scope '{"idempotency_key":"transcript-scope-1","name":"orders:read","description":"Read the orders of the person","display_order":7}' | jq -c '.result | {isError, name: .structuredContent.data.name, display_order: .structuredContent.data.display_order, consent_text: .structuredContent.data.consent_text, default_client_assignment: .structuredContent.data.default_client_assignment}'
```

```
{"isError":false,"name":"staff","path":"/staff","parent_id":null,"default_for_new_subjects":false}
{"isError":false,"name":"orders:read","display_order":7,"consent_text":null,"default_client_assignment":null}
```

A description is amended under the etag of the read, as a client's is:

```bash
call "$WRITE" 21 get_role "{\"id\":\"$ROLE\"}" > getrole.json
call "$WRITE" 22 update_role_description "{\"id\":\"$ROLE\",\"if_match\":$(jq -c .result.structuredContent.etag getrole.json),\"description\":\"Reads the audit trail and nothing else\"}" | jq -c '.result | {isError, description: .structuredContent.data.description}'
```

```
{"isError":false,"description":"Reads the audit trail and nothing else"}
```

A token that holds only `mcp:read` is not offered a create, and one called by name is refused for its scope. A name that is already in use is the
admin API's `409`, said as it was:

```bash
call "$READ" 23 create_role '{"idempotency_key":"transcript-role-3","name":"readers"}' | jq -c '.result.structuredContent.error | {type, status}'
call "$WRITE" 24 create_role '{"idempotency_key":"transcript-role-4","name":"auditors"}' | jq -c '.result.structuredContent.error | {title, status, detail}'
```

```
{"type":"mcp:insufficient_scope","status":403}
{"title":"Conflict","status":409,"detail":"the name \"auditors\" is already in use"}
```

## The wording people read

Three tools change the words on the sign-in pages: the tenant's display name and languages, and its own text for a message in
one language. They are `manage-tenant` tools like the structure ones, and the display name and the overrides are shown to people on those
pages, where they type a password, as soon as they are saved. `update_tenant_text_settings` takes the etag of `get_settings` as
`if_match` and names three settings; every other of the tenant's settings is refused before the admin API is asked, and the admin API
refuses it again if a tool is bypassed.

```bash
call "$WRITE" 25 get_settings '{}' > settings.json
jq -c '.result.structuredContent.data | {display_name, supported_locales, default_locale}' settings.json
call "$WRITE" 26 update_tenant_text_settings "{\"if_match\":$(jq -c .result.structuredContent.etag settings.json),\"display_name\":\"Demo Inc\",\"supported_locales\":[\"en\",\"fr\"],\"default_locale\":\"fr\"}" > text.json
jq -c '.result | {isError, display_name: .structuredContent.data.display_name, supported_locales: .structuredContent.data.supported_locales, default_locale: .structuredContent.data.default_locale}' text.json
call "$WRITE" 27 update_tenant_text_settings "{\"if_match\":$(jq -c .result.structuredContent.etag text.json),\"otp_required\":false}" | jq '.result.structuredContent'
call "$WRITE" 28 update_tenant_text_settings "{\"if_match\":$(jq -c .result.structuredContent.etag text.json),\"display_name\":\"Hijacked\",\"registration_allowed\":true}" | jq -c '.result.structuredContent.error | {type, status, detail}'
```

```
{"display_name":null,"supported_locales":["en"],"default_locale":null}
{"isError":false,"display_name":"Demo Inc","supported_locales":["en","fr"],"default_locale":"fr"}
{
  "error": {
    "type": "mcp:invalid_arguments",
    "title": "The arguments are not valid",
    "status": 400,
    "detail": "arguments: Unrecognized key: \"otp_required\"; arguments: name at least one of display_name, supported_locales, default_locale"
  }
}
{"type":"mcp:invalid_arguments","status":400,"detail":"arguments: Unrecognized key: \"registration_allowed\""}
```

An override is created without an etag and replaced or removed with the etag that `list_message_overrides` gave. A create for a key
that already has an override is the admin API's `412`, said with the way on, and a key that is no message is its `400`. The sign-in page
shows the text at once, in the language it is written in:

```bash
call "$WRITE" 29 set_message_override '{"locale":"fr","key":"login.title","message":"Connexion à Demo"}' > override.json
jq -c '.result | {isError, message: .structuredContent.data.message, etag: (.structuredContent.etag != null)}' override.json
call "$WRITE" 30 set_message_override '{"locale":"fr","key":"login.title","message":"Autre texte"}' | jq -c '.result.structuredContent.error | {title, status}'
call "$WRITE" 31 set_message_override '{"locale":"fr","key":"login.nonesuch","message":"x"}' | jq -c '.result.structuredContent.error | {title, status, detail}'
curl -sS -H 'accept-language: fr' --get --data-urlencode response_type=code --data-urlencode client_id=demo-spa \
  --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode scope=openid --data-urlencode state=s \
  --data-urlencode code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --data-urlencode code_challenge_method=S256 \
  $BASE/tenants/demo/protocol/openid-connect/auth | grep -o '<h1[^>]*>[^<]*</h1>'
```

```
{"isError":false,"message":"Connexion à Demo","etag":true}
{"title":"Precondition Failed","status":412}
{"title":"Bad Request","status":400,"detail":"key: is not the key of any page or mail message"}
<h1>Connexion à Demo</h1>
```

Replacing it needs the etag of the listing, and a stale one is a `412`. Clearing puts the default text back, and the audit row keeps the
text that was removed:

```bash
call "$WRITE" 32 list_message_overrides '{"locale":"fr"}' > listed.json
jq -c '.result.structuredContent.data | map({key, message})' listed.json
OETAG=$(jq -c '.result.structuredContent.data[0].etag' listed.json)
call "$WRITE" 33 set_message_override "{\"locale\":\"fr\",\"key\":\"login.title\",\"message\":\"Se connecter à Demo\",\"if_match\":$OETAG}" | jq -c '.result | {isError, message: .structuredContent.data.message}'
call "$WRITE" 34 clear_message_override "{\"locale\":\"fr\",\"key\":\"login.title\",\"if_match\":$OETAG}" | jq -c '.result.structuredContent.error | {title, status}'
OETAG=$(call "$WRITE" 35 list_message_overrides '{"locale":"fr"}' | jq -c '.result.structuredContent.data[0].etag')
call "$WRITE" 36 clear_message_override "{\"locale\":\"fr\",\"key\":\"login.title\",\"if_match\":$OETAG}" | jq -c '.result | {isError, data: .structuredContent.data}'
call "$WRITE" 37 list_message_overrides '{"locale":"fr"}' | jq -c '.result.structuredContent.data'
```

```
[{"key":"login.title","message":"Connexion à Demo"}]
{"isError":false,"message":"Se connecter à Demo"}
{"title":"Precondition Failed","status":412}
{"isError":false,"data":{"deleted":true}}
[]
```

A token that holds only `mcp:read` is not offered these tools, and one called by name is refused for its scope:

```bash
call "$READ" 38 set_message_override '{"locale":"fr","key":"login.title","message":"x"}' | jq -c '.result.structuredContent.error | {type, status}'
```

```
{"type":"mcp:insufficient_scope","status":403}
```

## A theme draft that nothing shows

`update_theme_draft` (for the tenant, `manage-tenant`) and `update_client_theme_draft` (for a client that is not built in,
`manage-clients`) save a draft of a theme: colours and font, a stylesheet and page templates. A draft is not what people see: it
waits until a person publishes it in the console, and no tool publishes, restores, discards or resets a theme. A save does replace the draft before it, which nothing keeps. The tool reads the
draft itself, which gives it the draft's etag too, and sends every part it was not given exactly as it is stored; a part
it is given replaces that part whole. It takes the etag of `get_theme` as `if_match`, and none when that read says there is no
draft, which makes the first one and is a place of the sign-in's ten creates.

```bash
call "$WRITE" 39 get_theme '{}' | jq -c '.result.structuredContent | {draft: .data.draft, etag}'
call "$WRITE" 40 update_theme_draft '{"tokens":{"font":"IBM Plex Mono"},"stylesheet":".page { color: green; }"}' > draft1.json
jq -c '.result | {isError, scope: .structuredContent.data.scope, font: .structuredContent.data.draft.tokens.font, stylesheet: .structuredContent.data.draft.stylesheet, changed: .structuredContent.data.changed, etag: (.structuredContent.etag != null)}' draft1.json
```

```
{"draft":null,"etag":null}
{"isError":false,"scope":"tenant","font":"IBM Plex Mono","stylesheet":".page { color: green; }","changed":["tokens","stylesheet"],"etag":true}
```

Naming only a template leaves the font and the stylesheet as the draft holds them, under the etag of the first save. The sign-in page
is still the published theme's, which here is Odudu's own, and shows none of the draft:

```bash
OLD=$(jq -r .result.structuredContent.etag draft1.json)
call "$WRITE" 41 update_theme_draft "$(jq -nc --arg e "$OLD" '{if_match:$e,templates:{"sign-in":"<div class=\"agent-draft\">{{error}}{{form.open}}{{fields}}{{submit}}{{form.close}}</div>"}}')" > draft2.json
jq -c '.result | {isError, font: .structuredContent.data.draft.tokens.font, stylesheet: .structuredContent.data.draft.stylesheet, templates: (.structuredContent.data.draft.templates | keys), changed: .structuredContent.data.changed}' draft2.json
curl -sS --get --data-urlencode response_type=code --data-urlencode client_id=demo-spa \
  --data-urlencode redirect_uri=http://localhost:8080/callback --data-urlencode scope=openid --data-urlencode state=s \
  --data-urlencode code_challenge=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa --data-urlencode code_challenge_method=S256 \
  $BASE/tenants/demo/protocol/openid-connect/auth | grep -c 'agent-draft'
```

```
{"isError":false,"font":"IBM Plex Mono","stylesheet":".page { color: green; }","templates":["sign-in"],"changed":["tokens","stylesheet","templates"]}
0
```

The first etag is stale now, and a send under it is the tool's own `412` (it read the draft again and found another), said with the way on. A stylesheet the console would refuse
is its `400`, with each problem listed under `errors` (at most ten are returned) and nothing saved:

```bash
call "$WRITE" 42 update_theme_draft "$(jq -nc --arg e "$OLD" '{if_match:$e,stylesheet:".page { color: red; }"}')" | jq -c '.result.structuredContent.error | {title, status, detail}'
NEW=$(jq -r .result.structuredContent.etag draft2.json)
call "$WRITE" 43 update_theme_draft "$(jq -nc --arg e "$NEW" '{if_match:$e,stylesheet:".nothing-like-a-hook { color: red; }"}')" | jq -c '.result.structuredContent.error | {status, detail, errors}'
```

```
{"title":"Precondition Failed","status":412,"detail":"The draft changed since it was read, or is not the one you named. Read it again with get_theme, then send the etag that read returned as if_match (none when it says draft is null)."}
{"status":400,"detail":"the theme was not saved: 1 problem(s), listed under errors","errors":[{"path":"stylesheet","message":"The class is not one of the page’s documented hooks.","code":"unknown-class","detail":"nothing-like-a-hook","line":1,"column":1}]}
```

A client's draft is the same tool with the client's id, and the first one is made without an etag. A built-in client's is refused whatever
the call names, as its name is, and the refusal is recorded. A tool that publishes does not exist, and a token that holds only `mcp:read` is
refused for its scope before the tool reads anything, though a draft is there for it to read:

```bash
call "$WRITE" 44 update_client_theme_draft "{\"id\":\"$SPA\",\"stylesheet\":\".page { color: green; }\"}" | jq -c '.result | {isError, scope: .structuredContent.data.scope, stylesheet: .structuredContent.data.draft.stylesheet}'
call "$WRITE" 45 update_client_theme_draft "{\"id\":\"$ADMINCLIENT\",\"stylesheet\":\".page { color: green; }\"}" | jq -c '.result.structuredContent.error | {title, status}'
call "$WRITE" 46 publish_theme '{}' | jq -c '.error | {code, message}'
call "$READ" 47 update_theme_draft '{"stylesheet":".page { color: red; }"}' | jq -c '.result.structuredContent.error | {type, status}'
```

```
{"isError":false,"scope":"client","stylesheet":".page { color: green; }"}
{"title":"Forbidden","status":403}
{"code":-32602,"message":"Tool publish_theme not found"}
{"type":"mcp:insufficient_scope","status":403}
```

## What was recorded

The changes are a `client.amend` and a `scope.amend` row, each with the agent client as the actor client, `ada` as the
actor subject and the diff of the fields it changed and no others. The creates are a `role.create`, a `group.create` and a `scope.create` row naming what the agent chose, and not a field
that holds what an empty row holds, and the role's description is a `role.amend` row. The built-in client's refusal is a
`capability.refused` row with the same actor. Every call is also an `agent.tool_call` row: the tool, its outcome, and why it
was refused, never what it was called with. The `failed` rows are the stale etag, the arguments the schema refused (two for
the client, two for the role and the group) and the name that was already in use; the refused rows are the built-in client's
rename and the two calls of the read token. The second `create_role` of the key `transcript-role-1` is an `allowed` row
too, since the call was made, though it made no second role (and it spends a place of the sign-in's ten creates). The wording
tools leave a `tenant.amend_settings` row that names the display name and the two languages with what each was and became, and a
`message_override.set` or `message_override.delete` row that holds the text before and after (a create's `before` is `null`, a
clear's row holds the text it removed), so a change to what people read on a sign-in page is read, and undone, from the trail. Their
`failed` rows are the two settings calls the schema refused, the override that already existed, the key that is no message, and the
clear under a stale etag; the one refused row is the read token's. A theme draft leaves a `theme.draft_saved` row for each save, naming the scope (`tenant` or `client`) and, for each part that changed
(`tokens`, `stylesheet`, `templates`, `assets`), the length and the SHA-256 of its stored form before and after and never the text, however
large the draft is. The row proves that a draft was saved, by which client and for whom, and which parts it changed, and it does not bring
the draft before it back: a replaced draft is not kept, which is why both theme tools are hinted as destructive. The draft of a built-in
client, refused at the door, is a `capability.refused` row. The `failed` rows of the theme tools are the stale etag and the stylesheet the
admin API refused, and the refused row is the read token's. The tenant is new, so these are all its rows of these actions:

```bash
docker compose -p odudu-p5a-i18 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.action, a.outcome, (a.actor_client_id = (select id from clients where client_id='agent-writer')) as by_agent, (a.actor_subject_id is not null) as has_owner, a.detail from audit_events a join tenants t on t.id=a.tenant_id where t.name='demo' and a.action in ('client.amend','scope.amend','capability.refused','role.create','group.create','scope.create','role.amend','tenant.amend_settings','message_override.set','message_override.delete','theme.draft_saved') order by a.id;"
docker compose -p odudu-p5a-i18 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.outcome, a.detail->>'tool' as tool, a.detail->>'reason' as reason from audit_events a join tenants t on t.id=a.tenant_id where t.name='demo' and a.action='agent.tool_call' and (a.detail->>'tool' like 'update_%' or a.detail->>'tool' like 'create_%' or a.detail->>'tool' like 'set_%' or a.detail->>'tool' like 'clear_%') order by a.id;"
```

```
         action          | outcome | by_agent | has_owner |                                                                                                                                                                                                                                                                                    detail
-------------------------+---------+----------+-----------+-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 client.amend            | allowed | t        | t         | {"name": {"after": "Customer portal", "before": "demo-spa"}, "description": {"after": "Where customers pay their invoices", "before": null}}
 capability.refused      | refused | t        | t         | {"reason": "insufficient_scope"}
 scope.amend             | allowed | t        | t         | {"description": {"after": "Your name, picture and birthday", "before": null}}
 role.create             | allowed | t        | t         | {"name": {"after": "auditors"}, "description": {"after": "Reads the audit trail"}}
 group.create            | allowed | t        | t         | {"name": {"after": "staff"}, "description": {"after": "Employees"}}
 scope.create            | allowed | t        | t         | {"name": {"after": "orders:read"}, "description": {"after": "Read the orders of the person"}, "display_order": {"after": 7}}
 role.amend              | allowed | t        | t         | {"description": {"after": "Reads the audit trail and nothing else", "before": "Reads the audit trail"}}
 tenant.amend_settings   | allowed | t        | t         | {"display_name": {"after": "Demo Inc", "before": null}, "default_locale": {"after": "fr", "before": null}, "supported_locales": {"after": ["en", "fr"], "before": ["en"]}}
 message_override.set    | allowed | t        | t         | {"key": "login.title", "after": "Connexion à Demo", "before": null, "locale": "fr"}
 message_override.set    | allowed | t        | t         | {"key": "login.title", "after": "Se connecter à Demo", "before": "Connexion à Demo", "locale": "fr"}
 message_override.delete | allowed | t        | t         | {"key": "login.title", "before": "Se connecter à Demo", "locale": "fr"}
 theme.draft_saved       | allowed | t        | t         | {"scope": "tenant", "changed": {"assets": {"after": {"bytes": 2, "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}, "before": null}, "tokens": {"after": {"bytes": 24, "sha256": "5adebf12a3a9a8b9369979670bdb1dd731ee254c7f9667cc3240809812ebdc56"}, "before": null}, "templates": {"after": {"bytes": 2, "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}, "before": null}, "stylesheet": {"after": {"bytes": 25, "sha256": "846eaf4f109610f183a7054a7f64a22e4f9203da40537ff750664d4bc826bf8d"}, "before": null}}}
 theme.draft_saved       | allowed | t        | t         | {"scope": "tenant", "changed": {"templates": {"after": {"bytes": 103, "sha256": "29c1436f86a8b9958f8b17d2e11023ab62955a8fa53140a45c2c34c68159e8ac"}, "before": {"bytes": 2, "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}}}}
 theme.draft_saved       | allowed | t        | t         | {"scope": "client", "changed": {"assets": {"after": {"bytes": 2, "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}, "before": null}, "tokens": {"after": {"bytes": 2, "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}, "before": null}, "templates": {"after": {"bytes": 2, "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}, "before": null}, "stylesheet": {"after": {"bytes": 25, "sha256": "846eaf4f109610f183a7054a7f64a22e4f9203da40537ff750664d4bc826bf8d"}, "before": null}}}
 capability.refused      | refused | t        | t         | {"reason": "insufficient_scope"}
(15 rows)

 outcome |            tool             |       reason
---------+-----------------------------+--------------------
 allowed | update_client_metadata      |
 failed  | update_client_metadata      |
 failed  | update_client_metadata      |
 failed  | update_client_metadata      |
 refused | update_client_metadata      | insufficient_scope
 refused | update_client_metadata      | insufficient_scope
 allowed | update_scope_metadata       |
 allowed | create_role                 |
 allowed | create_role                 |
 failed  | create_role                 |
 failed  | create_group                |
 allowed | create_group                |
 allowed | create_scope                |
 allowed | update_role_description     |
 refused | create_role                 | insufficient_scope
 failed  | create_role                 |
 allowed | update_tenant_text_settings |
 failed  | update_tenant_text_settings |
 failed  | update_tenant_text_settings |
 allowed | set_message_override        |
 failed  | set_message_override        |
 failed  | set_message_override        |
 allowed | set_message_override        |
 failed  | clear_message_override      |
 allowed | clear_message_override      |
 refused | set_message_override        | insufficient_scope
 allowed | update_theme_draft          |
 allowed | update_theme_draft          |
 failed  | update_theme_draft          |
 failed  | update_theme_draft          |
 allowed | update_client_theme_draft   |
 refused | update_client_theme_draft   | insufficient_scope
 refused | update_theme_draft          | insufficient_scope
(33 rows)
```
