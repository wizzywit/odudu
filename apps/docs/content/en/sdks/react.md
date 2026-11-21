---
title: '@odudu-io/react'
description: A provider, two components and four hooks that sign a person in to a React app, with tokens kept on a server by a BFF or in memory in the browser.
sidebar_position: 3
---

# @odudu-io/react

This package puts a signed-in person into a React tree. It runs in one of two modes: `bff`, where a server you run keeps the tokens and the page holds only a cookie, or `browser`, where the page runs the sign-in itself and keeps the tokens in memory.

## Install

```text
npm install @odudu-io/react
```

It needs React 19 (`react` and `react-dom` are peer dependencies), and its `engines` field names Node 24 or later. It depends on [`@odudu-io/oidc`](./oidc.md), which installs with it. For `bff` mode you also run [`@odudu-io/bff`](./bff.md) or [`@odudu-io/next`](./next.md) on a server.

## The shortest use

This is the page of [the React and BFF example](https://github.com/wizzywit/odudu/tree/main/examples/react-bff). The server mounts the BFF's routes under `/bff`.

```tsx
import { createRoot } from 'react-dom/client';
import { OduduProvider, SignedIn, SignedOut, useAuth, useUser } from '@odudu-io/react';

function Account() {
  const { signOut } = useAuth();
  const claims = useUser();
  return (
    <>
      <p>Signed in as {String(claims?.preferred_username ?? claims?.sub)}</p>
      <button onClick={signOut}>Sign out</button>
    </>
  );
}

function Welcome() {
  const { signIn } = useAuth();
  return <button onClick={() => signIn()}>Sign in</button>;
}

createRoot(document.getElementById('root') ?? document.body).render(
  <OduduProvider mode={{ kind: 'bff', baseUrl: '/bff' }}>
    <SignedOut>
      <Welcome />
    </SignedOut>
    <SignedIn>
      <Account />
    </SignedIn>
  </OduduProvider>,
);
```

This block is illustrative: the example it comes from is run by the repository's CI.

## What it exports

| Export                      | What it does                                                                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `<OduduProvider mode>`      | Holds the session for its children. `mode` is read once, when the provider mounts; changing it later has no effect.                          |
| `<SignedIn>`                | Renders its children only when `status` is `signedIn`.                                                                                       |
| `<SignedOut>`               | Renders its children only when the person is signed out and no `error` is set.                                                               |
| `useAuth()`                 | Returns `{ status, signIn, signOut, error }`. `status` is `loading`, `signedOut` or `signedIn`.                                              |
| `useUser()`                 | The ID token's claims in `browser` mode, or the claims the BFF reports in `bff` mode. `undefined` when nobody is signed in.                  |
| `useAccessToken(resource?)` | Returns a function that resolves to a fresh access token for `resource`, or for the issuer's own audience when omitted. `browser` mode only. |
| `useBffFetch()`             | Returns `(path, init?) => Promise<Response>`, a `fetch` for the BFF's proxy. `bff` mode only.                                                |

## Options

### `bff` mode

| Option    | Required | What it does                                            |
| --------- | -------- | ------------------------------------------------------- |
| `kind`    | yes      | `'bff'`.                                                |
| `baseUrl` | yes      | Where the server mounts the BFF routes, such as `/bff`. |

The page calls `<baseUrl>/session` and `<baseUrl>/logout`, and `signIn()` navigates to `<baseUrl>/login`. The calls to `session`, `logout` and the proxy carry the header `X-Odudu-BFF` and the cookie, to the same origin only.

### `browser` mode

| Option                  | Required | What it does                                                                                  |
| ----------------------- | -------- | --------------------------------------------------------------------------------------------- |
| `kind`                  | yes      | `'browser'`.                                                                                  |
| `issuer`                | yes      | The tenant's issuer.                                                                          |
| `clientId`              | yes      | The client's ID. The client is a public client.                                               |
| `redirectUri`           | yes      | The address Odudu sends the person back to. The provider must be mounted on that page.        |
| `scope`                 | yes      | The scopes to ask for.                                                                        |
| `postLogoutRedirectUri` | no       | Where the person lands after they confirm the sign-out. It must be registered for the client. |
| `allowInsecureRequests` | no       | Lets an `http` issuer through, for a development server only.                                 |

### `signIn(choices?)`

In `browser` mode `signIn` accepts `resource` (a list of APIs), `meAccess` (`'read'` or `'write'`; the client must hold the scope `me:read`, and `me:write` to write), and either `prompt: 'create'` or an `action`, as `beginSignIn` of [`@odudu-io/oidc`](./oidc.md) does. In `bff` mode every sign-in starts at `<baseUrl>/login` and `signIn` with any choice throws an `OduduError` with `invalid_options`: configure the BFF instead.

### `useBffFetch`

The `path` is `<upstream name>/<path>`, the upstream being one the BFF's `upstreams` option names. The call goes to `<baseUrl>/proxy/<name>/<path>`. This works while the BFF's proxy is at `<baseUrl>/proxy`, which is where `mountPath` puts it (`mountPath: '/bff'` with `baseUrl: '/bff'`); a custom `proxyPath` on the server is not known to the client. The BFF marks its own session-ended `401` answers with the header `X-Odudu-Session: ended` and the proxy removes that header from upstream answers. The provider moves to signed out only on a marked `401`: an upstream's own `401` passes through unmarked and does not sign the person out. The response is returned to you either way.

## Errors

`useAuth().error` is an `OduduError` from [`@odudu-io/oidc`](./oidc.md), or `undefined`. It says why the last session check, sign-in, refresh or sign-out did not work. While it is set `<SignedOut>` renders nothing, so a failed check is never read as a person to sign in again. A clean signed-out is a `401` from the BFF's session route, or a `200` answer with `authenticated: false`.

| Code                   | When                                                                                                                                                                                                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `invalid_options`      | A hook is used outside an `<OduduProvider>`, `useAccessToken` in `bff` mode, `useBffFetch` in `browser` mode, `signIn` with choices in `bff` mode, or `useAccessToken` needing a refresh when there is no refresh token (the person is not signed out). |
| `login_required`       | `useAccessToken` was called with nobody signed in.                                                                                                                                                                                                      |
| `audience_not_granted` | The sign-in carries no access token for the audience asked for. Call `signIn({ resource: [...] })` to ask for it.                                                                                                                                       |
| `invalid_state`        | The redirect answers a sign-in that is gone from this browser tab.                                                                                                                                                                                      |
| `request_failed`       | The BFF answered the sign-out or the session check with a status the package does not expect, or a request could not be completed at all, a network failure among them.                                                                                 |
| `invalid_request`      | An address to navigate to was not an http or https address, so it was not followed.                                                                                                                                                                     |

A refresh the issuer refuses with `invalid_grant` signs the person out. A sign-in the issuer refused or an ID token that failed its checks reports the codes of [`@odudu-io/oidc`](./oidc.md#errors).

## Security notes

- **`bff` mode keeps the tokens out of the page.** The browser holds an `HttpOnly` cookie with an opaque id, and the session answer holds claims and never a token. A script running in the page can act as the person only while the page is open. [`@odudu-io/bff`](./bff.md) says what the server stores and how it protects the cookie. Use this mode wherever you have a server. [Backend for frontend](../concepts/backend-for-frontend.mdx) explains why.
- **`browser` mode keeps the tokens in memory.** They live in a reference inside the provider, in no storage and in no state a component can render. A script that runs in the page can still reach them while it is open. A reload signs the person out of the app, and Odudu still holds their own session, so signing in again usually returns at once.
- **What the package writes to storage.** Only the record the redirect to Odudu needs (the PKCE verifier, the state and the nonce), in `sessionStorage` under the key `odudu.pending`, which stays in one tab and is removed when read. No token is ever stored.
- **Web origin.** In `browser` mode the page reads the token endpoint's answer, and a browser allows that only if the page's origin is registered as a web origin of the client (`odudu seed client --web-origin <origin>`). Without it the sign-in reaches the token address and the browser refuses to hand the answer to the app.
- **Renewal in `browser` mode.** `useAccessToken` renews a token within 30 seconds of expiry through `refresh` of the core. A refresh needs a refresh token, which Odudu issues only to a client that has the `refresh_token` grant.

## Not in this package

- **No token access in `bff` mode.** `useAccessToken` throws there, because the browser holds no token. Call your APIs through the BFF's proxy with `useBffFetch`.
- **No server.** In `bff` mode the page needs a server that runs the BFF. This package does not provide one.
- **No routing and no styled components.** It exports a provider, two conditional components and hooks.

## Examples and neighbours

[The React and BFF example](https://github.com/wizzywit/odudu/tree/main/examples/react-bff) uses this package in `bff` mode with a small Express server. The source is in [`sdks/react`](https://github.com/wizzywit/odudu/tree/main/sdks/react).

`browser` mode runs the core's sign-in in the page; [the core without React](./core-without-react.md) shows those calls without the provider. Next: [`@odudu-io/bff`](./bff.md) is the server for `bff` mode, [`@odudu-io/next`](./next.md) is the same for a Next app, and [`@odudu-io/oidc`](./oidc.md) is the core underneath.
