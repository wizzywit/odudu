---
title: 'The MCP endpoint'
description: 'A tenant’s MCP endpoint run with curl in both protocol eras: the challenge, a token, the tools, what it refuses and the audit rows its calls leave.'
---

# The MCP endpoint

A tenant serves one MCP endpoint, `/tenants/<name>/mcp` at the path address and `/mcp` at its own
domain, and nothing else answers there. It takes `POST` only, carries no session, and answers a
client that speaks the 2026-07-28 revision and one that opens with the 2025-11-25 `initialize`
handshake, from the same address (an `initialize` for 2025-06-18 or 2025-03-26 was also answered when sent by hand; no test holds it). Its tools read what the [admin API](../admin-paths/index.md)
reads, as the person who signed in: the token it is given is for the endpoint and is never sent
on, and each call is made with a token Odudu signs for it (audience the admin API, subject the person,
`act` the agent), so the person's own capabilities and the token's scope decide what comes back.
The tenant's [protected resource metadata](./protected-resource-metadata.md) is where a client
learns the sign-in; this page is the endpoint those documents point at.

Every command was run, in this order, on a stack built for it and started from an empty volume (port `3000`, the
throttles at `10000`, the schedules off), driven only as far as this page goes: the tenant `demo` and its user `ada` made as
[Bootstrap](./bootstrap.md) makes them, `ada` given two capabilities, the tenant's registration policy set to `mcp`, one
client registered, one sign-in. The stack does not end TLS, so an address is `http`. A token lives five minutes, so the
commands after the sign-in ran within them, one after another; the request ids, ids and times are that run's.

## The tenant, its user and a client

`ada` holds `view-users` and `manage-clients` on the tenant's admin client and no other
capability. Under the `mcp` policy a client registers itself with no token, as a public client whose
only audience is the tenant's MCP address:

```bash
odudu() { docker compose -p odudu-p5a-i12a -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
odudu seed --tenant demo --client demo-spa --redirect-uri http://localhost:8080/callback \
  --user ada --password correct-horse-battery --email ada@example.com
odudu seed grant-role --tenant demo --username ada --role odudu-admin:view-users
odudu seed grant-role --tenant demo --username ada --role odudu-admin:manage-clients
odudu seed tenant --name demo --set client_registration_policy=mcp
```

```
{"created":true,"tenant":"demo","tenantId":"01a1b281-be1e-77ad-abd1-a6e27b19e3c5","clientId":"demo-spa","userSubjectId":"01a1b281-bedd-71ce-a5a4-45299aed981a"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b281-be1e-77ad-abd1-a6e27b19e3c5","username":"ada","role":"odudu-admin:view-users"}
{"command":"grant-role","tenant":"demo","tenantId":"01a1b281-be1e-77ad-abd1-a6e27b19e3c5","username":"ada","role":"odudu-admin:manage-clients"}
{"command":"tenant","created":false,"tenant":"demo","tenantId":"01a1b281-be1e-77ad-abd1-a6e27b19e3c5","settings":["client_registration_policy"]}
```

```bash
MCP=http://localhost:3000/tenants/demo/mcp
curl -sS -X POST -H 'content-type: application/json' \
  -d '{"client_name":"Transcript agent","redirect_uris":["http://127.0.0.1:8080/callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code"],"audience":"'$MCP'"}' \
  http://localhost:3000/tenants/demo/clients-registrations/openid-connect
```

```
{"client_id":"01a1b281-c404-7fb4-878a-77d9c4157df0","client_id_issued_at":1793996211,"redirect_uris":["http://127.0.0.1:8080/callback"],"audience":["http://localhost:3000/tenants/demo/mcp"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","client_name":"Transcript agent"}
```

## Getting a token

The sign-in is the authorization code flow with PKCE, as [Path A](./path-a-authorization-code-with-pkce.md)
runs it, with the MCP address as the `resource`. `CID` is the `client_id` above, and `jar` holds the cookies.

