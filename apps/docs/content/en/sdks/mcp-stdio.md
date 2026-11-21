---
title: '@odudu-io/mcp-stdio'
description: The Odudu admin tools as an MCP server over standard input and output, for a local AI client such as Claude Code or Cursor, run with npx.
sidebar_position: 9
---

# @odudu-io/mcp-stdio

This package is the command `odudu-mcp`: the Odudu admin tools as an MCP server over stdio, for a local MCP client. It signs a person in through their browser, or a service account in through a private key, and calls an Odudu instance as that caller. `odudu mcp` in the server's command line runs the same code.

## Install

```text
npx @odudu-io/mcp-stdio --base-url https://id.example.com --tenant acme
```

That starts the server and waits for an MCP client on standard input. It needs Node 24 or later, and neither the Odudu image nor a checkout. To install it as a dependency instead, use `npm install @odudu-io/mcp-stdio`, which provides the `odudu-mcp` command.

## The shortest use

An MCP client starts the command and talks to it over standard input and output. This is [the MCP example](https://github.com/wizzywit/odudu/tree/main/examples/mcp), trimmed. The client signs in as a service account whose key travels in the environment, so it is in no argument list.

```ts
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

// The command's environment is what it needs to run and the key, and nothing else.
const env: Record<string, string> = { ODUDU_MCP_KEY: process.env.ODUDU_MCP_KEY ?? '' };
for (const name of ['PATH', 'HOME', 'TMPDIR', 'SystemRoot']) {
  const value = process.env[name];
  if (value !== undefined) env[name] = value;
}

const transport = new StdioClientTransport({
  command: 'npx',
  args: [
    '--no-install',
    'odudu-mcp',
    ...['--base-url', 'https://id.example.com'],
    ...['--tenant', 'acme'],
    ...['--client-id', 'my-agent'],
  ],
  env,
  stderr: 'inherit',
});

const client = new Client({ name: 'my-agent', version: '0.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log(tools.map((tool) => tool.name).join(' '));
await client.close();
```

The block is illustrative: the example it comes from is run by the repository's CI against a live stack. For a person's own client such as Claude Desktop or Cursor, put the same command and arguments in the client's configuration file; [Connect Claude](../guides/connect-claude.md) and [Connect Cursor](../guides/connect-cursor.md) show where, and say what an agent can and cannot change.

To make the service account's key, run the command with `--keygen`. It prints a line `ODUDU_MCP_KEY=...` to keep, and on standard error the public key set to register as the `jwks` of the client, with `token_endpoint_auth_method` set to `private_key_jwt`. [Call an API as a service](../guides/machine-to-machine.md#give-a-local-ai-tool-the-key) shows the registration, and [`odudu mcp` over stdio](../reference/transcripts/request-paths/odudu-mcp-over-stdio.md) is a recorded run.

## Options

| Option                                  | What it does                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`                      | Address of the Odudu instance, with no path. Required; https unless it is a loopback address.                         |
| `--tenant <name>`                       | The tenant every call is made in. Required.                                                                           |
| `--tenant-address <origin>`             | The https origin a tenant with its own domain signs in at. The admin API stays at `--base-url`.                       |
| `--read-only` / `--allow-writes`        | Read tools only (the default), or ask for `mcp:write` too. Give at most one: both is refused.                         |
| `--key-file <file>`, `--client-id <id>` | Sign in as a service account instead of in a browser. `ODUDU_MCP_KEY` and `ODUDU_MCP_CLIENT_ID` hold the same values. |
| `--keygen`                              | Print a new `ODUDU_MCP_KEY` line, and the public key set to register, then exit.                                      |
| `--logout`                              | Forget the stored sign-in for this instance and tenant, then exit.                                                    |
| `--help`                                | Print the options.                                                                                                    |

Give the key once: `ODUDU_MCP_KEY` or `--key-file`, not both. An argument that is not an option is refused.

## Errors

A failure is one line on standard error that starts with `odudu mcp:` and exit status 1. The line names what to change and never carries a token, a key or a response body. A failure that is not one of the command's own refusals is shortened and has query strings and long runs of token characters taken out. Standard output carries the protocol and nothing else.

A tool call that Odudu refuses comes back to the client as a tool result that names the refusal. With `--allow-writes` the command counts the changes a run makes: a call over the allowance is not made and the client is told `mcp:write_budget`. The tools, their scopes and the allowance are described in [Connect Claude](../guides/connect-claude.md).

## Security notes

- **Where the sign-in is kept.** A browser sign-in keeps its refresh token in the operating system's credential store, or in a file under the user's configuration directory (mode 0600, in a directory only the user can use) when the system has none. A run with `--allow-writes` keeps nothing: the token lasts at most ten minutes, is never refreshed or stored, and each sign-in asks you again.
- **The service account key.** It is read from `ODUDU_MCP_KEY` or from a file only its owner can read, and is never printed. Keep it in your platform's secret store, hand it to the command in its environment, and never put it in an argument list or commit it.
- **https and loopback.** `--base-url` must be https unless it is a loopback address.
- **What the tools can do.** The tools come from a catalogue generated from the server's own tool definitions and built into the package. The server enforces every call, so a stale catalogue can hide a tool but never widen what a token may do. What a service account can do is what the admin capabilities of its account allow.
- **The browser sign-in** listens for the answer on a loopback port.
- **`./internal` is not API.** The package exports `./internal` as source for the server's own MCP endpoint. It is not built or published and is outside the semver contract. The root export is the API: `runMcp(io, argv)` runs the command and resolves with its exit status, and `processMcpIo()` builds the `io` from the current process. The pieces `runMcp` is built from are exported beside them.

## Not in this package

- **An MCP endpoint over HTTP.** The command speaks stdio. The tenant's own MCP endpoint, for clients that connect by address, is described in [Protect an MCP server](../guides/protect-an-mcp-server.md).
- **Every tool.** Some write tools are offered only through the tenant's MCP endpoint and not through this command or to a service account: [Connect Claude](../guides/connect-claude.md) lists them.
- **A way to run in a container with a browser sign-in.** The command has to run on the machine where the person's browser is.

## Examples and neighbours

[The MCP example](https://github.com/wizzywit/odudu/tree/main/examples/mcp) starts the command from a client, signs in as a service account and calls `list_clients`. The source is in [`sdks/mcp-stdio`](https://github.com/wizzywit/odudu/tree/main/sdks/mcp-stdio).

Next: [`@odudu-io/admin-client`](./admin-client.md) for the same admin API from code, and [Connect Claude](../guides/connect-claude.md) and [Connect Cursor](../guides/connect-cursor.md) for the clients.
