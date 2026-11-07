---
title: Protect an MCP server
description: Let AI clients find a tenant's MCP endpoint, register, sign a person in and call its tools, with the real challenge, metadata and token checks.
sidebar_position: 12
---

# Protect an MCP server

An AI client that speaks the Model Context Protocol is given one address, the MCP server's, and has to work out where to sign in and what to ask for. Odudu answers that on both sides: it is the authorization server a client signs in with, and every tenant serves an MCP endpoint of its own, `/tenants/<name>/mcp`, whose tools are the admin API held to the person's own capabilities. You will set a tenant up for MCP clients, read what a client reads, sign in as one and call a tool.

You need the stack from the [quick start](../quick-start/index.mdx) with its `demo` tenant and its user `ada`. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` and `openssl` installed.

**What was checked.** Every command here was run against a stack built from this repository, and the same sign-in, registration and calls are run on every server change by two clients nobody here wrote: the MCP Inspector 2.13.0 and the TypeScript SDK's client 2.4.0, in both protocol eras the endpoint serves. On 6 November 2026 the owner ran Claude Code 2.1.319 and Claude Desktop 3.6556.2 against a local instance, as reported by the owner; hosted Claude (the claude.ai connectors) and Cursor were not run. [Connect Claude](./connect-claude.md) and [Connect Cursor](./connect-cursor.md) say what that leaves unchecked.

## 1. Point the commands at your server

If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo" && export MCP="$TENANT/mcp"
```

## 2. Ask for the endpoint with no token

A client's first request carries no credential. The answer is a `401` with an empty body, and the `WWW-Authenticate` header is the whole message: where the metadata is, and the scope the first request needs.

```sh {run expect="resource_metadata"}
curl -sS -D - -o /dev/null -X POST -H 'content-type: application/json' -d '{}' "$MCP"
```