```bash
VERIFIER=$(openssl rand -hex 32)
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
curl -sS -c jar -b jar -o authorize.html -w '%{http_code}\n' --get \
  --data-urlencode response_type=code --data-urlencode "client_id=$CID" \
  --data-urlencode redirect_uri=http://127.0.0.1:8080/callback \
  --data-urlencode 'scope=openid mcp:read' --data-urlencode "resource=$MCP" \
  --data-urlencode state=s --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 \
  http://localhost:3000/tenants/demo/protocol/openid-connect/auth
```

```
200
```

`authorize.html` is the sign-in form. Signing in as `ada` ends on the consent page, which shows the client's name and
offers `mcp:read` as a choice, because a client that registered itself is asked about until the person approves it:

```bash
AUTH_SESSION_ID=$(grep -o 'name="auth_session_id" value="[^"]*"' authorize.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -o login.html \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode username=ada --data-urlencode password=correct-horse-battery \
  http://localhost:3000/tenants/demo/login-actions/authenticate
sed -n '/<header/,/<\/form>/p' login.html
```

```
<header class="intro">
<h1><bdi>Transcript agent</bdi> is asking for access</h1>
<p class="context">This application registered itself. Nobody at this tenant set it up, and its name is its own claim.</p>
<p class="context">After you decide, you are sent back to:</p>
<p class="context"><bdi>http://127.0.0.1:8080</bdi></p>
<p class="tenant"><bdi>demo</bdi></p>
</header>
<form method="post" action="/tenants/demo/login-actions/consent">
  <input type="hidden" name="auth_session_id" value="01a1b281-c469-7204-a74e-3965bb98f325">
  <ul>
  <li><bdi>openid</bdi></li>
  </ul>
  <label><input type="checkbox" name="scope" value="mcp:read"> <bdi>mcp:read</bdi> — lets the application read this tenant&#39;s settings and records on your behalf</label>
  <button type="submit" name="decision" value="allow">Allow</button>
  <button type="submit" name="decision" value="deny" class="secondary">Deny</button>
</form>
```

Allowing it redirects to the client with a code:

```bash
AUTH_SESSION_ID=$(grep -o 'name="auth_session_id" value="[^"]*"' login.html | head -1 | sed 's/.*value="//;s/"//')
curl -sS -c jar -b jar -D - -o /dev/null \
  --data-urlencode "auth_session_id=$AUTH_SESSION_ID" \
  --data-urlencode scope=mcp:read --data-urlencode decision=allow \
  http://localhost:3000/tenants/demo/login-actions/consent
```

```
HTTP/1.1 302 Found
x-request-id: 01a1b281-c540-787a-a67d-119546f87320
set-cookie: demo-session=01a1b281-c555-7ce6-a0ee-03b01e1c9654:3niCSFPFjSQyeJnQBk_AFwAoz73tw0FFlpTGCsIEzik; HttpOnly; SameSite=Lax; Path=/
set-cookie: demo-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0
set-cookie: odudu-sign-in=; HttpOnly; SameSite=Lax; Path=/tenants/demo/; Max-Age=0
location: http://127.0.0.1:8080/callback?code=uPjNQPBpf2S6loKyJRvSzpqLo-24-w554md0tL1nvZs&state=s&iss=http%3A%2F%2Flocalhost%3A3000%2Ftenants%2Fdemo
content-length: 0
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

The code is redeemed with the verifier and the same `resource`. The access token's claims show what the
endpoint will check: the audience holds the MCP address, the scope holds `mcp:read`, and the token names the grant
and the session it stands on.

```bash
curl -sS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" \
  --data-urlencode redirect_uri=http://127.0.0.1:8080/callback --data-urlencode "client_id=$CID" \
  --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$MCP" \
  http://localhost:3000/tenants/demo/protocol/openid-connect/token > token.json
