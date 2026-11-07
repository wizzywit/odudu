---
title: 'odudu mcp over stdio'
description: 'The stdio MCP server as a process: a handshake, a listing and read calls as a service account, its refusals, and what the audit trail holds.'
---

# odudu mcp over stdio

`odudu mcp` serves the [MCP endpoint's](./the-mcp-endpoint.md) tools to a local client over standard input and output. It is a client of an instance, not part of one: it reads no server configuration and opens no database, and it calls the [admin API](../admin-paths/index.md) over HTTP with a token issued straight to the caller, for the admin API, with the scope `mcp:read` (or `mcp:write` alone with `--allow-writes`). There is no MCP endpoint in the path and no token exchange. A service account signs in with its key (`private_key_jwt` at the `client_credentials` grant); a person signs in in their browser as the built-in `odudu-mcp` client, which cannot be a transcript, because it ends at a loopback listener on the person's own machine and a browser. This page runs the key route, whose handshake, listing and calls pipe through standard input and output.

Every command was run, in this order, on a stack built for it and started from an empty volume, driven only as far as this page goes: the tenant `demo`, one client `agent` with a key, and the calls below. The stack does not end TLS, so its address is `http://localhost:3000`, which `odudu mcp` accepts because it is a loopback address and refuses for any other host. The command runs inside the container, so `localhost` is the server. The ids and the key are that run's own, and the key is shortened where it would be shown, because it is a private key.

```bash
odudu() { docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T odudu node dist/main.js "$@"; }
odudu seed tenant --name demo
```

```
{"command":"tenant","created":true,"tenant":"demo","tenantId":"01a1b3a9-393b-70ad-a6c9-4a312f5e0664"}
```

## A service account and its key

`--keygen` needs no other option. It prints the line to keep on standard output and the public key set to register on standard error, which the next commands keep apart:

```bash
odudu mcp --keygen > key.env 2> jwks.json; echo "exit $?"
cut -c1-24 key.env
cat jwks.json
```

```
exit 0
ODUDU_MCP_KEY=eyJrdHkiOi
{"keys":[{"kty":"EC","crv":"P-256","x":"zpWorww6mamRgLiLbidbV3vlWGWQvU4hG4nCmCVry5c","y":"KmAzw88PoEQ2oFCpWcNwWtFP4G1ao926ZigjXejAnec","kid":"a6-67afJhrpQHIjf-cIhikI2VLcu3c-Ec3xVDWRMTDQ","alg":"ES256","use":"sig"}]}
```

The client is confidential with the `client_credentials` grant and may ask for `mcp:read` and nothing else. The secret it is made with is never used again, because the client authenticates with the key instead:

```bash
odudu seed client --tenant demo --client-id agent --client-secret "$(openssl rand -hex 24)" \
  --grant-type client_credentials --client-credentials-scope mcp:read
```

```
{"command":"client","created":true,"tenant":"demo","tenantId":"01a1b3a9-393b-70ad-a6c9-4a312f5e0664","clientId":"agent","clientDbId":"01a1b3a9-3d8d-7f60-a2d4-ec5970c4866a"}
```

The seed has no flag for a key or a role on a service account, and this run set the audience in the same way rather than with `--audience`, so the rest was written to the database as its owner, scoped to this tenant: the key set becomes the client's `jwks`, `private_key_jwt` its authentication method, the admin API's audience its audience, and its account holds two of the admin capabilities. The admin API's client routes do the same with a token, and the account's ceiling is these roles and nothing more:

```bash
JWKS=$(cat jwks.json)
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "update client_oidc_config c set token_endpoint_auth_method = 'private_key_jwt', jwks = '$JWKS'::jsonb, audiences = array['urn:odudu:params:admin-api'] from clients k join tenants t on t.id = k.tenant_id where c.client_id = k.id and t.name = 'demo' and k.client_id = 'agent';"
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "insert into subject_roles (tenant_id, subject_id, role_id) select k.tenant_id, k.service_subject_id, r.id from clients k join tenants t on t.id = k.tenant_id join clients a on a.tenant_id = k.tenant_id and a.client_id = 'odudu-admin' join roles r on r.client_id = a.id where t.name = 'demo' and k.client_id = 'agent' and r.name in ('manage-clients', 'view-users');"
```

```
UPDATE 1
INSERT 0 2
```

## A handshake and two calls

A client keeps its end of the pipe open until it has read what it asked for, and the command ends when that input does, so `sleep` plays the client here. The key travels in the environment, named without a value so it is not in the process's arguments, and the client id is an option:

```bash
export ODUDU_MCP_KEY=$(sed 's/^ODUDU_MCP_KEY=//' key.env)
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"transcript","version":"1"}}}'
INITED='{"jsonrpc":"2.0","method":"notifications/initialized"}'
LIST='{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
WHO='{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"whoami","arguments":{}}}'
COUNT='{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"count_clients","arguments":{}}}'
(printf '%s\n' "$INIT" "$INITED" "$LIST" "$WHO" "$COUNT"; sleep 6) \
  | docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T -e ODUDU_MCP_KEY odudu \
    node dist/main.js mcp --base-url http://localhost:3000 --tenant demo --client-id agent \
  > out.jsonl 2> err.txt; echo "exit $?"
wc -l < out.jsonl
```

```
exit 0
       4
```

Four lines for the four requests, and the notification, which has no answer, wrote none. Standard output carries the protocol and nothing else. The first line is the handshake, which names the tenant from `--tenant`, in `serverInfo` and in `instructions`:

```bash
jq -c 'select(.id==1)' out.jsonl
```

```
{"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"odudu:demo","title":"Odudu (demo)","version":"1.0.0"},"instructions":"This server acts in the Odudu tenant \"demo\" only, as the person signed in; every tool works on that tenant. If you also have other Odudu servers connected, check the tenant before using a tool."},"jsonrpc":"2.0","id":1}
```

The listing is the endpoint's, minus the seven write tools, since the command was not asked for writes. Those are 59 tools, none of them starts with `update_` or `create_`, and none is one of the two that list and count tenants, which only an agent of the `system` tenant is offered (no transcript here shows that agent, since the `system` tenant takes no `seed client` and its administrator signs in through a browser; the repository's integration tests run it):

