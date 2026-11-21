---
title: Call an API as a service
description: Register a service, get an access token as itself with @odudu-io/oidc and call an API with it, then read the token, with commands you can run.
sidebar_position: 8
---

# Call an API as a service

Some callers are not people: a nightly job, a backend that calls another backend. They sign in as themselves, with a secret, and get a token that stands for the service. You will register a service, get a token with `@odudu-io/oidc`, call an API with it and read what the token holds.

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

Register `my-service`. Naming only the `client_credentials` grant tells Odudu this client has no sign-in page, so it needs no redirect address. `--client-credentials-scope` is a scope the service may ask for; it asks for none unless it names one.

```sh {run expect="clientDbId"}
docker compose exec odudu odudu seed client --tenant demo --client-id my-service --client-secret "$SERVICE_SECRET" --grant-type client_credentials --client-credentials-scope reports:read
```

## 3. Get a token with the SDK

[`@odudu-io/oidc`](../sdks/oidc.md) can sign a service in as itself. `createTokenSource` returns a function that gives the service a valid access token: it keeps the token it holds until shortly before it expires, then asks again with the credentials the service already has.

```text
npm install @odudu-io/oidc
```

Until the first release is published, the package is not on npm. Install it from a checkout of this repository by running `../_shared/install.sh . oidc` in the folder of [the machine-to-machine example](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine); it needs Node 24 or later, which the package needs too.

The example is one file, `client.ts`. It makes the token source once and calls the source before each request.

From `examples/machine-to-machine/client.ts`:

```ts
// Gives the token it holds until it is nearly expired, then asks again with the
// credentials the service already has. Calls that arrive together share one
// request. `allowInsecureRequests` lets it talk to an http issuer; never set it
// in production.
const token = createTokenSource(
  {
    issuer: `${BASE}/tenants/${process.env.TENANT ?? 'demo'}`,
    clientId: process.env.CLIENT_ID ?? 'example-m2m',
    // A published value for the local example stack; never reuse it anywhere real.
    auth: { secret: process.env.CLIENT_SECRET ?? 'example-m2m-secret' },
    scope: 'reports:read',
  },
  { allowInsecureRequests: true },
);
```

From `examples/machine-to-machine/client.ts`:

```ts
const reports = await fetch(`${API_URL}/reports`, {
  headers: { authorization: `Bearer ${await token()}` },
  signal: AbortSignal.timeout(10_000),
});
```

