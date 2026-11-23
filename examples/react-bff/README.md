# React and BFF example

A React 19 page that signs a person in through a backend for frontend (BFF). The page uses `@odudu-io/react` in `bff` mode, and a small Node server uses `@odudu-io/bff` to run the sign-in. The server keeps the tokens; the browser holds only an HttpOnly cookie with an opaque id, so no script on the page can read a token.

## What is in it

- `server.ts` creates the BFF with `createBff` and sets `mountPath: '/bff'` and mounts its routes (`/bff/login`, `/callback`, `/logout`, `/session`, and the proxy at `/bff/proxy`) with the Express router `@odudu-io/bff/express`, then serves the built page from the same origin. Express is the least code here: the router is the whole bridge between Node's request and the BFF's handlers. The BFF is a confidential client and holds the secret.
- `src/main.tsx` wraps the page in `<OduduProvider>` with `{ kind: 'bff', baseUrl: '/bff' }`. `<SignedOut>` shows the sign-in button, `<SignedIn>` shows `useUser()`, the claims the server reports, a button that calls an API through `useBffFetch`, and a sign-out button. The API is a few lines in `server.ts` on port 8093; the BFF's proxy adds the session's access token, and the API answers only whether it got one, so the page shows `{"authenticated":true}` and never the token.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once: it makes the client `example-react-bff` (confidential, redirect address `http://localhost:8083/bff/callback`) and the person `ada`.

Run `npm install`. To run it against a checkout of this repository instead, for a change that is not released yet, use `../_shared/install.sh . oidc bff react` in place of `npm install`; it builds and packs the SDKs and installs the result, and needs `pnpm install` run once at the repository root. Then:

```text
npm start
```

Open `http://localhost:8083` and sign in as `ada`, whose password is `a long and unremarkable passphrase`. `npm test` builds the page, starts the server and drives a browser through the sign-in, checking that the page shows the claims, that the proxied API call works, that the session answer and the page hold no token, that the browser's storage holds none, and that signing out works. The test borrows the repository's Playwright; a copy of this folder needs its own.

## What is only for the example

The sessions live in the memory of one process, so several server processes need a `store` of their own. The server listens on plain http and lets the SDK reach an http issuer, which a production server never does. The session cookie is `Secure`, which Chrome accepts on `localhost` and Safari may not.