```bash
jq -c 'select(.id==2) | .result.tools | length' out.jsonl
jq -r 'select(.id==2) | .result.tools | map(.name) | join(" ")' out.jsonl | fold -s -w 100
jq -r 'select(.id==2) | .result.tools[].name' out.jsonl | grep -c '^update_'
jq -r 'select(.id==2) | .result.tools[].name' out.jsonl | grep -c '^create_'
jq -r 'select(.id==2) | .result.tools[].name' out.jsonl | grep -c '_tenants$'
```

```
59
count_audit count_clients count_groups count_roles count_scopes count_sessions count_subjects
get_client get_client_installation get_client_mail_branding get_client_theme
get_client_theme_preview_info get_domain get_flow_executions get_group get_group_roles
get_mail_branding get_message_catalogue get_passkey_impact get_role get_role_composites get_scope
get_scope_impact get_scope_mappers get_scope_roles get_settings get_stylesheet_hooks get_subject
get_subject_admin_capabilities get_subject_groups get_subject_lockout get_subject_required_actions
get_subject_roles get_tenant get_theme get_theme_preview_info get_username_policy list_audit
list_builtin_scopes list_client_logout_deliveries list_client_sessions list_client_theme_versions
list_clients list_domains list_groups list_keys list_mail list_message_overrides list_roles
list_scope_clients list_scopes list_sessions list_subject_consents list_subject_effective_roles
list_subject_grants list_subject_sessions list_subjects list_theme_versions whoami
0
0
0
```

The two calls reached the admin API with a token the command got from the token endpoint with its key. `whoami` says who the calls are made for, the service account, and what it may do, the two capabilities it was given:

```bash
jq -c 'select(.id==3)' out.jsonl
jq -c 'select(.id==4)' out.jsonl
```

```
{"result":{"content":[{"type":"text","text":"{\"data\":{\"subjectId\":\"01a1b3a9-3dad-7735-8322-41c940808523\",\"issuerTenantId\":\"01a1b3a9-393b-70ad-a6c9-4a312f5e0664\",\"issuerTenantName\":\"demo\",\"capabilities\":[\"manage-clients\",\"view-users\"],\"crossTenant\":false}}"}],"structuredContent":{"data":{"subjectId":"01a1b3a9-3dad-7735-8322-41c940808523","issuerTenantId":"01a1b3a9-393b-70ad-a6c9-4a312f5e0664","issuerTenantName":"demo","capabilities":["manage-clients","view-users"],"crossTenant":false}},"isError":false},"jsonrpc":"2.0","id":3}
{"result":{"content":[{"type":"text","text":"{\"data\":{\"count\":3,\"capped\":false}}"}],"structuredContent":{"data":{"count":3,"capped":false}},"isError":false},"jsonrpc":"2.0","id":4}
```

The tenant has three clients: `odudu-admin`, `odudu-mcp` and `agent`. Standard error was empty, which is what a client that reads it for diagnostics expects of a run that went well:

```bash
wc -c < err.txt
```

```
       0
```

## What it refuses before it starts

A refusal is one line on standard error, nothing on standard output and exit status 1, and it names what to set without showing any value. A client id with no key in the environment (the previous `export` is gone, as it would be in a new shell):

```bash
unset ODUDU_MCP_KEY
odudu mcp --base-url http://localhost:3000 --tenant demo --client-id agent; echo "exit $?"
```

