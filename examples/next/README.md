# Next.js example

A Next.js App Router app that signs a person in with Odudu through `@odudu-io/next`. The server keeps the tokens in a session store and the browser holds only an HttpOnly cookie with an opaque id.

## What is in it

- `lib/odudu.ts` creates the handlers once with `createOduduHandlers`.
- `app/api/auth/[...odudu]/route.ts` exports them. They answer `/api/auth/login`, `/callback`, `/logout`, `/session` and `/proxy/...`.
- `app/page.tsx` and `app/dashboard/page.tsx` are server components that call `getSession()`, which returns the claims of the signed-in person and never a token. It only reads the session store; it never refreshes, so a stale access token still reads as signed in and the route handlers renew it.
- `proxy.ts` sends a request for `/dashboard` that has no session cookie to `/api/auth/login`, with the page as `returnTo`. Before Next 16 the file was `middleware.ts`; this package needs Next 16. This is a gate for the page and not authorization, because the check sees only that a cookie shaped like a session id is there. Authorization is `getSession()` in the server component, as `app/dashboard/page.tsx` shows; an app with private data must check it there.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once: it makes the client `example-next` (confidential, redirect address `http://localhost:8085/api/auth/callback`) and the person `ada`.

Run `npm install`. To run it against a checkout of this repository instead, for a change that is not released yet, use `../_shared/install.sh . oidc bff next` in place of `npm install`; it builds and packs the SDKs and installs the result, and needs `pnpm install` run once at the repository root. Then:

```text
npm run build
npm start
```

Open `http://localhost:8085` and sign in as `ada`, whose password is `a long and unremarkable passphrase`. `npm test` builds the app, starts it and signs a person in with plain requests.

## What is only for the example

The sessions live in the memory of one process. Several processes, or a serverless target, need a `store` of their own. The cookie is `Secure`, which Chrome accepts on `localhost` and Safari may not.
