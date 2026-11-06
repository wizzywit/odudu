---
title: Connect Cursor
description: Connect Cursor to a tenant's MCP endpoint with dynamic registration or a client id in mcp.json, and what the agent can then read.
sidebar_position: 14
---

# Connect Cursor

Cursor takes an MCP server from an `mcp.json` file and signs in to it with OAuth. It registers itself as a public client when the server allows that, and it can be given a fixed client id when it does not. Both work with an Odudu tenant, and both end with the same read-only tools [Connect Claude](./connect-claude.md) describes. Cursor has no client metadata document, so the tenant's `cimd_enabled` setting does nothing for it.

You need the stack from the [quick start](../quick-start/index.mdx), with its `demo` tenant and its user `ada`, and a shell in the folder that holds `compose.yaml`. The examples use `http://localhost:3000`.

## What was checked, and what was not

The Odudu side was run: the registration below, with the redirect addresses Cursor's documentation names, and the rest of the sign-in with the MCP Inspector 2.13.0 and the TypeScript SDK's client 2.4.0, which run against the endpoint on every change (`infra/conformance/run-mcp.sh`). **Cursor itself was not run by the authors yet.** The `mcp.json` shapes and the redirect addresses follow [Cursor's documentation](https://cursor.com/docs/context/mcp) as read on 6 November 2026, and are tagged `text` where they are the vendor's syntax and not a command that runs here. Which protocol revision Cursor speaks is not published, and the endpoint serves both the 2025-11-25 and the 2026-07-28 revisions.

## 1. Point the commands at your server

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo" && export MCP="$TENANT/mcp"
```

## 2. Let MCP clients register

Cursor registers itself the first time it meets the server, without asking you. The tenant has to allow it, and only for MCP: under the `mcp` policy the registration endpoint takes public clients and nothing else.

```sh {run expect="client_registration_policy"}
docker compose exec odudu odudu seed tenant --name demo --set client_registration_policy=mcp
```

Cursor's documentation says it registers as a public client with no secret, and gives two redirect addresses: `http://localhost:8787/callback` for the desktop app and `https://www.cursor.com/agents/mcp/oauth/callback` for the web and Cursor Agents. This request has that shape. It is typed by hand, not captured from Cursor, and it shows what the tenant does with it:

```sh {run expect="client_id"}
curl -fsS -H 'content-type: application/json' -d "{\"client_name\":\"Cursor\",\"redirect_uris\":[\"http://localhost:8787/callback\",\"https://www.cursor.com/agents/mcp/oauth/callback\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"scope\":\"mcp:read\",\"audience\":\"$MCP\"}" "$TENANT/clients-registrations/openid-connect"
```

```
{"client_id":"01a1b03e-5523-73b1-ad32-dae71c88d39a","client_id_issued_at":1793958237,"redirect_uris":["http://localhost:8787/callback","https://www.cursor.com/agents/mcp/oauth/callback"],"audience":["http://localhost:3196/tenants/demo/mcp"],"scope":"mcp:read","grant_types":["authorization_code","refresh_token"],"token_endpoint_auth_method":"none","client_name":"Cursor"}
```

That output is from a stack on port 3196, so your id, time and port differ. Both addresses are kept: a loopback `http` address and an `https` one are the two kinds the policy admits. A secret, a custom scheme like `cursor://` or a `jwks` is refused. The `scope` is what the policy lets the client hold, and `mcp:write` is never among it. The tenant's MCP address is the client's only audience, which is what makes a token from it work at the endpoint and nowhere else. [Protect an MCP server](./protect-an-mcp-server.md) follows the rest of the sign-in.

## 3. Add the server to Cursor

Cursor reads `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every project. A remote server is an entry with a `url`:

```text
{
  "mcpServers": {
    "odudu": {
      "url": "http://localhost:3000/tenants/demo/mcp"
    }
  }
}
```

Cursor finds the sign-in from the endpoint's `401` and the metadata it points at, registers as above, and opens the tenant's sign-in page in your browser. You sign in and, on the consent page, tick `mcp:read` to allow it. Cursor is then connected to the 42 read tools, for what you may read.

## 4. A fixed client id

Use a client id you made when the tenant does not allow registration, or when you want Cursor to be able to ask for `mcp:write`. An administrator makes the client: public, with the redirect address `http://localhost:8787/callback` (and `https://www.cursor.com/agents/mcp/oauth/callback` for the web), the tenant's MCP address as its audience, and `mcp:read`, and `mcp:write` if it should write, assigned as optional scopes. [Connect Claude](./connect-claude.md#to-change-descriptions-a-client-of-your-own) shows the admin API request and the console steps, and the same client works for Cursor.

Cursor's documentation gives the `auth` object for a server that has no dynamic registration. `CLIENT_ID` is required, `CLIENT_SECRET` only for a confidential client, and `scopes` is an array:

```text
{
  "mcpServers": {
    "odudu": {
      "url": "http://localhost:3000/tenants/demo/mcp",
      "auth": {
        "CLIENT_ID": "cursor",
        "scopes": ["mcp:read"]
      }
    }
  }
}
```

With `mcp:write` in `scopes`, the consent page asks about it at every sign-in, and the token lasts ten minutes with no refresh, so Cursor asks you to sign in again. The consent text for `mcp:write` and what an agent can change with it are in [Connect Claude](./connect-claude.md#what-claude-is-allowed-to-do), and they are the same for Cursor. So is the risk that stays: Cursor's own approval of each tool call is what stops an instruction an agent has read from changing a description, and that approval is Cursor's, not Odudu's.

## 5. Put it back

Open registration is a decision, so close it when you are done with the guide.

```sh {run expect="client_registration_policy"}
docker compose exec odudu odudu seed tenant --name demo --set client_registration_policy=disabled
```

## What the owner still runs by hand

Connect a real Cursor to an instance and record the registration it sends, the revision it negotiates and any step on this page that differs; the project's notes carry it as an open task.