```
odudu mcp: a client id needs its private key: set ODUDU_MCP_KEY or pass --key-file
exit 1
```

A key with no client id, the key being any value, since the check comes before it is read:

```bash
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T -e ODUDU_MCP_KEY=x odudu \
  node dist/main.js mcp --base-url http://localhost:3000 --tenant demo; echo "exit $?"
```

```
odudu mcp: a service account key needs the client it belongs to: pass --client-id or set ODUDU_MCP_CLIENT_ID
exit 1
```

An address that would send a bearer over plain HTTP to a host that is not this machine:

```bash
odudu mcp --base-url http://id.example.com --tenant demo; echo "exit $?"
```

```
odudu mcp: --base-url must be https unless it is a loopback address
exit 1
```

## `--allow-writes`

`--allow-writes` is the only way `mcp:write` is asked for, and it adds the four write tools that amend a name or a description to the listing: not the three that create a role, a group or a scope, which only the MCP endpoint offers, since only it counts them against the sign-in, and a call to one of them by name is an unknown tool. Listing needs no token, so it answers at once. The first call needs one, and the account was given only `mcp:read`, so the token endpoint refuses and the call says so:

```bash
export ODUDU_MCP_KEY=$(sed 's/^ODUDU_MCP_KEY=//' key.env)
(printf '%s\n' "$INIT" "$INITED" "$LIST" "$WHO"; sleep 4) \
  | docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T -e ODUDU_MCP_KEY odudu \
    node dist/main.js mcp --base-url http://localhost:3000 --tenant demo --client-id agent --allow-writes \
  > out2.jsonl 2> err2.txt; echo "exit $?"
jq -r 'select(.id==2) | .result.tools | map(.name) | map(select(startswith("update_"))) | join(" ")' out2.jsonl
jq -r 'select(.id==2) | .result.tools | map(.name) | map(select(startswith("create_"))) | length' out2.jsonl
jq -c 'select(.id==3)' out2.jsonl
cat err2.txt
```

```
exit 0
update_client_metadata update_group_description update_role_description update_scope_metadata
0
{"result":{"content":[{"type":"text","text":"{\"error\":{\"type\":\"mcp:sign_in_required\",\"title\":\"the token endpoint refused the request (400, invalid_scope)\",\"status\":401}}"}],"structuredContent":{"error":{"type":"mcp:sign_in_required","title":"the token endpoint refused the request (400, invalid_scope)","status":401}},"isError":true},"jsonrpc":"2.0","id":3}
```

The refusal names the registered error code and the status, and none of the server's own words. `err2.txt` is empty again.

## What the trail holds

The tenant's audit rows, as the database's owner, after everything above and nothing else on this stack: the token the first run got, the row the admin API wrote for each of the two reads, and the token that was refused. The admin API writes those rows itself, at its door and before the call runs, for a call made with a token issued straight to the agent, which is how `odudu mcp` calls. Its `tool` is the route, since the door cannot know a tool's name; the MCP endpoint writes the same action for a call it serves, with the tool's own name.

```bash
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.action, a.outcome, a.detail from audit_events a join tenants t on t.id = a.tenant_id where t.name = 'demo' and a.action in ('token.issue', 'client.authenticate', 'agent.tool_call') order by a.id;"
docker compose -p odudu-p5a-i16 -f infra/docker/compose.yaml exec -T postgres psql -U odudu -d odudu -c \
  "select a.action, a.outcome, count(*) from audit_events a join tenants t on t.id = a.tenant_id where t.name = 'demo' group by 1, 2 order by 1, 2;"
```

```
     action      | outcome |                                                                                              detail
-----------------+---------+---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 token.issue     | allowed | {"scope": "mcp:read", "grant_type": "client_credentials"}
 agent.tool_call | allowed | {"tool": "admin.get.whoami", "owner": "01a1b3a9-3dad-7735-8322-41c940808523", "route": "GET /admin/tenants/:tenant/whoami", "agent_client": "01a1b3a9-3d8d-7f60-a2d4-ec5970c4866a"}
 agent.tool_call | allowed | {"tool": "admin.get.clients.count", "owner": "01a1b3a9-3dad-7735-8322-41c940808523", "route": "GET /admin/tenants/:tenant/clients/count", "agent_client": "01a1b3a9-3d8d-7f60-a2d4-ec5970c4866a"}
 token.issue     | refused | {"reason": "invalid_scope"}
(4 rows)

     action      | outcome | count
-----------------+---------+-------
 agent.tool_call | allowed |     2
 token.issue     | allowed |     1
 token.issue     | refused |     1
(3 rows)
```

The reads' rows name the owner, the service account, and the route, and never what was asked or what came back. The refused token is a `token.issue` row of its own and no admin call followed it, so no `agent.tool_call` row does.
