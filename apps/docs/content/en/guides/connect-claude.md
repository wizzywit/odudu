---
title: Connect Claude
description: Connect Claude Code, Claude Desktop and claude.ai to a tenant's MCP endpoint, what each needs, what an agent can change and the risk that stays.
sidebar_position: 13
---

# Connect Claude

Claude reaches an Odudu tenant three ways, and which one you use depends on where the instance is. Claude Code, the terminal tool, connects straight to the tenant's MCP endpoint, and it can do that to an instance on localhost. Claude Desktop can run `odudu mcp`, a local program that talks to the instance for it. claude.ai and the connectors in Claude Desktop are called from Anthropic's servers, so they need an address on the public internet.

You need a tenant set up for MCP clients, which [Protect an MCP server](./protect-an-mcp-server.md) does in its step 4: `client_registration_policy` set to `mcp`, and `cimd_enabled` on if you want Claude Code or claude.ai to identify themselves with their own address. The examples use the quick start's `demo` tenant at `http://localhost:3000`.

## What was checked, and what was not

The Odudu side of this page was run, against a stack built from this repository: the 401 challenge, the two metadata documents, registration under the `mcp` policy, the code flow with PKCE and the `resource` parameter, the token, the read tools in each protocol era, and a refused write by a read token. Two clients nobody here wrote did it, the MCP Inspector 2.13.0 and the TypeScript SDK's client 2.4.0, and they run again on every server change (`infra/conformance/run-mcp.sh`).

**What was run in Claude's own software.** On 6 November 2026 the owner of the project ran Claude Code 2.1.319 and Claude Desktop 3.6556.2, as reported by the owner, against a local instance. In Claude Code the command-line form with `--client-id` and `--callback-port` against a client an administrator made (below) signed in and completed the sign-in inside the session, and the owner's reads, writes with an entity tag, a stale tag, refusals and bad arguments all behaved as this page says. Claude Desktop was run through the `odudu mcp` entry below, with the absolute path to `node`.

**What was not run.** The `.mcp.json` settings (`oauth.scopes`, and the mix of `clientId`, `callbackPort` and `scopes`), Claude Code's own registration by metadata document or by dynamic registration, the claude.ai and Desktop connectors, and `odudu mcp` on Windows and with the Linux Secret Service. Those follow the vendor's documentation as read on 6 November 2026, linked where each is used, and a vendor can change them. Where a block is the vendor's syntax it is tagged `text`, which the guides use for what is shown and not run. If a step differs from what you see, the vendor's page is right about its own software, and a note to the Odudu project is welcome.

## Claude Code, to an instance on localhost

Add the tenant's endpoint as an HTTP server. The command is the one the Claude Code documentation (`https://code.claude.com/docs/en/mcp`) gives for a remote server:

```text
claude mcp add --transport http odudu http://localhost:3000/tenants/demo/mcp
```

Then, inside Claude Code, run `/mcp` and choose the server to sign in. Claude Code finds the sign-in from the `401` the endpoint answers with, reads the tenant's metadata, and registers itself, either by its metadata document or by dynamic registration, whichever the tenant allows. Your browser opens on the tenant's sign-in page, and then on a consent screen that names the client and offers `mcp:read` as a choice you tick. You are then signed in for reading: the tools that read what you could read in the admin API.

Which one Claude Code uses is its choice. A tenant with only `cimd_enabled` on is used by its metadata document, one with the `mcp` policy by registration as well. If the tenant allows neither, Claude Code says the server does not support registration, and you use a client you made, below.

### To change descriptions: a client of your own

A client that registered itself, or came from a metadata document, is never given `mcp:write`, however it asks. To let an agent change the descriptive text of clients and scopes, an administrator makes a client for Claude Code. It is public, its audience is the tenant's MCP address, and `mcp:read` and `mcp:write` are assigned to it as optional scopes. On the server's host, with the commands the other guides use:

A **redirect address** (also called the callback) is where Odudu sends the browser, with the sign-in's result, when you have signed in. A client has to say in advance which addresses it may use, and Odudu sends the browser nowhere else. For Claude Code it is a small web server on your own machine that waits for that one visit, so the address is `localhost` and a port number, as in the example below.

Pick a port nothing else listens on, and check it with `lsof -i :8765`, which prints nothing when the port is free. The guides use 8765 because common local services use 8080. Browsers try `localhost` as the IPv6 address `::1` before the IPv4 one, so a service listening on IPv6 on that port, a container for one, takes the redirect and answers "Resource not found" instead of Claude Code.

