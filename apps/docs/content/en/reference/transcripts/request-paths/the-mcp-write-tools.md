---
title: 'The MCP write tools'
description: 'The MCP write tools: consent for mcp:write, an update under an etag, a role, group or scope created under a key, and what each refusal leaves behind.'
---

# The MCP write tools

An agent that holds `mcp:write` is offered seven tools beyond the reads. Two change a client or a scope:
`update_client_metadata` changes a client's name, description and their per-language texts, and `update_scope_metadata`
changes a scope's description, its per-language texts and its display order. They send nothing else: not a redirect URI,
a grant, a secret, whether a client is enabled, a role or a scope's consent text, and a name that is not in the tool's
schema is refused before the admin API is asked. Two more, `update_role_description` and `update_group_description`, change
a description, and three, `create_role`, `create_group` and `create_scope`, make a role, a group or a scope that grants
nothing, under a key the agent chooses; [the last section](#a-role-a-group-and-a-scope-that-grant-nothing) shows them. Asking for `mcp:write` is itself put to the person at every sign-in. Each tool that changes something that exists takes the `etag` of a read as `if_match`, so a change made in the meantime is a `412` and not an
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
odudu() { docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
odudu seed --tenant demo --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed grant-role --tenant demo --username ada --role odudu-admin:view-users
odudu seed grant-role --tenant demo --username ada --role odudu-admin:manage-clients
odudu seed grant-role --tenant demo --username ada --role odudu-admin:manage-tenant
```

```
{"created":true,"tenant":"demo","tenantId":"01a1b3a9-99b3-7ab1-9cd2-01b9041ca978","clientId":"demo-spa","userSubjectId":"01a1b3a9-9a59-7de9-a0c5-2d2041b1ae39"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b3a9-99b3-7ab1-9cd2-01b9041ca978","username":"ada","role":"odudu-admin:view-users"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b3a9-99b3-7ab1-9cd2-01b9041ca978","username":"ada","role":"odudu-admin:manage-clients"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b3a9-99b3-7ab1-9cd2-01b9041ca978","username":"ada","role":"odudu-admin:manage-tenant"}
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
{"command":"assign-scope","tenant":"demo","tenantId":"01a1b3a9-99b3-7ab1-9cd2-01b9041ca978","clientId":"agent-writer","scope":"mcp:read","assignment":"optional"}
{"command":"assign-scope","tenant":"demo","tenantId":"01a1b3a9-99b3-7ab1-9cd2-01b9041ca978","clientId":"agent-writer","scope":"mcp:write","assignment":"optional"}
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
  <input type="hidden" name="auth_session_id" value="01a1b3a9-a5b9-791c-8527-6829b2d97c5e">
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
  <input type="hidden" name="auth_session_id" value="01a1b3a9-a680-788b-a7d9-1d3f47858d2b">
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
rpc "$READ" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq -c '[.result.tools[].name | select(test("^(update|create)_"))]'
rpc "$WRITE" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq -c '[.result.tools[].name | select(test("^(update|create)_"))]'
rpc "$WRITE" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | jq '.result.tools[] | select(.name == "update_client_metadata") | {name, annotations, required: .inputSchema.required, fields: (.inputSchema.properties | keys)}'
```

```
[]
["create_group","create_role","create_scope","update_client_metadata","update_group_description","update_role_description","update_scope_metadata"]
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
{"id":"01a1b3a9-99d7-770a-b91a-2684d806cf7f","client_id":"odudu-mcp","name":"Odudu MCP"}
{"id":"01a1b3a9-99f6-791b-abdf-2798a6ae266c","client_id":"odudu-admin","name":"Odudu administration"}
{"id":"01a1b3a9-9a2e-7fb4-8cf3-d8a23258afb0","client_id":"demo-spa","name":"demo-spa"}
{"id":"01a1b3a9-a1b6-78b0-a568-8ea43b09546d","client_id":"agent-writer","name":"Transcript agent"}
{"name":"demo-spa","description":null,"etag":"\"6912c211c89522bbc68d7876c15f29df36497769908384b67f5c8b895a4d51b8\""}
```

The update answers the client as it is now and its new etag, which is not the one it was sent:

```bash
call "$WRITE" 4 update_client_metadata "{\"id\":\"$SPA\",\"if_match\":$ETAG,\"name\":\"Customer portal\",\"description\":\"Where customers pay their invoices\"}" > upd.json
jq -c '.result | {isError, name: .structuredContent.data.name, description: .structuredContent.data.description, etag: .structuredContent.etag}' upd.json
```

```
{"isError":false,"name":"Customer portal","description":"Where customers pay their invoices","etag":"\"030b6a668aa8538ddf4e9385a4270eedb3b7a1d6306fd8e7aee4a23d2466deba\""}
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
{"id":"01a1b3a9-99c6-7d42-85ed-5b9acf7ba890","name":"profile","description":null}
{"name":"profile","description":null,"etag":"\"3c016fdc23bd292bbf2e3f4060ef6c3a57a17ed208049e7c614b3e7170f68f7a\""}
{"isError":false,"description":"Your name, picture and birthday","etag":"\"edb2ee2f466efadd950fe37cf0444384290b81d9a3649a2e1c90eb053e3f52ae\""}
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

## What was recorded

The changes are a `client.amend` and a `scope.amend` row, each with the agent client as the actor client, `ada` as the
actor subject and the diff of the fields it changed and no others. The creates are a `role.create`, a `group.create` and a `scope.create` row naming what the agent chose, and not a field
that holds what an empty row holds, and the role's description is a `role.amend` row. The built-in client's refusal is a
`capability.refused` row with the same actor. Every call is also an `agent.tool_call` row: the tool, its outcome, and why it
was refused, never what it was called with. The `failed` rows are the stale etag, the arguments the schema refused (two for
the client, two for the role and the group) and the name that was already in use; the refused rows are the built-in client's
rename and the two calls of the read token. The second `create_role` of the key `transcript-role-1` is an `allowed` row
too, since the call was made, though it made no second role (and it spends a place of the sign-in's ten creates). The tenant is new, so these are all its rows of these actions:

```bash
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.action, a.outcome, (a.actor_client_id = (select id from clients where client_id='agent-writer')) as by_agent, (a.actor_subject_id is not null) as has_owner, a.detail from audit_events a join tenants t on t.id=a.tenant_id where t.name='demo' and a.action in ('client.amend','scope.amend','capability.refused','role.create','group.create','scope.create','role.amend') order by a.id;"
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.outcome, a.detail->>'tool' as tool, a.detail->>'reason' as reason from audit_events a join tenants t on t.id=a.tenant_id where t.name='demo' and a.action='agent.tool_call' and (a.detail->>'tool' like 'update_%' or a.detail->>'tool' like 'create_%') order by a.id;"
```

```
       action       | outcome | by_agent | has_owner |                                                                    detail
--------------------+---------+----------+-----------+----------------------------------------------------------------------------------------------------------------------------------------------
 client.amend       | allowed | t        | t         | {"name": {"after": "Customer portal", "before": "demo-spa"}, "description": {"after": "Where customers pay their invoices", "before": null}}
 capability.refused | refused | t        | t         | {"reason": "insufficient_scope"}
 scope.amend        | allowed | t        | t         | {"description": {"after": "Your name, picture and birthday", "before": null}}
 role.create        | allowed | t        | t         | {"name": {"after": "auditors"}, "description": {"after": "Reads the audit trail"}}
 group.create       | allowed | t        | t         | {"name": {"after": "staff"}, "description": {"after": "Employees"}}
 scope.create       | allowed | t        | t         | {"name": {"after": "orders:read"}, "description": {"after": "Read the orders of the person"}, "display_order": {"after": 7}}
 role.amend         | allowed | t        | t         | {"description": {"after": "Reads the audit trail and nothing else", "before": "Reads the audit trail"}}
(7 rows)

 outcome |          tool           |       reason
---------+-------------------------+--------------------
 allowed | update_client_metadata  |
 failed  | update_client_metadata  |
 failed  | update_client_metadata  |
 failed  | update_client_metadata  |
 refused | update_client_metadata  | insufficient_scope
 refused | update_client_metadata  | insufficient_scope
 allowed | update_scope_metadata   |
 allowed | create_role             |
 allowed | create_role             |
 failed  | create_role             |
 failed  | create_group            |
 allowed | create_group            |
 allowed | create_scope            |
 allowed | update_role_description |
 refused | create_role             | insufficient_scope
 failed  | create_role             |
(16 rows)
```
