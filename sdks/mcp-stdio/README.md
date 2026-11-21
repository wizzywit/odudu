# @odudu-io/mcp-stdio

The Odudu admin tools as an MCP server over stdio, for a local MCP client such
as Claude Code or Cursor. The command is `odudu-mcp`, and `odudu mcp` in the
server's CLI runs the same code. It needs Node 24 or later, and neither the
Odudu image nor a checkout.

```sh
npx @odudu-io/mcp-stdio --base-url https://id.example.com --tenant acme
```

## Options

| Option                                  | What it does                                                                                                          |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `--base-url <url>`                      | Address of the Odudu instance, with no path. Required; https unless loopback.                                         |
| `--tenant <name>`                       | The tenant every call is made in. Required.                                                                           |
| `--tenant-address <origin>`             | The https origin a tenant with its own domain signs in at.                                                            |
| `--read-only` / `--allow-writes`        | Read tools only (the default), or ask for `mcp:write` too. Give at most one.                                          |
| `--key-file <file>`, `--client-id <id>` | Sign in as a service account instead of in a browser. `ODUDU_MCP_KEY` and `ODUDU_MCP_CLIENT_ID` hold the same values. |
| `--keygen`                              | Print a new `ODUDU_MCP_KEY` line, and the public key set to register, then exit.                                      |
| `--logout`                              | Forget the stored sign-in for this instance and tenant, then exit.                                                    |
| `--help`                                | Print the options.                                                                                                    |

Standard output carries the protocol and nothing else; every line meant for a
person goes to standard error, and a failure is one line and exit status 1.

## Where the sign-in is kept

A browser sign-in keeps its refresh token in the operating system's credential
store, or in a file under the user's configuration directory (mode 0600, in a
directory only the user can use) when the system has none. A run with
`--allow-writes` keeps nothing. A service account's key is read from
`ODUDU_MCP_KEY` or a file only its owner can read, and is never printed.

## What is API

The command is the API: the package has no root export to import, so start it
as a process from your MCP client. The source also exports `./internal` for the
server's own `odudu mcp` and MCP endpoint; that file is not published and is
outside the semver contract.

The tools it serves come from a catalogue generated from the server's own tool
definitions and built into the package. The server enforces every call, so a stale
file can hide a tool but never widen what a token may do.

Licence: Apache-2.0.
