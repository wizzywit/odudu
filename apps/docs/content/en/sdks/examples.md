---
title: Examples
description: 'Nine small apps that use the SDKs against a live stack: what each shows, how to run it, what its test checks and the lines that matter.'
sidebar_position: 11
---

# Examples

The `examples/` folder of the repository holds nine small, finished apps that use the SDKs. Pick the one that looks like what you are building, read its source in one sitting, and run its test against your own stack. Each folder holds the app, a README and a test.

| Folder                                      | What it shows                                                              |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| [`web-app`](#web-app)                       | A server that signs a person in and keeps a session.                       |
| [`single-page-app`](#single-page-app)       | A browser app with no secret and tokens in memory.                         |
| [`react-bff`](#react-bff)                   | A React page that signs in through a backend for frontend.                 |
| [`next`](#next)                             | A Next.js app that signs in through a backend for frontend.                |
| [`api`](#api)                               | An API that checks an access token itself.                                 |
| [`machine-to-machine`](#machine-to-machine) | A service that signs in as itself and calls the API.                       |
| [`admin`](#admin)                           | A script that calls the admin API as a service and the me API as a person. |
| [`python`](#python)                         | The admin client and a token-checking route in Python.                     |
| [`mcp`](#mcp)                               | An MCP client that starts `odudu-mcp` and calls a tool.                    |

## What an example needs

You need Node 24 or later (Python 3.10 or later for `python`), Docker, and the stack from the [quick start](../quick-start/index.mdx) running. Every example signs in to the tenant `demo` of that stack, so run `examples/_shared/provision.sh` from this repository once, from the folder that holds the quick start's `compose.yaml`. It makes the tenant's clients, the services and the people `ada` and `ben` that the examples share, and it is safe to run twice. Set `ODUDU_BASE` when you run it if the stack is not on port 3000, because it sets the audience of the `admin` example's sign-in client from it. A second run does not repair a client made by an older version of the script or made without `--capability`; reset the stack for that. The client secrets in it are published in the repository, for a stack on your own machine; a real service reads its secret from the environment of the machine it runs on.

An example installs the published SDKs with `npm install` (`pip` for `python`). To run it against this repository instead, for a change that is not released yet, `examples/_shared/install.sh` builds the SDKs you name, packs them and installs the packed files beside the example's other dependencies, leaving its `package.json` unchanged; it needs `pnpm install` run once at the repository root, and you name every SDK that one you name depends on too. `examples/_shared/install-python.sh` makes a virtual environment and installs the `odudu` package from a wheel it builds. Each section below shows the commands for its example. A copied Node folder needs only `npm install`, except that `mcp` also needs the two packages its test uses, and the `react-bff` test needs its own Playwright.

Each example reads the stack's address from `ODUDU_BASE` (default `http://localhost:3000`) and the tenant from `TENANT`; `single-page-app` reads `VITE_ODUDU_BASE` and `VITE_TENANT` instead. By hand, `npm start` listens on port 8081 for `web-app`, 8082 for `api`, 8083 for `react-bff` (its small API on 8093), 8084 for `single-page-app` and 8085 for `next`; `admin` listens on 8086 while a person signs in, and the Python API runs on 8087 when started as its README shows. The examples that sign a person in at a page (`web-app`, `single-page-app`, `react-bff` and `admin`) drive a browser in their test, with the Playwright of this repository.

The examples talk to your stack over plain http, so they set `allowInsecureRequests` (`allowInsecureIssuers` in the API, `allow_insecure_issuers` in Python). A real app serves over https and never sets them. The two sign-in examples, `web-app` and `single-page-app`, do not check the ID token's signature: it arrives straight from the token endpoint over TLS, which OpenID Connect Core section 3.1.3.7 accepts in place of a check. An ID token that reaches you any other way needs its signature checked.

Below, each excerpt is copied from the file its caption names, and the list of tests is the list of titles in the test file.

## `web-app`

A server that signs a person in with the authorization code grant and PKCE, as a confidential client, and remembers them in a session it keeps itself. It uses [`@odudu-io/oidc`](./oidc.md) alone: the server renders its own pages, so it needs no backend for frontend. The code is `app.ts`. The sign-in starts at `/login`, which keeps the record `beginSignIn` returns in the session, and finishes at `/callback`. The example keeps sessions in memory and sets no `Secure` flag on its cookie because it runs over plain http; a real app does neither.

```text
cd examples/web-app
../_shared/install.sh . oidc
npm test
```

From `examples/web-app/app.ts`:

```ts
import { beginSignIn, completeSignIn, OduduError, signOutUrl, type Pending } from '@odudu-io/oidc';
```

From `examples/web-app/app.ts`:

```ts
    // `pending` holds the PKCE verifier, the state and the nonce for the round trip.
    beginSignIn(
      {
        issuer: ISSUER,
        clientId: CLIENT_ID,
        redirectUri: `${ORIGIN}/callback`,
        scope: 'openid profile',
      },
      deps,
    ).then(
      ({ url: target, pending }) => redirect(target, cookieFor(begin({ pending }))),
```

From `examples/web-app/app.ts`:

```ts
// Checks state, the issuer and the ID token's issuer, audience, expiry and nonce, and
// sends the PKCE verifier with the code. The signature is not checked.
completeSignIn(url.href, pending, { auth: { secret: SECRET } }, deps).then(
```

Its test file `test.ts` drives a browser through the sign-in, through each check with a deliberately altered request, and through the sign-out:

- sends the browser to Odudu with state, nonce, PKCE and the registered redirect address
- signs a person in and shows who they are
- refuses a callback whose state is not the one it issued, though the code is valid
- refuses an ID token minted for another sign-in, by its nonce
- refuses a code that was bound to a different PKCE proof
- refuses a callback with no sign-in under way
- refuses the same callback twice
- signs out of the app and of Odudu, so the next sign-in asks again

[Open `web-app` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/web-app). The guide [Sign people in to a web app](../guides/web-app.md) explains each step.

## `single-page-app`

An app that runs in the browser and keeps no secret. It is a public client: PKCE stands in for the secret, the tokens live in a variable, and a reload signs the person out of the app. It uses [`@odudu-io/oidc`](./oidc.md) directly, and Vite builds it. The client is registered with the app's origin as a web origin, which is what lets the browser read Odudu's token answer. [The core without React](./core-without-react.md) walks through the same steps.

```text
cd examples/single-page-app
../_shared/install.sh . oidc
npm test
```

From `examples/single-page-app/src/main.ts`:

```ts
async function signIn(): Promise<void> {
  const { url, pending } = await beginSignIn(
    { issuer: ISSUER, clientId: CLIENT_ID, redirectUri: REDIRECT_URI, scope: 'openid profile' },
    deps,
  );
  sessionStorage.setItem(PENDING, JSON.stringify(pending));
  location.assign(url);
}
```

From `examples/single-page-app/src/main.ts`:

```ts
const stored = sessionStorage.getItem(PENDING);
// A callback can be used once: the record it needs is gone after the first.
sessionStorage.removeItem(PENDING);
if (stored === null) throw new Error('No sign-in is under way');
// Checks the state and the issuer, exchanges the code and checks the ID token's issuer,
// audience, expiry and nonce, not its signature.
return completeSignIn(location.href, JSON.parse(stored) as Pending, {}, deps);
```

Its test file `test.ts` builds the app, serves it, and drives a browser through the sign-in, the checks and the sign-out:

- sends the browser to Odudu with state, nonce, PKCE and the registered redirect address
- signs a person in, shows who and when the token expires, keeps tokens out of storage and signs in again after a reload
- refuses a callback whose state is not the one it issued, though the code is valid
- refuses an answer that names another issuer
- refuses an ID token minted for another sign-in, by its nonce
- refuses a code that was bound to a different PKCE proof
- refuses the same callback twice, because the values it needs are gone
- refuses a callback with no sign-in under way
- lets the app's origin call Odudu from a browser, and no other origin
- signs out of the app and of Odudu, so the next sign-in asks again

[Open `single-page-app` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app). The guide [Sign people in to a single-page app](../guides/single-page-app.md) explains each step.

## `react-bff`

A React 19 page that signs a person in through a backend for frontend. The page uses [`@odudu-io/react`](./react.md) in `bff` mode, and a small Express server uses [`@odudu-io/bff`](./bff.md) to run the sign-in. The server keeps the tokens; the browser holds only an HttpOnly cookie with an opaque id, so no script on the page can read a token. [Backend for frontend](../concepts/backend-for-frontend.mdx) explains the pattern.

```text
cd examples/react-bff
../_shared/install.sh . oidc bff react
npm test
```

From `examples/react-bff/server.ts`:

```ts
const bff = createBff({
  issuer: `${BASE}/tenants/${process.env.TENANT ?? 'demo'}`,
  clientId: process.env.CLIENT_ID ?? 'example-react-bff',
  // A published value for the local example stack; never reuse it anywhere real.
  clientSecret: process.env.CLIENT_SECRET ?? 'example-react-bff-secret',
  redirectUri: `${ORIGIN}/bff/callback`,
  postLogoutRedirectUri: `${ORIGIN}/`,
  scope: 'openid profile',
  // The routes live under /bff, the proxy at /bff/proxy/api/...; the proxy calls
  // only what is listed here, with the session's access token.
  mountPath: '/bff',
  upstreams: [{ name: 'api', origin: `http://127.0.0.1:${API_PORT}`, pathPrefixes: ['/hello'] }],
  deps: { allowInsecureRequests: true },
});
```

From `examples/react-bff/src/main.tsx`:

```tsx
  // `baseUrl` is where the server mounts the BFF routes.
  <OduduProvider mode={{ kind: 'bff', baseUrl: '/bff' }}>
```

Its test file `test.ts` builds the page, starts the server and drives a browser through the sign-in, the proxied call and the sign-out, checking along the way that no token reaches the page or its storage:

- starts signed out, and the session route says so without a cookie
- signs a person in, shows their claims and holds no token the page can read
- signs out of the app and of Odudu

The server keeps its sessions in the memory of one process, so several processes need a `store` of their own, and the session cookie is `Secure`, which Chrome accepts on `localhost` and Safari may not.

[Open `react-bff` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/react-bff).

## `next`

A Next.js App Router app that signs a person in through [`@odudu-io/next`](./next.md). The route handlers run the backend for frontend, server components read the person with `getSession()`, and `proxy.ts` sends a request for a protected page that has no session cookie to sign in. That gate is not authorization: the page checks the session itself.

```text
cd examples/next
../_shared/install.sh . oidc bff next
npm test
```

From `examples/next/lib/odudu.ts`:

```ts
export const { GET, POST, PUT, PATCH, DELETE, getSession } = createOduduHandlers({
  issuer: `${base}/tenants/${tenant}`,
  clientId: 'example-next',
  clientSecret: 'example-next-secret',
  redirectUri: `${origin}/api/auth/callback`,
  postLogoutRedirectUri: `${origin}/`,
  scope: 'openid profile offline_access',
  deps: { allowInsecureRequests: base.startsWith('http://') },
});
```

From `examples/next/proxy.ts`:

```ts
export const proxy = withAuth({ paths: ['/dashboard'] });
```

Its test file `test.ts` builds the app, starts it and signs a person in with plain requests:

- signs a person in, shows them to a server component and sends them where they were going
- sends a request for a protected page without a session to sign in
- does not send the person to a returnTo on another site

The sessions live in the memory of one process, and the `Secure` cookie may be refused by Safari on `localhost`. The `offline_access` scope in the excerpt is not what gets a refresh token: the client's `refresh_token` grant is. The scope makes the grant independent of the sign-in session, so the session no longer bounds it.

[Open `next` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/next).

## `api`

An API that decides for itself whether to trust an access token, without asking Odudu on each request. It uses [`@odudu-io/node`](./node.md), which checks the signature against the tenant's published keys, the issuer, the audience, the token type and the expiry. A valid token without the scope is a `403`; a token it cannot trust is a `401`.

```text
cd examples/api
../_shared/install.sh . node
npm test
```

From `examples/api/server.ts`:

```ts
// Checks the signature against the tenant's published keys, the issuer, the
// audience, the token type (which keeps an ID token out) and the expiry.
// `allowInsecureIssuers` lets it trust an http issuer; never set it in production.
const verifier = createVerifier({
  issuers: [ISSUER],
  audience: AUDIENCE,
  allowInsecureIssuers: true,
});
```

From `examples/api/server.ts`:

```ts
// A valid token without the scope is a 403, because the caller is known and
// not allowed; a 401 means the token itself is not trusted.
const reports = withToken(
  verifier,
  (_request, response, token) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ caller: token.clientId ?? token.sub, reports: ['q1', 'q2'] }));
  },
  { scope: 'reports:read', onError: (error) => console.error(String(error)) },
);
```

Its test file `test.ts` gets tokens from your stack and calls the API with them:

- answers a service holding an access token
- refuses a service whose token has no scope, with 403 and not 401
- refuses a person whose access token has no scope for this API
- refuses a call with no token
- refuses a token issued for another audience
- refuses an ID token

[Open `api` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/api). The guide [Protect an API](../guides/api.md) explains the checks.

## `machine-to-machine`

A service that is not a person: a nightly job, or a backend calling another backend. It signs in as itself with a secret and calls the `api` example. It uses the token source of [`@odudu-io/oidc`](./oidc.md), which keeps the token and asks again shortly before it expires.

```text
cd examples/machine-to-machine
../_shared/install.sh . oidc
../_shared/install.sh ../api node
npm test
```

The second install line is for the test, which starts the `api` example itself.

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

Its test file `test.ts` starts the API, runs the client and checks the token requests it makes:

- gets a token as itself and calls the API with it
- is refused with the wrong secret
- asks for a token once, and again only when the one it holds is about to expire
- makes one token request when two calls arrive together

[Open `machine-to-machine` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine). The guide [Call an API as a service](../guides/machine-to-machine.md) explains the grant.

## `admin`

One script that uses two clients: [`@odudu-io/admin-client`](./admin-client.md) as a service, and [`@odudu-io/me-client`](./me-client.md) as a person. As a service it makes a client, finds it in the tenant's list and deletes it. Then a person signs in at an address the script prints, and the script reads their own profile with a token for the me API. The sign-in uses [`@odudu-io/oidc`](./oidc.md).

```text
cd examples/admin
../_shared/install.sh . oidc admin-client me-client
npm test
```

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

From `examples/admin/admin.ts`:

```ts
const me = createMeClient({ baseUrl: BASE, tenant: TENANT, token: meToken });
const profile = await me.GET('/tenants/{tenant}/me/profile');
```

Its test file `test.ts` runs the script and signs the person in with a browser:

- creates a client, reads it back by listing, deletes it and reads the signed-in profile
- removes a client an earlier run left behind, and leaves nothing behind itself

[Open `admin` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/admin).

## `python`

The Python package [`odudu`](./python.md) in two small files. `admin.py` makes a client with the admin client, reads it back and deletes it. `app.py` is a FastAPI API that checks an access token itself, with `odudu.verify`, and requires a scope on one route. The folder is a set of scripts, not an installable package.

```text
cd examples/python
../_shared/install-python.sh .
.venv/bin/python -m pytest
```

From `examples/python/app.py`:

```python
# Odudu always puts the tenant's address in a token's audience, beside any audience the client
# is registered for. An API that trusts the tenant's address trusts every token of the tenant:
# register an audience on the client and pass it here.
verifier = AsyncVerifier(
    [ISSUER], os.environ.get("API_AUDIENCE", ISSUER), allow_insecure_issuers=True
)
```

From `examples/python/app.py`:

```python
# A valid token without the scope is a 403, because the caller is known and not allowed; a 401
# means the token itself is not trusted.
@app.get("/reports")
async def reports(
    token: VerifiedToken = Depends(require_token(verifier, scope="reports:read")),  # noqa: B008
) -> dict[str, object]:
    return {"caller": token.client_id or token.sub, "reports": ["q1", "q2"]}
```

Its test file `test_example.py` runs the script and calls the API through FastAPI's test client with tokens from your stack:

- the script makes a client then reads it back and deletes it
- a client left by a crashed run is removed first
- a request without a token is refused with a challenge
- a token with the scope is let through
- a valid token without the scope is forbidden
- something that is not a token is refused

[Open `python` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/python).

## `mcp`

An MCP client that starts `odudu-mcp`, the Odudu admin tools as a Model Context Protocol server over standard input and output, and calls the `list_clients` tool. It uses [`@odudu-io/mcp-stdio`](./mcp-stdio.md) for the command and the MCP TypeScript SDK (`@modelcontextprotocol/client`) for the client. The service account's private key travels in the environment variable `ODUDU_MCP_KEY`, not in an argument.

```text
cd examples/mcp
../_shared/install.sh . mcp-stdio oidc admin-client
npm test
```

From `examples/mcp/client.ts`:

```ts
const transport = new StdioClientTransport({
  // `--no-install` runs the command this folder installed and never fetches a package by that name.
  command: 'npx',
  args: [
    '--no-install',
    'odudu-mcp',
    // The address is accepted over http because it is a loopback address.
    ...['--base-url', process.env.ODUDU_BASE ?? 'http://localhost:3000'],
    ...['--tenant', process.env.TENANT ?? 'demo'],
    ...['--client-id', process.env.ODUDU_MCP_CLIENT_ID ?? 'example-mcp'],
  ],
  env,
  // What the command says about a failure goes to this terminal.
  stderr: 'inherit',
});
```

Its test file `test.ts` makes a key, registers its public half through the admin client, runs the client and checks the result:

- lists the tools and calls list_clients as the service account
- stops with one line when it has no key

[Open `mcp` on GitHub](https://github.com/wizzywit/odudu/tree/main/examples/mcp). The guide [Connect Claude](../guides/connect-claude.md) explains the command.
