# Web app example

This is a web app with a server that signs a person in with Odudu. The server keeps a secret, so it is a confidential client: it proves who it is when it swaps a sign-in code for tokens. The app is `app.ts`, with one dependency, the `@odudu-io/oidc` SDK. The SDK makes the sign-in request and checks the answer; the app keeps the session.

## What happens

1. The person opens `http://localhost:8081` and chooses **Sign in**.
2. The app makes a one-time proof (PKCE), a `state` and a `nonce`, keeps them in a session, and sends the person's browser to Odudu.
3. The person signs in on Odudu's page. The app never sees the password.
4. Odudu sends the browser back with a code. The app checks that `state` is the one it sent and that the answer came from the tenant it started with, then swaps the code for tokens. It checks the ID token's issuer, audience, expiry and `nonce`; it does not check the signature, because the token comes straight from the token endpoint over TLS, which OpenID Connect Core section 3.1.3.7 accepts in place of a signature check.
5. The app shows who signed in. **Sign out** ends the session in the app, then sends the browser to Odudu's end-session address with the ID token as a hint. Odudu asks the person to confirm on its own page, whatever the hint, and then signs them out there too and sends the browser back to the app.

This app keeps its own session on the server and renders pages from it, so it uses the SDK's core and not the backend for frontend, which is for apps whose browser code reads a JSON session. [`../next`](../next) shows the backend for frontend.

The redirect address the app sends is built from its own address, so it equals the registered one exactly.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once. The SDK is not on npm yet, so install it from this repository, which builds it and installs the packed result (it needs `pnpm install` run once at the repository root):

```text
../_shared/install.sh . oidc
npm start
```

Once `@odudu-io/oidc` is published, `npm install` is all a copy of this folder needs.

Open `http://localhost:8081` and sign in as `ada`, whose password is `a long and unremarkable passphrase`: `../_shared/provision.sh` sets it. Choose **Sign out** to end the session here, then confirm at Odudu to end it there too. `npm test` drives a browser through the sign-in, through each check below with a deliberately altered request, and through the sign-out; it needs Chromium from this repository's Playwright.

## What is only for the example

Sessions live in memory and never expire. The cookie is not `Secure` because the example runs over plain http. A production app needs HTTPS, `Secure` cookies and a session store that expires.