TOKEN=$(jq -r .access_token token.json)
echo "$TOKEN" | cut -d. -f2 | python3 -c "import sys,base64;s=sys.stdin.read().strip();print(base64.urlsafe_b64decode(s+'='*(-len(s)%4)).decode())" | jq .
```

```
{
  "iss": "http://localhost:3000/tenants/demo",
  "sub": "01a1b281-bedd-71ce-a5a4-45299aed981a",
  "aud": [
    "http://localhost:3000/tenants/demo/mcp",
    "http://localhost:3000/tenants/demo"
  ],
  "client_id": "01a1b281-c404-7fb4-878a-77d9c4157df0",
  "scope": "openid mcp:read",
  "iat": 1793996211,
  "exp": 1793996511,
  "jti": "01a1b281-c588-7b37-9ddf-e9d3ce0b28e5",
  "sid": "01a1b281-c555-7ce6-a0ee-03b01e1c9654",
  "grant_id": "01a1b281-c588-7b37-9ddf-e9d28374770e"
}
```

The rest of the page uses two shell definitions: `rpc` posts to the endpoint with the token, and `META` is the
envelope a 2026-07-28 request carries.

```bash
rpc() {
  curl -sS -X POST "$MCP" -H "Authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' "$@"
}
META='{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"curl","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}}'
```

## A request with no usable token

With no token the answer is `401`, an empty body and a challenge that names the metadata a client signs in from
(RFC 9728 §5.1) and the scope its first request needs:

```bash
curl -sS -D - -X POST "$MCP" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1b281-c5e3-7394-95b0-9135d33da607
cache-control: no-store
www-authenticate: Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/tenants/demo/mcp", scope="mcp:read"
content-length: 0
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A token that is not one is `401` too, with `error="invalid_token"` in front, and nothing in the answer says which check refused it:

```bash
curl -sS -D - -X POST "$MCP" -H 'Authorization: Bearer not-a-token' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1b281-c5f0-7f79-b1f7-ae313895631d
cache-control: no-store
www-authenticate: Bearer error="invalid_token", resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/tenants/demo/mcp", scope="mcp:read"
content-length: 0
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

A tenant that does not exist (or is switched off) answers the empty `404` its protected resource metadata does, so the endpoint
tells nobody which tenants exist:

```bash
curl -sS -D - -X POST http://localhost:3000/tenants/nobody/mcp -H 'content-type: application/json' -d '{}'
```

```
HTTP/1.1 404 Not Found
x-request-id: 01a1b281-c5fa-7762-993c-26a51e8fa31f
content-length: 0
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72
```

## A host or an origin that is not the tenant's

The `Host` has to be the host of the tenant's address, so a name an attacker's DNS points at this server is
refused whatever else the request holds, and a browser's `Origin` has to be the tenant's own. A client that is not
a browser sends no `Origin` and passes. Both are `403`, before any token is read:

```bash
rpc -D - -H 'Host: evil.example' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a1b281-c605-79af-8df7-47c52eb058be
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 116
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Forbidden: this host or origin is not the tenant’s"},"id":null}
```

```bash
rpc -D - -H 'Origin: https://evil.example' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

```
HTTP/1.1 403 Forbidden
x-request-id: 01a1b281-c612-75bc-9629-05f3073271f0
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 116
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Forbidden: this host or origin is not the tenant’s"},"id":null}
```

`GET` and `DELETE` are `405` with `Allow: POST`, since there is no session to open a stream on or end:

```bash
curl -sS -D - -w '\n\n' "$MCP"
curl -sS -D - -X DELETE "$MCP"
```

```
HTTP/1.1 405 Method Not Allowed
x-request-id: 01a1b281-c61d-71f5-a5f6-5634036a3232
allow: POST
content-type: application/json; charset=utf-8
content-length: 83
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}

HTTP/1.1 405 Method Not Allowed
x-request-id: 01a1b281-c626-7d04-b82e-d4f1291fcc71
allow: POST
content-type: application/json; charset=utf-8
content-length: 83
Date: Fri, 06 Nov 2026 20:16:51 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"jsonrpc":"2.0","error":{"code":-32000,"message":"Method not allowed."},"id":null}
```