A client's **Audiences** setting says which servers a token issued to it may be used at. A client sends the address of the server it means to call as the `resource` of its sign-in (RFC 8707), and Odudu puts that address in the token's `aud` only if the client's Audiences list holds it exactly. The MCP endpoint takes a token only when `aud` names its own address. A client whose list does not hold the address is refused with `invalid_target`, which is why a client made without the audience is not offered the MCP endpoint.

```text
docker compose exec odudu odudu seed client --tenant demo --client-id claude-code --public --redirect-uri http://localhost:8765/callback --audience http://localhost:3000/tenants/demo/mcp
docker compose exec odudu odudu seed assign-scope --tenant demo --client-id claude-code --scope mcp:read --assignment optional
docker compose exec odudu odudu seed assign-scope --tenant demo --client-id claude-code --scope mcp:write --assignment optional
```

The same client can be made in the console, under **Clients**, with its **Audiences** on the Advanced tab, or through the admin API with a token that holds `manage-clients`, as [Getting the token](../reference/transcripts/admin-paths/getting-the-token.md) shows; [The MCP write tools](../reference/transcripts/request-paths/the-mcp-write-tools.md) runs exactly that. A client made without the audience is not offered the MCP endpoint.

Claude Code then takes the client id and a fixed callback port, which must match the redirect address registered above (the vendor's documentation, at `https://code.claude.com/docs/en/mcp`, gives `--client-id` and `--callback-port`, for a public client with no secret, and `oauth.scopes` for the scopes it asks for):

```text
claude mcp add --transport http --client-id claude-code --callback-port 8765 odudu http://localhost:3000/tenants/demo/mcp
```

This command-line form, with `--client-id` and `--callback-port` against a client an administrator made, is what the owner ran on 6 November 2026, and it signed in. Claude Code asks for the scopes the server lists unless they are pinned, and the vendor's documentation shows pinning in the server's `oauth` object in `.mcp.json`. If it does not ask for `mcp:write` by itself, add `"scopes": "mcp:read mcp:write"` there. **That `.mcp.json` pinning, and the `.mcp.json` combination of `clientId`, `callbackPort` and `scopes`, were not run.** They are assembled from two of the vendor's examples and are the least certain step on this page.

## Using the tools

Sign in once with `/mcp` inside Claude Code and choose the server; the browser steps above happen then. After that, ask in plain language, for example "who am I signed in as?", "list the clients in this tenant", "which users logged in this week?" or "what changed in the audit trail today?". Claude picks the tool. Claude Code names an MCP server's tools `mcp__<server>__<tool>`, so for a server added as `odudu` they are `mcp__odudu__whoami`, `mcp__odudu__list_clients` and so on, and it asks you to allow a tool the first time it uses it. Read an answer's data as Claude's account of it: the audit trail has what was actually called.

With a client that holds `mcp:write` you can also ask for a change, for example "rewrite the description of the `claude-code` client to say who runs it" or "add a German text for the description of the scope named `reports`". Claude reads the resource first and sends the entity tag it read; approve the call after reading what it will change.

A failure comes back to Claude as an error it reads and tells you, with a reason such as `mcp:invalid_arguments: id: must be a UUID` for a malformed argument, or a refusal that says the person lacks a capability. A call you did not expect to be refused is in the console's audit trail, as an `agent.tool_call` event with the reason. In Claude Code, `/mcp` shows whether the server is connected and lets you sign in again when the sign-in has ended. Claude Desktop shows a server that failed to start in its own settings, which this page did not check further.

## Claude Desktop, through `odudu mcp`

Claude Desktop starts local programs described in its configuration file, and `odudu mcp` is one: it serves the same tools over standard input and output, and calls the instance as you or as a service account. This is the route for an instance Anthropic's servers cannot reach. The file is `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS and `%APPDATA%\Claude\claude_desktop_config.json` on Windows, which **Settings, Developer, Edit Config** opens, and Claude Desktop has to be quit and started again to read it (the Model Context Protocol's guide (`https://modelcontextprotocol.io/docs/develop/connect-local-servers`) has the steps).

As a person, `odudu mcp` opens your browser to sign in, listens for the answer on a loopback port and keeps the sign-in in your operating system's credential store. It has to run on your machine and not in a container, and the command ships in the Odudu image and in the repository, not yet as a download. From a checkout, with Node 24 and `pnpm install` done, the entry is:

```text
{
  "mcpServers": {
    "odudu": {
      "command": "node",
      "args": [
        "/path/to/odudu/apps/server/src/main.ts",
        "mcp",
        "--base-url", "http://localhost:3000",
        "--tenant", "demo"
      ]
    }
  }
}
```

That is read-only. `odudu mcp --help` lists the flags; `--allow-writes` asks for `mcp:write` instead and offers the two write tools as well.

