# Next.js example

A Next.js App Router app that signs a person in with Odudu through `@odudu-io/next`. The server keeps the tokens in a session store and the browser holds only an HttpOnly cookie with an opaque id.

## What is in it

- `lib/odudu.ts` creates the handlers once with `createOduduHandlers`.
- `app/api/auth/[...odudu]/route.ts` exports them. They answer `/api/auth/login`, `/callback`, `/logout`, `/session` and `/proxy/...`.
- `app/page.tsx` and `app/dashboard/page.tsx` are server components that call `getSession()`, which returns the claims of the signed-in person and never a token.
- `proxy.ts` sends a request for `/dashboard` that has no session cookie to `/api/auth/login`, with the page as `returnTo`. On Next 15 the file is `middleware.ts`.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once: it makes the client `example-next` (confidential, redirect address `http://localhost:8085/api/auth/callback`) and the person `ada`.

The example installs the two SDKs from `../../sdks`, so build them first with `pnpm --filter @odudu-io/next build` from the repository root. Then:

```text
npm install
npm run build
npm start
```

Open `http://localhost:8085` and sign in as `ada`, whose password is `a long and unremarkable passphrase`. `npm test` builds the app, starts it and signs a person in with plain requests.

## What is only for the example

The sessions live in the memory of one process. Several processes, or a serverless target, need a `store` of their own. The cookie is `Secure`, which Chrome accepts on `localhost` and Safari does not.