```
HTTP/1.1 401 Unauthorized
x-request-id: 01a1b039-3254-72dd-9db4-8fd23b621ea4
cache-control: no-store
www-authenticate: Bearer resource_metadata="http://localhost:3196/.well-known/oauth-protected-resource/tenants/demo/mcp", scope="mcp:read"
content-length: 0
Date: Fri, 06 Nov 2026 09:38:20 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

That is the output of a stack on port 3196, so your ids, dates and port differ. [The MCP endpoint](../reference/transcripts/request-paths/the-mcp-endpoint.md) has every other refusal, in order.

## 3. Read the metadata a client reads

The document in `resource_metadata` is the endpoint's own description (RFC 9728). Its `resource` is the address the client connected to, and a client refuses it when the two differ.

```sh {run expect="authorization_servers"}
curl -sS "$ODUDU_BASE/.well-known/oauth-protected-resource/tenants/demo/mcp"
```

```
{"resource":"http://localhost:3196/tenants/demo/mcp","authorization_servers":["http://localhost:3196/tenants/demo"],"scopes_supported":["mcp:read","mcp:write"],"bearer_methods_supported":["header"]}
```

`authorization_servers` has one entry, because clients read only the first. It is the tenant, and the tenant's own metadata is the next stop. A tenant that registers nobody yet shows no `registration_endpoint` there, and a client with no client id has nowhere to go.

```sh {run expect="code_challenge_methods_supported"}
curl -sS "$ODUDU_BASE/.well-known/oauth-authorization-server/tenants/demo" | grep -o '"code_challenge_methods_supported":[^]]*]\|"registration_endpoint":"[^"]*"\|"client_id_metadata_document_supported":[a-z]*'
```

```
"code_challenge_methods_supported":["S256"]
```

## 4. Let MCP clients in

An MCP client gets a client id one of three ways, and you choose which the tenant allows.

- **Registration.** The client registers itself. Set `client_registration_policy` to `mcp` and the registration endpoint takes public clients and nothing else: no secret, redirect addresses that are `https` or loopback `http`, and an `audience` that is the tenant's MCP address. Such a client may hold `mcp:read` and never `mcp:write`.
- **A metadata document.** The client's `client_id` is an https address, and the document there says who it is. Turn on `cimd_enabled`. Under the `mcp` policy a client that comes this way is given the same audience and `mcp:read`. With the setting off, such an address is answered as an unknown client.
- **A client you made.** You create it with the MCP address as an audience (`odudu seed client --audience`, the console or the admin API) and assign `mcp:read` (and `mcp:write`, to allow writes). This is the one route to a write token, and the one a client that is handed a fixed client id uses.

Two more routes exist beside these, for `odudu mcp` rather than for a client you point at the endpoint, and the table puts all five side by side.

### Which registration route, when

| Route                                                                  | What it is                                                                                                                                                      | Scopes it can get                                                                                    | Use it when                                                                                                                                  |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-registration under the `mcp` policy (dynamic client registration) | The client posts its own registration and gets a client id without a token. Public client, `https` or loopback redirect addresses, the MCP address as audience. | `mcp:read` only.                                                                                     | You want a client to connect with no setup by an administrator, and reading is enough.                                                       |
| A metadata document (CIMD)                                             | The client's id is an `https` address whose document says who it is; Odudu fetches it. Needs `cimd_enabled`.                                                    | `mcp:read` only.                                                                                     | The client publishes such a document, as Claude Code and claude.ai are documented to, and you would rather it identify itself than register. |
| A client an administrator creates                                      | You make it with the MCP address as an audience and assign its scopes.                                                                                          | `mcp:read`, and `mcp:write` if you assign it, as optional scopes.                                    | The client has a fixed client id, or it should be able to change descriptions. The only route to `mcp:write`.                                |
| The built-in `odudu-mcp` client                                        | Every tenant has it. `odudu mcp` uses it to sign a person in through the browser on a loopback port.                                                            | `mcp:read`, or `mcp:write` alone with `--allow-writes`, which offers the five tools that amend text. | A desktop client runs `odudu mcp` on your machine, as Claude Desktop does.                                                                   |
| A service account's key                                                | A confidential client with a private key, registered once; `odudu mcp` signs in with it and no person is present.                                               | `mcp:read`, or `mcp:write` with `--allow-writes`, which offers the five tools that amend text.       | A program with no browser, such as an agent in a container.                                                                                  |

A client that registered itself, or came from a metadata document, **cannot be upgraded to `mcp:write`**: an administrator who assigns it the scope changes nothing, because the server drops `mcp:write` from such a client whatever it asks for. To get writes, create a client as in the third row and assign it `mcp:write` as an optional scope. Even then the person is asked about `mcp:write` at every sign-in, and the token lasts ten minutes with no refresh token.

A word on two settings in these rows. A **redirect address** is where the browser is sent with the sign-in's result; the client lists the addresses it may use and Odudu sends it to no other. A client's **Audiences** is the list of servers a token issued to it may be used at: the client sends the server's address as `resource` (RFC 8707), Odudu puts it in the token's `aud` only if the list holds it exactly, and the endpoint accepts only a token whose `aud` names its own address. A request for an address the list does not hold is refused with `invalid_target`.

The first two are one command each. Turn both on:

```sh {run expect="cimd_enabled"}
docker compose exec odudu odudu seed tenant --name demo --set client_registration_policy=mcp --set cimd_enabled=true
```

The metadata now names the registration endpoint and says metadata documents are accepted:

```sh {run expect="registration_endpoint"}
curl -sS "$ODUDU_BASE/.well-known/oauth-authorization-server/tenants/demo" | grep -o '"registration_endpoint":"[^"]*"\|"client_id_metadata_document_supported":[a-z]*'
```

```
"registration_endpoint":"http://localhost:3196/tenants/demo/clients-registrations/openid-connect"
"client_id_metadata_document_supported":true
```

The third needs no setting. `--audience` gives the client the MCP address, and the scopes are assigned to it separately. This one is for a client that is handed a fixed client id, and the only kind that can be assigned `mcp:write`:

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-mcp-agent --public --redirect-uri http://127.0.0.1:8123/callback --audience "$MCP"
```

```sh {run expect="my-mcp-agent"}
docker compose exec odudu odudu seed assign-scope --tenant demo --client-id my-mcp-agent --scope mcp:read --assignment optional
```

A person needs something to do. `mcp:read` lets the agent read what the person could read, and the person here, `ada`, can read nothing until she holds a capability. Give her the one that lets her read users:

```sh {run expect="view-users"}
docker compose exec odudu odudu seed grant-role --tenant demo --username ada --role odudu-admin:view-users
```

## 5. Register a client

This is what an MCP client does the first time. It names its redirect address (a loopback one here, on a port it chooses) and the MCP address as its audience.

```sh {run expect="client_id"}
REGISTERED=$(curl -fsS -H 'content-type: application/json' -d "{\"client_name\":\"My agent\",\"redirect_uris\":[\"http://127.0.0.1:8123/callback\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\"],\"audience\":\"$MCP\"}" "$TENANT/clients-registrations/openid-connect") && echo "$REGISTERED"
```