For a service account, which needs no browser, run the command in the container. The key is passed from the environment, so it is not in the arguments:

```text
{
  "mcpServers": {
    "odudu": {
      "command": "docker",
      "args": [
        "compose", "-f", "/path/to/compose.yaml",
        "exec", "-T", "-e", "ODUDU_MCP_KEY",
        "odudu", "odudu", "mcp",
        "--base-url", "http://localhost:3000",
        "--tenant", "demo",
        "--client-id", "my-agent"
      ],
      "env": { "ODUDU_MCP_KEY": "…the key line's value…" }
    }
  }
}
```

[Call an API as a service](./machine-to-machine.md#give-a-local-ai-tool-the-key) makes the key and registers the account, and [`odudu mcp` over stdio](../reference/transcripts/request-paths/odudu-mcp-over-stdio.md) is a recorded run of the command with a key. Inside the container the address is the container's own, so `--base-url` is `http://localhost:3000` there whichever port you published, and it has to be the address the instance states as its own.

## claude.ai and Claude Desktop's connectors

A connector is added in claude.ai under **Customize, Connectors, Add, Add custom connector**, with the tenant's MCP address, and Claude offers to use its published identity (a client metadata document), to register automatically or to use your own client (the vendor's page (`https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp`)). Anthropic's servers make the calls, and the vendor says the server must be reachable from Anthropic's addresses over the public internet.

An Odudu you downloaded and run on your own machine is not. Say so plainly: it needs a tunnel, or a real deployment, that gives the instance a public `https` address, and the instance has to state that address as its own (`ODUDU_PUBLIC_BASE_URL`, with TLS ended in front of it; [Deploying](../operating/deploying.md) has the settings). The MCP address you give Claude is then that public one. The tenant's `cimd_enabled` setting and `mcp` policy decide whether Claude's published identity or its registration is accepted. Claude's redirect address is `https://claude.ai/api/mcp/auth_callback`, an `https` address that a registered client or one from a metadata document may use.

None of this was run against Anthropic's servers by the authors, who had no public address to run it from. The Inspector and the SDK client run the same discovery and sign-in against the endpoint on every server change, and that is all this page claims.

## What Claude is allowed to do

With `mcp:read`, which any of the routes above gives, Claude can read what the person who signed in can read: users, clients, scopes, groups, roles, sessions, settings and audit events, subject to that person's capabilities in the [admin API](../concepts/roles-and-groups.mdx). The tools it is offered are the ones the person could use, and a call to one they could not is refused and recorded.

With `mcp:write`, the endpoint offers two more tools, and only to a person who holds the capability for each:

- `update_client_metadata` changes a client's name and description and their texts in other languages (`manage-clients`).
- `update_scope_metadata` changes a scope's description and its texts in other languages (`manage-tenant`).

It cannot change a redirect address, a secret, a grant, a role, a user, a key or any setting, and it cannot change a built-in client's name. Each change is an audit event with the agent's client, the person, and the text before and after, so a change is undone by sending the earlier text back. The agent reads a resource first and sends the entity tag it read, so an edit over a change made meanwhile is refused.

`mcp:write` is asked about at **every** sign-in, even for a client you made and even when the person agreed before, and the box is not ticked for them. The token lasts ten minutes at most and has no refresh token, so after ten minutes the person signs in again and is asked again.

### The risk that stays

An agent reads text, and text can carry instructions. A client's name, a scope's description, a username or an audit event is written by someone, and an agent that reads it may follow what it says. With `mcp:write` for a person who may edit clients or scopes, such an instruction can make it edit the **descriptive text** of clients and scopes, and it will. That text is shown to people, on the consent screen for one, so it can mislead them. It cannot change what a client or scope may do, who may sign in, or any secret.

What limits it is real and is not a guarantee: the scope is asked about every time and lasts ten minutes, only those two tools write, the admin API refuses everything else whatever a tool says, and every change is recorded and reversible. What stops it before the first edit is Claude asking you to approve each tool call, and that approval is **Claude's, not Odudu's**. Leave it on for the write tools, and read what a call is about to change. A client that is never assigned `mcp:write` cannot write at all, so give it only to a client that needs it.

## Check it works

Ask Claude who it is signed in as. It should call `whoami` and name you, with the capabilities you hold. Then ask it to list the clients, and look in the console's audit trail for the `agent.tool_call` events that name the tool and your client.

## What the owner still runs by hand

Recorded as an open task in the project's notes: connect real Claude Code, Claude Desktop and claude.ai to an instance and record what each negotiated, the exact registration it sent, and any step on this page that differs.