## A 2025-11-25 client

A client that opens with `initialize` is served with no session id: each request stands alone, and the
`tools` capability says the list does not change.
`serverInfo` and `instructions` name the tenant the endpoint serves, taken from the token and never from a
request, so a client with several Odudu servers connected can tell them apart; every tool description in
`tools/list` starts with the tenant's name in brackets, and `server/discover` carries the same name and
instructions.

```bash
rpc -D - -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

```
HTTP/1.1 200 OK
x-request-id: 01a1b281-c633-771e-b5c8-07b135323c0f
cache-control: no-cache, no-transform
connection: keep-alive
content-type: text/event-stream
x-accel-buffering: no
Date: Fri, 06 Nov 2026 20:16:51 GMT
Transfer-Encoding: chunked

event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"odudu:demo","title":"Odudu (demo)","version":"1.0.0"},"instructions":"This server acts in the Odudu tenant \"demo\" only, as the person signed in; every tool works on that tenant. If you also have other Odudu servers connected, check the tenant before using a tool."},"jsonrpc":"2.0","id":1}
```

`tools/list` names the tools `ada` can use. The endpoint has 44 read tools, two of which (`list_tenants` and `count_tenants`) are offered only to an agent of the `system` tenant and so are not in this tenant's list, and two write tools that only a token holding `mcp:write` is offered (see
[the write tools](./the-mcp-write-tools.md)); `list_audit` and the others whose capability she
does not hold (`view-audit`, `manage-sessions`, `manage-keys`, `view-domains`, `manage-tenant`) are not in the list, so
the model is not offered what would be refused. This page cannot show the two tenant tools being called: they need an agent signed in to the `system` tenant, which takes no `seed client` and signs its administrator in through a browser, so only the repository's integration tests run that case.

The listing as `ada` sees it:

```bash
rpc -H 'mcp-protocol-version: 2025-11-25' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | sed -n 's/^data: //p' | jq -c '.result.tools | map(.name)'
```

```
["count_clients","count_subjects","get_client","get_subject","get_subject_admin_capabilities","get_subject_groups","get_subject_lockout","get_subject_required_actions","get_subject_roles","list_client_logout_deliveries","list_clients","list_groups","list_roles","list_subject_consents","list_subject_effective_roles","list_subjects","whoami"]
```

`whoami` answers for the person, which is how the call can be told from one made with another identity: the subject is
`ada`, the tenant is named beside its id, and the capabilities are the two she holds.

```bash
rpc -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}}' \
  | sed -n 's/^data: //p' | jq .
```

```
{
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"data\":{\"subjectId\":\"01a1b281-bedd-71ce-a5a4-45299aed981a\",\"issuerTenantId\":\"01a1b281-be1e-77ad-abd1-a6e27b19e3c5\",\"issuerTenantName\":\"demo\",\"capabilities\":[\"manage-clients\",\"view-users\"],\"crossTenant\":false}}"
      }
    ],
    "structuredContent": {
      "data": {
        "subjectId": "01a1b281-bedd-71ce-a5a4-45299aed981a",
        "issuerTenantId": "01a1b281-be1e-77ad-abd1-a6e27b19e3c5",
        "issuerTenantName": "demo",
        "capabilities": [
          "manage-clients",
          "view-users"
        ],
        "crossTenant": false
      }
    },
    "isError": false
  },
  "jsonrpc": "2.0",
  "id": 3
}
```

## A 2026-07-28 client

A 2026-07-28 request carries its envelope in `_meta` and names its method in `Mcp-Method` (and a tool in `Mcp-Name`).
`server/discover` lists the revisions served and the capabilities, and the answer carries `ttlMs` and `cacheScope`, which
a client may keep it for:

```bash
rpc -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: server/discover' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":4,\"method\":\"server/discover\",\"params\":{\"_meta\":$META}}"
```

```
{"result":{"supportedVersions":["2026-07-28"],"capabilities":{"tools":{"listChanged":false}},"instructions":"This server acts in the Odudu tenant \"demo\" only, as the person signed in; every tool works on that tenant. If you also have other Odudu servers connected, check the tenant before using a tool.","resultType":"complete","ttlMs":60000,"cacheScope":"private","_meta":{"io.modelcontextprotocol/serverInfo":{"name":"odudu:demo","title":"Odudu (demo)","version":"1.0.0"}}},"jsonrpc":"2.0","id":4}
```

`tools/list` is the same list in the same order, held for a minute by the requesting client alone (`private`), since it
depends on who asks:

```bash
rpc -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/list' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\",\"params\":{\"_meta\":$META}}" \
  | jq -c '{count: (.result.tools | length), ttlMs: .result.ttlMs, cacheScope: .result.cacheScope, names: (.result.tools | map(.name))}'