```
{"client_id":"01a1b039-3768-7b24-8902-34567b90ee7b","client_id_issued_at":1793957902,"redirect_uris":["http://127.0.0.1:8123/callback"],"audience":["http://localhost:3196/tenants/demo/mcp"],"grant_types":["authorization_code"],"token_endpoint_auth_method":"none","client_name":"My agent"}
```

```sh {run}
CLIENT_ID=$(printf '%s' "$REGISTERED" | sed -n 's/.*"client_id":"\([^"]*\)".*/\1/p')
```

Registering is limited: ten clients an hour from one address and sixty an hour for the tenant, and a client that is never used is removed after a week.

## 6. Sign a person in

This is the authorization code flow with PKCE, as [Sign a user in](./sign-a-user-in.md) walks through it, with one addition that MCP asks for: the `resource` parameter, set to the MCP address. It is what puts that address in the token's audience. The commands play the browser and sign in as `ada`.

```sh {run}
VERIFIER=$(openssl rand -hex 32) && CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -binary -sha256 | openssl base64 | tr '+/' '-_' | tr -d '=')
```

```sh {run}
COOKIES=$(mktemp) && PAGE=$(curl -fsS -c "$COOKIES" -G --data-urlencode response_type=code --data-urlencode "client_id=$CLIENT_ID" --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode scope=mcp:read --data-urlencode "resource=$MCP" --data-urlencode state=abc123 --data-urlencode "code_challenge=$CHALLENGE" --data-urlencode code_challenge_method=S256 "$TENANT/protocol/openid-connect/auth")
```

```sh {run}
AUTH_SESSION=$(printf '%s' "$PAGE" | sed -n 's/.*name="auth_session_id" value="\([^"]*\)".*/\1/p' | head -1)
```

After the password, a client that registered itself is asked about. The consent page shows its name and offers `mcp:read` as a choice the person ticks.

```sh {run expect="is asking for access"}
CONSENT=$(curl -fsS -b "$COOKIES" -c "$COOKIES" --data-urlencode "auth_session_id=$AUTH_SESSION" --data-urlencode username=ada --data-urlencode 'password=a long and unremarkable passphrase' "$TENANT/login-actions/authenticate") && printf '%s\n' "$CONSENT" | grep -o '<h1>.*</h1>\|name="scope" value="[^"]*"'
```

```
<h1><bdi>My agent</bdi> is asking for access</h1>
name="scope" value="mcp:read"
```

Allowing it sends the browser back to the client with a code.

```sh {run expect="127.0.0.1:8123/callback?code="}
CALLBACK=$(curl -sS -o /dev/null -D - -b "$COOKIES" --data-urlencode "auth_session_id=$AUTH_SESSION" --data-urlencode scope=mcp:read --data-urlencode decision=allow "$TENANT/login-actions/consent" | sed -n 's/^[Ll]ocation: //p' | tr -d '\r') && echo "$CALLBACK"
```

```sh {run}
CODE=$(printf '%s' "$CALLBACK" | sed -n 's/.*[?&]code=\([^&]*\).*/\1/p')
```

The client swaps the code, with the verifier and the same `resource`, for a token.

```sh {run expect="Bearer"}
TOKENS=$(curl -fsS --data-urlencode grant_type=authorization_code --data-urlencode "code=$CODE" --data-urlencode redirect_uri=http://127.0.0.1:8123/callback --data-urlencode "client_id=$CLIENT_ID" --data-urlencode "code_verifier=$VERIFIER" --data-urlencode "resource=$MCP" "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$TOKENS" | sed -E 's/("access_token":"[^"]{12})[^"]*"/\1…"/'
```

```sh {run}
TOKEN=$(printf '%s' "$TOKENS" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
```

## 7. Check the token the endpoint will check

An access token's middle part says what it is for. This helper decodes it.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

```sh {run expect="mcp:read"}
decode "$TOKEN"
```

```
{"iss":"http://localhost:3196/tenants/demo","sub":"01a1b039-3137-7e2f-88ac-a75136bac562","aud":["http://localhost:3196/tenants/demo/mcp","http://localhost:3196/tenants/demo"],"client_id":"01a1b039-3768-7b24-8902-34567b90ee7b","scope":"mcp:read","iat":1793957902,"exp":1793958202,"jti":"01a1b039-3a61-7de9-bb8f-7614ae6705ac","sid":"01a1b039-3a16-7952-b756-30ab03c0934a","grant_id":"01a1b039-3a61-7de9-bb8f-7613dcd8daef"}
```

