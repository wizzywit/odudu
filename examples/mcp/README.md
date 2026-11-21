# MCP example

A client that starts `odudu-mcp`, the Odudu admin tools as a Model Context Protocol (MCP) server over standard input and output, and calls one of them. It is one file, `client.ts`, written with the MCP TypeScript SDK (`@modelcontextprotocol/client`) and the `@odudu-io/mcp-stdio` package that provides the command.

## What happens

1. The client starts `odudu-mcp` as a child process with the address of Odudu, the tenant and the client id of a service account. The service account's private key travels in the environment variable `ODUDU_MCP_KEY`, so it is in no argument list.
2. The command signs in as the service account with that key, and the client and the command complete the MCP handshake.
3. The client lists the tools and calls `list_clients`, which returns the tenant's OAuth clients, and prints both. The service account can read only what its admin capabilities allow, here `manage-clients`, so the command offers the tools that capability reaches and the server refuses the rest.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once: it makes the service account `example-mcp`, which may ask for `mcp:read` and holds `manage-clients`.

The SDKs are not on npm yet, so install them from this repository: `../_shared/install.sh . mcp-stdio oidc admin-client` builds and packs them and installs the result, and needs `pnpm install` run once at the repository root. Once they are published, `npm install` is all a copy of this folder needs, apart from the two packages the test uses. Then make the key and register it:

```text
npx odudu-mcp --keygen
```

The command prints a line `ODUDU_MCP_KEY=...` to keep, and on standard error the public key set to register. Register that key set as the `jwks` of the client `example-mcp` with `token_endpoint_auth_method` set to `private_key_jwt`, in the console or through the admin API, then run the client:

```text
ODUDU_MCP_KEY=... npm start
```

`npm test` does these steps itself. It makes a key, keeps it in memory, registers the public half through the admin client, runs the client and checks that `list_clients` is among the tools and that the call returns the provisioned clients. It also checks that the client stops when it has no key.

## What is only for the example

The address is `http://localhost:3000` by default, which `odudu-mcp` accepts because it is a loopback address and refuses for any other host over http. The `example-mcp` secret exists only because a client must be made with one, and the client signs in with its key instead. A real key is made on the machine that uses it and never committed.