```

```
{"count":17,"ttlMs":60000,"cacheScope":"private","names":["count_clients","count_subjects","get_client","get_subject","get_subject_admin_capabilities","get_subject_groups","get_subject_lockout","get_subject_required_actions","get_subject_roles","list_client_logout_deliveries","list_clients","list_groups","list_roles","list_subject_consents","list_subject_effective_roles","list_subjects","whoami"]}
```

A tool's arguments are described by a schema that takes nothing it does not name, bounds each string and says what an
identifier looks like:

```bash
rpc -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/list' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\",\"params\":{\"_meta\":$META}}" \
  | jq '.result.tools[] | select(.name == "get_client") | .inputSchema'
```

```
{
  "type": "object",
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "properties": {
    "id": {
      "type": "string",
      "maxLength": 36,
      "pattern": "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
      "description": "The client's id, a UUID."
    }
  },
  "required": [
    "id"
  ],
  "additionalProperties": false
}
```

A call returns one page, with the data under `data` and the cursor of the next page beside it (`more` here says one
was returned):

```bash
rpc -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/call' -H 'mcp-name: list_clients' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":6,\"method\":\"tools/call\",\"params\":{\"name\":\"list_clients\",\"arguments\":{\"limit\":2},\"_meta\":$META}}" \
  | jq '.result | {isError, resultType, names: [.structuredContent.data[].name], more: (.structuredContent.next_cursor != null)}'
```

```
{
  "isError": false,
  "resultType": "complete",
  "names": [
    "Odudu MCP",
    "Odudu administration"
  ],
  "more": true
}
```

A request whose `Mcp-Method` header is missing, or names another method than the body, is refused `400` with `-32020`:

```bash
rpc -D - -H 'mcp-protocol-version: 2026-07-28' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":7,\"method\":\"tools/list\",\"params\":{\"_meta\":$META}}"
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1b281-c742-7cb3-9ad9-c9ef354c1fc8
content-type: application/json
Date: Fri, 06 Nov 2026 20:16:52 GMT
Connection: keep-alive
Keep-Alive: timeout=72
Transfer-Encoding: chunked

{"jsonrpc":"2.0","error":{"code":-32020,"message":"Bad Request: the request headers and body disagree: the body names method tools/list but the required Mcp-Method header is absent","data":{"mismatch":{"header":"(missing)","body":"the body names method tools/list but the required Mcp-Method header is absent"}}},"id":7}
```

## A tool the person cannot use, and arguments the schema refuses

`list_audit` is not in `ada`'s list, but a client may name any tool. The call reaches the admin API, which refuses it for
the person's missing capability, and the result says so as a tool error:

```bash
rpc -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"list_audit","arguments":{}}}'
```

```
event: message
data: {"result":{"content":[{"type":"text","text":"{\"error\":{\"type\":\"about:blank\",\"title\":\"Forbidden\",\"status\":403}}"}],"structuredContent":{"error":{"type":"about:blank","title":"Forbidden","status":403}},"isError":true},"jsonrpc":"2.0","id":8}
```

Arguments that are not what the schema takes are refused before anything is sent to the admin API, in words the
model can act on, and without repeating what it sent:

```bash
rpc -H 'mcp-protocol-version: 2025-11-25' \
  -d '{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"get_client","arguments":{"id":"not-an-id","extra":1}}}'