The endpoint takes a token only when `aud` holds the MCP address exactly and `scope` holds `mcp:read` or `mcp:write`. A token for the tenant alone, such as the one your own web app gets, is refused, and so is one that also names the admin API, so no token serves both doors. [Tokens](../concepts/tokens.mdx) says what the rest of the claims are.

## 8. Call the endpoint

The tools are listed and called with JSON-RPC over `POST`. This is the handshake a client that speaks the 2025-11-25 revision opens with; one that speaks 2026-07-28 skips it. The answer is a server-sent event, one message long.

```sh {run expect="protocolVersion"}
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-11-25' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' "$MCP"
```

```
event: message
data: {"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{"listChanged":false}},"serverInfo":{"name":"odudu:demo","title":"Odudu (demo)","version":"1.0.0"},"instructions":"This server acts in the Odudu tenant \"demo\" only, as the person signed in; every tool works on that tenant. If you also have other Odudu servers connected, check the tenant before using a tool."},"jsonrpc":"2.0","id":1}

```

The server names its tenant here, in `serverInfo` and in `instructions`, and when you connect a client, name the entry after the tenant, for example `odudu-acme`. `whoami` is the tool that says who the call is made for. It is the person, with the capabilities she holds, and not the client.

```sh {run expect="view-users"}
curl -sS -X POST -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-11-25' -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"whoami","arguments":{}}}' "$MCP" | sed -n 's/^data: //p'
```

```
{"result":{"content":[{"type":"text","text":"{\"data\":{\"subjectId\":\"01a1b0fa-b0fd-7510-8914-103575c9b973\",\"issuerTenantId\":\"01a1b0fa-b046-73dc-acf8-0a963c19a71e\",\"issuerTenantName\":\"demo\",\"capabilities\":[\"view-users\"],\"crossTenant\":false}}"}],"structuredContent":{"data":{"subjectId":"01a1b0fa-b0fd-7510-8914-103575c9b973","issuerTenantId":"01a1b0fa-b046-73dc-acf8-0a963c19a71e","issuerTenantName":"demo","capabilities":["view-users"],"crossTenant":false}},"isError":false},"jsonrpc":"2.0","id":2}
```

A tool the person cannot use is not in the list the endpoint offers, and a client that calls it by name is refused by the admin API for the missing capability. Every call, served or refused, is an `agent.tool_call` audit event that names the tool, the person and the client, and never the arguments. Two tools, `list_tenants` and `count_tenants`, read across tenants and are offered only to an agent signed in to the `system` tenant for a person who holds `manage-tenants`: an agent of any other tenant is not offered them, and calling one anyway is refused. They list and count the tenants and open none of them. Besides the lists and reads of clients, people, roles, sessions, keys, domains, scopes and the audit trail, an agent can read six small records: the tenant it acts in (`get_tenant`), whether usernames can be changed (`get_username_policy`), the passkey impact of a new canonical address (`get_passkey_impact`), what deleting a scope would take with it (`get_scope_impact`), the built-in scopes the tenant has (`list_builtin_scopes`) and the settings a relying party needs for one client (`get_client_installation`, never its secret). `get_tenant` takes no argument and so can only ever answer for the tenant the agent signed in to. An agent can also read how the tenant and its clients look: the theme and its versions, what a preview would show, what a stylesheet may name, the mail's colours and logo, the tenant's own message wording and the catalogue of messages (`get_theme`, `list_theme_versions`, `get_theme_preview_info`, `get_stylesheet_hooks`, `get_mail_branding`, `list_message_overrides` and `get_message_catalogue`), and a client's theme, versions, preview info and mail look (`get_client_theme`, `list_client_theme_versions`, `get_client_theme_preview_info` and `get_client_mail_branding`), the client's under `manage-clients`. A stylesheet or a template comes back whole, up to 131,072 characters, and is still text to read, never an instruction; a theme too large for one result is refused as `mcp:result_too_large`. The image bytes and the rendered previews are not offered. The endpoint also bounds a client: sixty requests a minute for each person and client, and four at once.

## 9. Put it back

Open registration is a decision, so close it when you are done with the guide. Turning the policy off ends what it gave: a client that registered under it keeps no MCP audience and loses `mcp:read` at its next sign-in and its next refresh, so a token already issued is the only thing left, and it lives five minutes.

```sh {run expect="client_registration_policy"}
docker compose exec odudu odudu seed tenant --name demo --set client_registration_policy=disabled --set cimd_enabled=false
```

## What an agent can and cannot do, and why

An agent's reach follows one line, drawn at access and not at whether a call can be undone: a wrong call may put wrong text in front of a person, and it may not change who can sign in, what a token carries, a secret or a deletion. Every admin API route is in one class, and the counts are of its 152 routes.

