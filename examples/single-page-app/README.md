# Single-page app example

This is a single-page app that signs a person in with Odudu from the browser. Everything in a single-page app can be read by anyone who opens it, so it keeps no secret. It is a public client: instead of a secret it uses PKCE, a one-time proof that only the app that started a sign-in can finish it. The app is `src/main.ts`, with one dependency, [`oauth4webapi`](https://github.com/panva/oauth4webapi). [Vite](https://vite.dev) builds and serves it.

## What happens

1. The person opens `http://localhost:8084` and chooses **Sign in**.
2. The app makes a one-time proof (PKCE), a `state` and a `nonce`, keeps the three in the tab's session storage, and sends the browser to Odudu.
3. The person signs in on Odudu's page. The app never sees the password.
4. Odudu sends the browser back to `/callback` with a code. The app takes the three values out of session storage and deletes them, checks that `state` is the one it sent, and swaps the code for tokens by calling Odudu's token address from the browser. It sends the proof, and no secret, because it has none. It checks the ID token's signature and `nonce`.
5. The app shows who signed in and when the access token expires. **Sign out** forgets the tokens and sends the browser to Odudu's end-session address with the ID token as a hint. Odudu asks the person to confirm on its own page, whatever the hint, and then signs them out there too and sends the browser back to the app. The app sends its `client_id` beside the hint, which every OpenID provider accepts; Odudu would find the client from the hint alone.

The redirect address the app sends is built from its own address, so it equals the registered one exactly.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once, then:

```text
npm ci
npm start
```

Open `http://localhost:8084` and sign in as `ada`, whose password is `a long and unremarkable passphrase`: `../_shared/provision.sh` sets it. `npm test` builds the app, serves it, and drives a browser through the sign-in, through each check below with a deliberately altered request, and through the sign-out; it needs Chromium from this repository's Playwright.

The app reads the stack's address from `VITE_ODUDU_BASE` (default `http://localhost:3000`) when it is built or started, and the tenant from `VITE_TENANT` (default `demo`).

## Letting the browser call Odudu

A browser lets a page read an answer from another origin only if that origin allows it. Odudu allows the origins registered as a client's web origins, and no others. The app's origin is registered with `--web-origin` when the client is made:

```text
odudu seed client --tenant demo --client-id example-spa --public \
  --grant-type authorization_code \
  --redirect-uri http://localhost:8084/callback \
  --post-logout-redirect-uri http://localhost:8084/ \
  --web-origin http://localhost:8084
```

Without `--web-origin` the sign-in reaches the token address and the browser then refuses to hand the answer to the app.

## Where the tokens are kept

In a variable, and nowhere else. Web storage can be read by any script that runs on the page, so a script someone slips into the app could read tokens kept there and send them away. A variable can be read by such a script too while the page is open, but it is gone when the tab closes, and it cannot be copied out of storage later.

The price is that a reload signs the person out of the app. The app does not hide that: it shows the signed-out page and the person chooses **Sign in** again. Odudu still holds the person's own session, so the second sign-in usually returns at once without asking for the password.

The same goes for the access token's life, which is short. This app calls no API, so after the token lapses the page still says signed in; an app that calls an API checks the expiry before each call and signs the person in again once it has passed.

A refresh token could get new tokens without sending the person anywhere, but one kept in the page is the longest-lived thing there to steal, so this app never gets one: it is registered with only the `authorization_code` grant, and Odudu issues a refresh token only to a client that has the `refresh_token` grant. If your app needs to stay signed in for hours, the guide “Refresh and end a session” in Odudu's documentation shows what Odudu does with refresh tokens, and the usual answer is a small server of your own that holds them, which is the [web app example](../web-app).

## What is only for the example

The app is served over plain http, and `allowInsecureRequests` lets the library talk to an http issuer; a real app is served over HTTPS and never sets it. The short-lived values wait in session storage while the person is on Odudu's page: they cannot wait in a variable, because the page is replaced when the browser leaves.
