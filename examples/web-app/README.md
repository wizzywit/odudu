# Web app example

This is a web app with a server that signs a person in with Odudu. The server keeps a secret, so it is a confidential client: it proves who it is when it swaps a sign-in code for tokens. The app is `app.ts`, with one dependency, [`openid-client`](https://github.com/panva/openid-client).

## What happens

1. The person opens `http://localhost:8081` and chooses **Sign in**.
2. The app makes a one-time proof (PKCE), a `state` and a `nonce`, keeps them in a session, and sends the person's browser to Odudu.
3. The person signs in on Odudu's page. The app never sees the password.
4. Odudu sends the browser back with a code. The app checks that `state` is the one it sent and that the answer came from the tenant it started with, then swaps the code for tokens. It checks the ID token's signature and `nonce`.
5. The app shows who signed in. **Sign out** ends the session in the app, then sends the browser to Odudu's end-session address with the ID token as a hint. Odudu asks the person to confirm on its own page, whatever the hint, and then signs them out there too and sends the browser back to the app. The library sends the `client_id` beside the hint, which every OpenID provider accepts; Odudu would find the client from the hint alone.

The redirect address the app sends is built from its own address, so it equals the registered one exactly.

## Run it

You need Node 24 or later and the quick start stack. Run `../_shared/provision.sh` once, then:

```text
npm ci
npm start
```

Open `http://localhost:8081` and sign in as `ada`, whose password is `a long and unremarkable passphrase`: `../_shared/provision.sh` sets it. Choose **Sign out** to end the session here, then confirm at Odudu to end it there too. `npm test` drives a browser through the sign-in, through each check below with a deliberately altered request, and through the sign-out; it needs Chromium from this repository's Playwright.

## What is only for the example

Sessions live in memory and never expire. The cookie is not `Secure` because the example runs over plain http. A production app needs HTTPS, `Secure` cookies and a session store that expires.