| Class | Routes | An agent today                                                                                                                                                                                                 | Why, and what a person does instead                                                                                                                                                                                                                                                                                                                       |
| ----- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R     | 59     | Yes, with `mcp:read`                                                                                                                                                                                           | Reads that hold no secret and no credential metadata, and personal data only as the console shows it (a subject's record, the audit trail's names and addresses), so an agent cannot read out a password or a key. Each call is an audit event.                                                                                                           |
| I     | 2      | Yes, for a system administrator's agent only                                                                                                                                                                   | The tenant list and its count. They open no tenant's content, and the agent of any other tenant is refused.                                                                                                                                                                                                                                               |
| W1    | 13     | Yes for 12, with `mcp:write`; seven of them (the three creates, the two message override tools and the two theme drafts) only through the tenant's MCP endpoint, not `odudu mcp` and not for a service account | Wording, descriptions, drafts and structure that grant nothing, so the worst a wrong call does is put wrong text in front of a person. Each sign-in allows 20 changing calls and 10 creates, and past that a call is refused (`mcp:write_budget`) until the person signs in again. The thirteenth, a theme image upload, needs a person: use the console. |
| W2    | 32     | Not yet                                                                                                                                                                                                        | Each changes who can sign in or what a token carries: grants, mappings, redirect and grant settings, security settings, identity fields, publishing a theme, sending mail. Use the console. A confirmation step the agent cannot answer for itself comes with a later release.                                                                            |
| C     | 7      | Not yet                                                                                                                                                                                                        | Each returns or sets a secret: passwords, client secrets, registration tokens, signing keys, relay credentials. Use the console. The same confirmation step comes first.                                                                                                                                                                                  |
| D     | 27     | Not yet                                                                                                                                                                                                        | Each deletes, ends sessions, clears a lockout, changes a signing key or discards a draft. Use the console. The same confirmation step comes first.                                                                                                                                                                                                        |
| RS    | 8      | Never                                                                                                                                                                                                          | Sensitive reads: personal data, credential metadata, secrets and whole-tenant downloads, which an injected agent could carry out. Read them in the console, or with your own token from the admin API.                                                                                                                                                    |
| N     | 4      | Never                                                                                                                                                                                                          | Pages drawn for a browser frame, such as mail previews, which are not data an agent can read. The console shows them, and `get_theme_preview_info` says what a draft's preview is made of.                                                                                                                                                                |

Access-changing, credential and destructive operations are not available to an agent yet, so an agent that is told to make one is refused, and a person does it in the console.

A client that holds `mcp:write` can make 20 changing calls and 10 creates for each sign-in. Past that a call is refused with `mcp:write_budget` and the person signs in again; [Connect Claude](./connect-claude.md#when-the-allowance-runs-out) says what is counted and what is given back.

## Protecting your own MCP server

The endpoint above is Odudu's own. A server of yours takes the same shape, and Odudu is its authorization server:

1. Your server answers a request without a token with `401` and `WWW-Authenticate: Bearer resource_metadata="<your document>"`, and serves that document at `/.well-known/oauth-protected-resource` plus its own path (RFC 9728 §3.1). Its `resource` is your server's address, exactly, and its `authorization_servers` is `["https://<odudu>/tenants/<name>"]`.
2. A client that signs in names your address as `resource`. Odudu puts it in the token's `aud` only when the client's **Audiences** list holds it, so register the address on the client: `odudu seed client --audience`, the console's Advanced tab or the `audiences` field of the admin API.
3. Your server checks every token as [Protect an API](./api.md) does: signature from the tenant's keys, issuer, expiry and that `aud` holds your address. Check the scope your tools need.

Odudu's registration policy and its metadata documents give a client the audience of Odudu's own endpoint only. For your server, the clients that reach it are ones you made. That path, an audience you chose and a `resource` that names it, is checked by the server's own tests against Odudu's own endpoint and has not been run against a third-party MCP server.

## Where to go next

- [Connect Claude](./connect-claude.md) and [Connect Cursor](./connect-cursor.md) set up the clients people use.
- A script or a custom client that has no person to sign in uses the client credentials grant: [Call an API as a service](./machine-to-machine.md#use-the-machine-route-for-mcp).
- [Protected resource metadata](../reference/transcripts/request-paths/protected-resource-metadata.md) and [the MCP endpoint](../reference/transcripts/request-paths/the-mcp-endpoint.md) are the recorded runs, and [the write tools](../reference/transcripts/request-paths/the-mcp-write-tools.md) show what a write token can do.