```

```
event: message
data: {"result":{"content":[{"type":"text","text":"{\"error\":{\"type\":\"mcp:invalid_arguments\",\"title\":\"The arguments are not valid\",\"status\":400,\"detail\":\"id: must be a UUID; arguments: Unrecognized key: \\\"extra\\\"\"}}"}],"structuredContent":{"error":{"type":"mcp:invalid_arguments","title":"The arguments are not valid","status":400,"detail":"id: must be a UUID; arguments: Unrecognized key: \"extra\""}},"isError":true},"jsonrpc":"2.0","id":9}
```

A JSON-RPC batch is refused, so one request cannot spend the budget many times:

```bash
rpc -D - -H 'mcp-protocol-version: 2025-11-25' \
  -d '[{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}},{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}]'
```

```
HTTP/1.1 400 Bad Request
x-request-id: 01a1b281-c79c-78b4-a9f9-7027e0c170ef
cache-control: no-store
content-type: application/json; charset=utf-8
content-length: 96
Date: Fri, 06 Nov 2026 20:16:52 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"jsonrpc":"2.0","error":{"code":-32600,"message":"Batch requests are not supported"},"id":null}
```

## What was recorded

Every tool call is one `agent.tool_call` audit row, whether it was served, refused or failed: the tool, the admin
route it reached, the owner and the agent client, and never the arguments or the result. The listings, the discovery and the
`initialize` are not tool calls and wrote nothing. The tenant is new, so these are all its rows:

```bash
docker compose -p odudu-p5a-i12a -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.action, a.outcome, a.detail->>'tool' as tool, a.detail->>'route' as route, a.detail->>'reason' as reason, (a.actor_subject_id is not null) as has_owner from audit_events a join tenants t on t.id = a.tenant_id where t.name = 'demo' and a.action = 'agent.tool_call' order by a.id;"
```

```
     action      | outcome |     tool     |                 route                  |       reason       | has_owner
-----------------+---------+--------------+----------------------------------------+--------------------+-----------
 agent.tool_call | allowed | whoami       | GET /admin/tenants/:tenant/whoami      |                    | t
 agent.tool_call | allowed | list_clients | GET /admin/tenants/:tenant/clients     |                    | t
 agent.tool_call | refused | list_audit   | GET /admin/tenants/:tenant/audit       | missing_capability | t
 agent.tool_call | failed  | get_client   | GET /admin/tenants/:tenant/clients/:id |                    | t
(4 rows)
```

## The budget

A person and client may make sixty requests a minute to a tenant, and four at once; a person across all their clients a hundred and twenty; the tenant as a whole six hundred.
The counts are kept by the one server process, so a deployment of several multiplies them. This is seventy
requests in a row from the same token, counted by status:

```bash
for i in $(seq 1 70); do
  rpc -o /dev/null -w '%{http_code}\n' -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/list' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\",\"params\":{\"_meta\":$META}}"
done | sort | uniq -c
```

```
  49 200
  21 429
```

The twenty-one that were refused are the seventy less what the minute had left after the requests above it, which counted
as well. A refused request carries `Retry-After`, the seconds until the minute ends, and a JSON-RPC error:

```bash
rpc -D - -H 'mcp-protocol-version: 2026-07-28' -H 'mcp-method: tools/list' \
  -d "{\"jsonrpc\":\"2.0\",\"id\":5,\"method\":\"tools/list\",\"params\":{\"_meta\":$META}}"
```

```
HTTP/1.1 429 Too Many Requests
x-request-id: 01a1b281-cdb3-7abe-bf47-9a4f7edbdfd5
cache-control: no-store
retry-after: 8
content-type: application/json; charset=utf-8
content-length: 81
Date: Fri, 06 Nov 2026 20:16:53 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"jsonrpc":"2.0","error":{"code":-32029,"message":"Too many requests"},"id":null}
```