A failure is an `OduduError` whose `code` says what Odudu refused, such as `invalid_client` for a wrong secret or `invalid_scope` for a scope the service may not ask for. [`@odudu-io/oidc`](../sdks/oidc.md#errors) lists them. A service that proves itself with a key instead of a secret passes `auth: { privateKey }`; [Use a key instead of a secret](#use-a-key-instead-of-a-secret) below says how to register that.

To run the example as the service you registered above, give it the client, its secret and the API it calls. [Protect an API](./api.md) runs that API. In the example's folder:

```text
CLIENT_ID=my-service CLIENT_SECRET="$SERVICE_SECRET" API_URL=http://localhost:8082 npm start
```

The rest of this guide shows the request the token source makes.

## 4. The request the SDK makes

The service sends its name and secret to the token endpoint. `curl -u` puts them in the `Authorization` header.

```sh {run expect="Bearer"}
RESPONSE=$(curl -fsS -u "my-service:$SERVICE_SECRET" --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token") && printf '%s\n' "$RESPONSE" | sed -E 's/("access_token":"[^"]{12})[^"]*"/\1…"/'
```

You get an access token that lasts five minutes. There is no refresh token and no ID token, and that is by design. A refresh token exists so a person does not have to sign in again, and an ID token says that a person signed in. Here nobody did. When the token expires the service asks again with the credentials it already holds.

## 5. Read the token

A token is a signed document, and its middle part says what it is for. This helper decodes it.

```sh {run}
decode() { local p; p=$(printf '%s' "$1" | cut -d. -f2 | tr '_-' '/+'); while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done; printf '%s' "$p" | openssl base64 -d -A; echo; }
```

```sh {run expect="my-service"}
TOKEN=$(printf '%s' "$RESPONSE" | sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p') && decode "$TOKEN"
```

`sub` is the service's own account, not any person's. `client_id` names the service, `iss` is the tenant that issued the token, and `exp` is when it stops working.

## 6. Call your API with it

The service sends the token in the `Authorization` header, as the example's `fetch` does. This is the shape of the call by hand. The address is yours.

```text
curl -H "Authorization: Bearer $TOKEN" https://api.example.com/reports
```

What your API does with the token is [Protect an API](./api.md).

## 7. Know what a refusal looks like

A service gets a clear refusal when it asks for more than it was given. This one asks for the `openid` scope, which a new service is not allowed.

```sh {run expect="invalid_scope"}
curl -sS -u "my-service:$SERVICE_SECRET" --data-urlencode grant_type=client_credentials --data-urlencode scope=openid "$TENANT/protocol/openid-connect/token"
```

And this one has the wrong secret.

```sh {run expect="invalid_client"}
curl -sS -u "my-service:not-the-secret" --data-urlencode grant_type=client_credentials "$TENANT/protocol/openid-connect/token"
```

[Read a refusal](./read-a-refusal.md) explains the errors Odudu returns and what to do about each.

A service can ask only for the scopes it was registered with, as `--client-credentials-scope` did above; give the flag once for each scope. The service then names the scope in its token request, and the token carries it.

## 8. Call the admin API

A service that calls the admin API asks for the admin API's audience, and what it may do there is the admin capabilities its account holds. `odudu seed client --capability manage-clients` gives one when the client is made, once for each capability. The admin API gives a capability only to a caller that already holds one, so this is how the first service gets its capability, and an administrator changes it afterwards. This registers the client the admin example signs in as:

```text
odudu seed client --tenant demo --client-id example-admin --client-secret example-admin-secret --grant-type client_credentials --audience urn:odudu:params:admin-api --capability manage-clients
```

[`@odudu-io/admin-client`](../sdks/admin-client.md) calls the admin API with the types of its OpenAPI document. Give it a token source whose `resource` is the admin API's audience.

```text
npm install @odudu-io/admin-client
```

Until the first release is published, the package is not on npm. Install it from a checkout of this repository by running `../_shared/install.sh . oidc admin-client me-client` in the folder of [the admin example](https://github.com/wizzywit/odudu/tree/main/examples/admin), which uses all three.

From `examples/admin/admin.ts`:

```ts
// The service signs in as itself. The admin API is its own audience, and what
// the service may do there is the admin capabilities its account holds.
const admin = createAdminClient({
  baseUrl: BASE,
  tenant: TENANT,
  token: createTokenSource(
    {
      issuer: ISSUER,
      clientId: 'example-admin',
      // A published value for the local example stack; never reuse it anywhere real.
      auth: { secret: process.env.CLIENT_SECRET ?? 'example-admin-secret' },
      resource: 'urn:odudu:params:admin-api',
    },
    deps,
  ),
});
```

The client takes the token source as its `token`, so every request carries a fresh token. A response that is not a success becomes a `ProblemError`.

## Use a key instead of a secret

A service can prove who it is with a key pair, so Odudu stores no secret for it. Register the client with `token_endpoint_auth_method` set to `private_key_jwt`, and register its public keys as `jwks`, or as a `jwks_uri` Odudu fetches. Give one or the other, never both, and never a private key.

To get a token, the service signs a short JWT and sends it as `client_assertion`, with `client_assertion_type` set to `urn:ietf:params:oauth:client-assertion-type:jwt-bearer`. The token source does this when you give it `auth: { privateKey }` in place of `auth: { secret }`. This is what the assertion holds.

- `iss` and `sub` are the `client_id`.
- `aud` is the full token endpoint address, as one string. The issuer address alone is refused.
- `exp` is at most five minutes away.
- `jti` is new each time. Odudu refuses one it has seen.

Odudu checks the signature against the registered keys, then the audience, expiry and `jti`. Any failure is the same `invalid_client`. To rotate, publish a new key set. A `jwks_uri` is read again at most every five minutes. [Getting the token](../reference/transcripts/admin-paths/getting-the-token.md) shows a client registered this way.

## Use the machine route for MCP

No MCP client we looked at signs in this way. Claude Code, claude.ai, Claude Desktop and Cursor all sign a person in through the browser, and none of them uses the OAuth client credentials extension for MCP yet, as their documentation stood on 6 November 2026. So an MCP client that signs in as itself is one you write or run: a script, a custom client, or `odudu mcp` with a key, below. The tenant's MCP endpoint does accept such a client when you give it the MCP address as an audience and `mcp:read` among its `client_credentials_scopes`, and the token request names the MCP address as its `resource`: the endpoint then acts as the client's service account, so a tool works only as far as the account's roles reach, and a new account lists just `whoami`. A client without that audience cannot be issued `mcp:read` (`invalid_scope`), and a service account's ordinary token, whose audience is the admin API, is `401` there. This route is for scripts and custom clients. [Protect an MCP server](./protect-an-mcp-server.md) is the route for the clients people use.

## Give a local AI tool the key

`@odudu-io/mcp-stdio` serves the admin tools to an AI tool that runs on your machine, over standard input and output, and a service account can be what it signs in as. `odudu mcp` runs the same code. Make the key with `--keygen`, which prints the `ODUDU_MCP_KEY` line to keep and, on standard error, the key set to register:

```text
npx @odudu-io/mcp-stdio --keygen
```

Until the first release is published, `npx` cannot find the package. From a checkout of this repository, with Node 24 or later, run `pnpm install` and `pnpm --filter "@odudu-io/mcp-stdio..." build` once, and replace `npx @odudu-io/mcp-stdio` with `node /path/to/odudu/sdks/mcp-stdio/dist/bin.js` in every command here.

Register a client the way this guide does, with the `client_credentials` grant, `token_endpoint_auth_method` set to `private_key_jwt`, that key set as its `jwks`, the audience `urn:odudu:params:admin-api` and the scope `mcp:read` in its `client_credentials_scopes`. The tools can then do what the service account's roles let it do, and no more. Start the command with the key in the environment:

```text
ODUDU_MCP_KEY=… npx @odudu-io/mcp-stdio --base-url https://id.example.com --tenant acme --client-id my-agent
```

It offers the read tools only. `--allow-writes` asks for `mcp:write` as well and offers the tools that change a name, a description or the tenant's display name and languages (not those that create a role, group or scope, set or clear a message override or save a theme draft, which only the MCP endpoint offers). Without a key the command opens your browser instead and you sign in as yourself, and the sign-in is kept in your operating system's credential store, or in a file only you can read. [The transcript](../reference/transcripts/request-paths/odudu-mcp-over-stdio.md) runs a handshake and a call, and [`@odudu-io/mcp-stdio`](../sdks/mcp-stdio.md) lists the options. [Connect Claude](./connect-claude.md) puts the command in Claude Desktop's configuration.

## Where to go next

- A service that acts for a person, rather than as itself, uses [token exchange](../reference/transcripts/request-paths/path-d-token-exchange.md).
- Every header of the request above is in [Path C: client credentials](../reference/transcripts/request-paths/path-c-client_credentials.md).
