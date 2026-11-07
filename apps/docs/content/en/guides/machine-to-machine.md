---
title: Call an API as a service
description: Register a service, get an access token for it with the client credentials grant and read what it holds, with commands you can run.
sidebar_position: 8
---

# Call an API as a service

Some callers are not people: a nightly job, a backend that calls another backend. They sign in as themselves, with a secret, and get a token that stands for the service. You will register a service, get a token and read it.

You need the stack from the [quick start](../quick-start/index.mdx) with its `demo` tenant. Run the commands in the folder that holds `compose.yaml`, in bash or zsh, with `curl` and `openssl` installed.

## 1. Point the commands at your server

If you moved the port in the quick start, use that address instead of 3000.

```sh {run}
export ODUDU_BASE="${ODUDU_BASE:-http://localhost:3000}" && export TENANT="$ODUDU_BASE/tenants/demo"
```

## 2. Register the service

Make a secret. It is the service's password, so keep it where only the service can read it.

```sh {run}
SERVICE_SECRET=$(openssl rand -hex 24)
```

Register `my-service`. Naming only the `client_credentials` grant tells Odudu this client has no sign-in page, so it needs no redirect address.

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-service --client-secret "$SERVICE_SECRET" --grant-type client_credentials
```

## 3. Get a token

The service sends its name and secret to the token endpoint. `curl -u` puts them in the `Authorization` header.

```sh {run expect="Bearer"}
RESPONSE=$(curl -fsS -u "my-service:$SERVICE_SECRET" --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$RESPONSE" | sed -E 's/("access_token":"[^"]{12})[^"]*"/\1…"/'
```

You get an access token that lasts five minutes. There is no refresh token and no ID token, and that is by design. A refresh token exists so a person does not have to sign in again, and an ID token says that a person signed in. Here nobody did. When the token expires the service asks again with the credentials it already holds.

## 4. Read the token

A token is a signed document, and its middle part says what it is for. This helper decodes it.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

```sh {run expect="my-service"}
TOKEN=$(printf '%s' "$RESPONSE" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p') && decode "$TOKEN"
```

`sub` is the service's own account, not any person's. `client_id` names the service, `iss` is the tenant that issued the token, and `exp` is when it stops working.

## 5. Call your API with it

The service sends the token in the `Authorization` header. This is the shape of the call. The address is yours.

```text
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/reports
```

What your API does with the token is [Protect an API](./api.md).

## 6. Know what a refusal looks like

A service gets a clear refusal when it asks for more than it was given. This one asks for the `openid` scope, which a new service is not allowed.

```sh {run expect="invalid_scope"}
curl -sS -u "my-service:$SERVICE_SECRET" --data-urlencode grant_type=client_credentials --data-urlencode scope=openid "$TENANT/protocol/openid-connect/token"
```

And this one has the wrong secret.

```sh {run expect="invalid_client"}
curl -sS -u "my-service:not-the-secret" --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token"
```

[Read a refusal](./read-a-refusal.md) explains the errors Odudu returns and what to do about each.

To let a service ask for a scope, register it with `--client-credentials-scope`, once for each scope. The service then names the scope in its token request, and the token carries it.

## 7. Run a finished service

[The machine-to-machine example](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine) is this guide as a single file with no dependencies: it gets a token as itself and calls [the API example](https://github.com/wizzywit/odudu/tree/main/examples/api) with it. Its README says how to run it against your stack.

## Use a key instead of a secret

A service can prove who it is with a key pair, so Odudu stores no secret for it. Register the client with `token_endpoint_auth_method` set to `private_key_jwt`, and register its public keys as `jwks`, or as a `jwks_uri` Odudu fetches. Give one or the other, never both, and never a private key.

To get a token, the service signs a short JWT and sends it as `client_assertion`, with `client_assertion_type` set to `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`.

- `iss` and `sub` are the `client_id`.
- `aud` is the full token endpoint address, as one string. The issuer address alone is refused.
- `exp` is at most five minutes away.
- `jti` is new each time. Odudu refuses one it has seen.

Odudu checks the signature against the registered keys, then the audience, expiry and `jti`. Any failure is the same `invalid_client`. To rotate, publish a new key set. A `jwks_uri` is read again at most every five minutes. [Getting the token](../reference/transcripts/admin-paths/getting-the-token.md) shows a client registered this way.

## Use the machine route for MCP

No MCP client we looked at signs in this way. Claude Code, claude.ai, Claude Desktop and Cursor all sign a person in through the browser, and none of them uses the OAuth client credentials extension for MCP yet, as their documentation stood on 6 November 2026. So an MCP client that signs in as itself is one you write or run: a script, a custom client, or `odudu mcp` with a key, below. The tenant's MCP endpoint does accept such a client when you give it the MCP address as an audience and `mcp:read` among its `client_credentials_scopes`, and the token request names the MCP address as its `resource`: the endpoint then acts as the client's service account, so a tool works only as far as the account's roles reach, and a new account lists just `whoami`. A client without that audience cannot be issued `mcp:read` (`invalid_scope`), and a service account's ordinary token, whose audience is the admin API, is `401` there. This route is for scripts and custom clients. [Protect an MCP server](./protect-an-mcp-server.md) is the route for the clients people use.

## Give a local AI tool the key

`odudu mcp` serves the admin tools to an AI tool that runs on your machine, over standard input and output, and a service account can be what it signs in as. Make the key with `odudu mcp --keygen`, which prints the `ODUDU_MCP_KEY` line to keep and, on standard error, the key set to register:

```text
odudu mcp --keygen
```

Register a client the way this guide does, with the `client_credentials` grant, `token_endpoint_auth_method` set to `private_key_jwt`, that key set as its `jwks`, the audience `urn:odudu:params:admin-api` and the scope `mcp:read` in its `client_credentials_scopes`. The tools can then do what the service account's roles let it do, and no more. Start the command with the key in the environment:

```text
ODUDU_MCP_KEY=… odudu mcp --base-url https://id.example.com --tenant acme --client-id my-agent
```

It offers the read tools only. `--allow-writes` asks for `mcp:write` as well and offers the tools that change a name or a description (not those that create a role, group or scope, which only the MCP endpoint offers). Without a key the command opens your browser instead and you sign in as yourself, and the sign-in is kept in your operating system's credential store, or in a file only you can read. [The transcript](../reference/transcripts/request-paths/odudu-mcp-over-stdio.md) runs a handshake and a call.

## Where to go next

- A service that acts for a person, rather than as itself, uses [token exchange](../reference/transcripts/request-paths/path-d-token-exchange.md).
- Every header of the request above is in [Path C: client credentials](../reference/transcripts/request-paths/path-c-client_credentials.md).
