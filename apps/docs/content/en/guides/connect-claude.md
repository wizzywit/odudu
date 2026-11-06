---
title: Connect Claude
description: Connect Claude Code, Claude Desktop and claude.ai to a tenant's MCP endpoint, what each needs, what an agent can change and the risk that stays.
sidebar_position: 13
---

# Connect Claude

Claude reaches an Odudu tenant three ways, and which one you use depends on where the instance is. Claude Code, the terminal tool, connects straight to the tenant's MCP endpoint, and it can do that to an instance on localhost. Claude Desktop can run `odudu mcp`, a local program that talks to the instance for it. claude.ai and the connectors in Claude Desktop are called from Anthropic's servers, so they need an address on the public internet.

You need a tenant set up for MCP clients, which [Protect an MCP server](./protect-an-mcp-server.md) does in its step 4: `client_registration_policy` set to `mcp`, and `cimd_enabled` on if you want Claude Code or claude.ai to identify themselves with their own address. The examples use the quick start's `demo` tenant at `http://localhost:3000`.

## What was checked, and what was not

The Odudu side of this page was run, against a stack built from this repository: the 401 challenge, the two metadata documents, registration under the `mcp` policy, the code flow with PKCE and the `resource` parameter, the token, 42 read tools in each protocol era, and a refused write by a read token. Two clients nobody here wrote did it, the MCP Inspector 2.13.0 and the TypeScript SDK's client 2.4.0, and they run again on every change (`infra/conformance/run-mcp.sh`).

**The steps in Claude's own software were not run by the authors yet.** Claude Code, Claude Desktop and claude.ai are programs this page's authors could not run where it was written. The commands and settings below follow the vendor's documentation as read on 6 November 2026, linked where each is used, and a vendor can change them. Where a block is the vendor's syntax it is tagged `text`, which the guides use for what is shown and not run. If a step differs from what you see, the vendor's page is right about its own software, and a note to the Odudu project is welcome.

## Claude Code, to an instance on localhost

Add the tenant's endpoint as an HTTP server. The command is the one the Claude Code documentation (`https://code.claude.com/docs/en/mcp`) gives for a remote server:

```text
claude mcp add --transport http odudu http://localhost:3000/tenants/demo/mcp
```

Then, inside Claude Code, run `/mcp` and choose the server to sign in. Claude Code finds the sign-in from the `401` the endpoint answers with, reads the tenant's metadata, and registers itself, either by its metadata document or by dynamic registration, whichever the tenant allows. Your browser opens on the tenant's sign-in page, and then on a consent screen that names the client and offers `mcp:read` as a choice you tick. You are then signed in for reading: the 42 tools that read what you could read in the admin API.

Which one Claude Code uses is its choice. A tenant with only `cimd_enabled` on is used by its metadata document, one with the `mcp` policy by registration as well. If the tenant allows neither, Claude Code says the server does not support registration, and you use a client you made, below.

### To change descriptions: a client of your own

A client that registered itself, or came from a metadata document, is never given `mcp:write`, however it asks. To let an agent change the descriptive text of clients and scopes, an administrator makes a client for Claude Code. It is public, its audience is the tenant's MCP address, and `mcp:read` and `mcp:write` are assigned to it as optional scopes. On the server's host, with the commands the other guides use:

```text
docker compose exec odudu odudu seed client --tenant demo --client-id claude-code --public --redirect-uri http://localhost:8080/callback --audience http://localhost:3000/tenants/demo/mcp
docker compose exec odudu odudu seed assign-scope --tenant demo --client-id claude-code --scope mcp:read --assignment optional
docker compose exec odudu odudu seed assign-scope --tenant demo --client-id claude-code --scope mcp:write --assignment optional
```

The same client can be made in the console, under **Clients**, with its **Audiences** on the Advanced tab, or through the admin API with a token that holds `manage-clients`, as [Getting the token](../reference/transcripts/admin-paths/getting-the-token.md) shows; [The MCP write tools](../reference/transcripts/request-paths/the-mcp-write-tools.md) runs exactly that. A client made without the audience is not offered the MCP endpoint.

Claude Code then takes the client id and a fixed callback port, which must match the redirect address registered above (the vendor's documentation, at `https://code.claude.com/docs/en/mcp`, gives `--client-id` and `--callback-port`, for a public client with no secret, and `oauth.scopes` for the scopes it asks for):

```text
claude mcp add --transport http --client-id claude-code --callback-port 8080 odudu http://localhost:3000/tenants/demo/mcp
```

Claude Code asks for the scopes the server lists unless they are pinned, and the vendor's documentation shows pinning in the server's `oauth` object in `.mcp.json`. If it does not ask for `mcp:write` by itself, add `"scopes": "mcp:read mcp:write"` there. That `.mcp.json` combination of `clientId`, `callbackPort` and `scopes` is assembled from two of the vendor's examples and is the least certain step on this page.

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

None of this was run against Anthropic's servers by the authors, who had no public address to run it from. The Inspector and the SDK client run the same discovery and sign-in against the endpoint on every change, and that is all this page claims.

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
