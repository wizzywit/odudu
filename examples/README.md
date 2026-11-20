# Odudu examples

Each folder here is a small, finished app that works with Odudu. Pick the one that looks like what you are building, copy its folder anywhere, and run it against the stack from the Odudu quick start. Each is short enough to read in one sitting.

| Folder               | What it shows                                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `web-app`            | An app with a server that signs a person in with the authorization code grant and PKCE, and remembers them in a session.  |
| `single-page-app`    | An app that runs in the browser with no secret: it signs a person in with PKCE, keeps the tokens in memory and signs out. |
| `next`               | A Next.js App Router app that signs a person in through a backend for frontend: the tokens stay on the server.            |
| `api`                | An API that decides for itself whether to trust an access token: signature, issuer, audience, type and expiry.            |
| `machine-to-machine` | A service that signs in as itself with a secret and calls the API.                                                        |

## Run one

You need Node 24 or later, and Docker with the quick start stack running.

1. Make the tenant, the clients and the people the examples share. From the folder that holds the quick start's `compose.yaml`, run `examples/_shared/provision.sh` from this repository. It is safe to run twice. It is a handful of `odudu seed` commands, so if you copied one example out on its own, read the script and run the ones that example needs. It makes the people `ada` and `ben`, both with the password `a long and unremarkable passphrase`.
2. In the example's folder, install it. The SDKs are not on npm yet, so an example that uses one is installed from this repository: `../_shared/install.sh . <sdk>` builds the SDKs it names (`oidc`, `bff`, `node`, `next`; the README of each example gives the list) and installs the packed result, and needs `pnpm install` run once at the repository root. `single-page-app` and `machine-to-machine` use no SDK yet and install with `npm ci`. Once the SDKs are published, `npm install` is all a copied folder needs.
3. Run its test with `npm test`. The test starts the app, signs a person in or calls the API, and checks what came back.
4. To use it by hand instead, run `npm start`. The web app listens on `http://localhost:8081`, the single-page app on `http://localhost:8084`, the Next.js app on `http://localhost:8085` and the API on `http://localhost:8082`.

The examples read the stack's address from `ODUDU_BASE` (default `http://localhost:3000`) and the tenant from `TENANT` (default `demo`); the single-page app reads `VITE_ODUDU_BASE` and `VITE_TENANT` instead. If you moved the quick start's port, set the address to match.

## About the secrets

The client secrets in `_shared/provision.sh` are published in this repository, for a stack on your own machine. Anything real reads its secret from the environment of the machine it runs on, and never from a file in the repository.

## Licence

The examples are Apache-2.0. Each folder carries its own copy of the licence.
