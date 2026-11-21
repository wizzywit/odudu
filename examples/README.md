# Odudu examples

Each folder here is a small, finished app that works with Odudu. Pick the one that looks like what you are building, copy its folder anywhere once the SDKs are published (until then use `_shared/install.sh` or `_shared/install-python.sh`, as each README says), and run it against the stack from the Odudu quick start. Each is short enough to read in one sitting.

| Folder               | What it shows                                                                                                                 | SDK                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `web-app`            | An app with a server that signs a person in with the authorization code grant and PKCE, and remembers them in a session.      | `@odudu-io/oidc`                                      |
| `single-page-app`    | An app that runs in the browser with no secret: it signs a person in with PKCE, keeps the tokens in memory and signs out.     | `@odudu-io/oidc`                                      |
| `react-bff`          | A React page that signs a person in through a backend for frontend: the tokens stay on the server, and the page shows claims. | `@odudu-io/react`, `@odudu-io/bff`                    |
| `next`               | A Next.js App Router app that signs a person in through a backend for frontend: the tokens stay on the server.                | `@odudu-io/next`                                      |
| `api`                | An API that decides for itself whether to trust an access token: signature, issuer, audience, type and expiry.                | `@odudu-io/node`                                      |
| `machine-to-machine` | A service that signs in as itself with a secret and calls the API.                                                            | `@odudu-io/oidc`                                      |
| `admin`              | A script that makes, finds and deletes a client as a service, and reads a signed-in person's own profile.                     | `@odudu-io/admin-client`, `@odudu-io/me-client`       |
| `python`             | The same admin calls in Python, and a FastAPI route that verifies an access token and its scope.                              | `odudu` (PyPI)                                        |
| `mcp`                | An MCP client that starts `odudu-mcp` with a service account's key and calls the `list_clients` tool.                         | `@odudu-io/mcp-stdio`, `@modelcontextprotocol/client` |

## Run one

You need Node 24 or later, and Docker with the quick start stack running.

1. Make the tenant, the clients and the people the examples share. From the folder that holds the quick start's `compose.yaml`, run `examples/_shared/provision.sh` from this repository. It is safe to run twice. It is a handful of `odudu seed` commands and one SQL statement that gives the service accounts of `admin` and `mcp` the capability to manage clients (`odudu seed` has no command for that), so if you copied one example out on its own, read the script and run what that example needs. If the stack is not on port 3000, set `ODUDU_BASE` to its address first, because the client `admin` signs in with names the address of the tenant's own account API. It makes the people `ada` and `ben`, both with the password `a long and unremarkable passphrase`.
2. In the example's folder, install it. The SDKs are not on npm or PyPI yet, so an example is installed from this repository. For a Node example, `../_shared/install.sh . <sdk>` builds the SDKs it names (`oidc`, `bff`, `react`, `node`, `next`, `admin-client`, `me-client`, `mcp-stdio`; the README of each example gives the list) and installs the packed result, and needs `pnpm install` run once at the repository root. For `python`, `../_shared/install-python.sh .` makes a virtual environment, builds the `odudu` package into a wheel and installs it. Once the SDKs are published, `npm install` (or `pip install .`) is all a copied folder needs.
3. Run its test with `npm test` (`.venv/bin/python -m pytest` for `python`). The test starts the app, signs a person in or calls the API, and checks what came back. The examples that sign a person in at a page, `web-app`, `single-page-app`, `react-bff` and `admin`, drive a browser with the repository's Playwright.
4. To use it by hand instead, run `npm start`. The web app listens on `http://localhost:8081`, the API on `http://localhost:8082`, the React app on `http://localhost:8083`, the single-page app on `http://localhost:8084` and the Next.js app on `http://localhost:8085`. The `admin` script listens on `http://127.0.0.1:8086` while a person signs in, and the Python API runs on port 8087 when started as its README shows.

The examples read the stack's address from `ODUDU_BASE` (default `http://localhost:3000`) and the tenant from `TENANT` (default `demo`); the single-page app reads `VITE_ODUDU_BASE` and `VITE_TENANT` instead. If you moved the quick start's port, set the address to match.

## About the secrets

The client secrets in `_shared/provision.sh` are published in this repository, for a stack on your own machine. Anything real reads its secret from the environment of the machine it runs on, and never from a file in the repository.

## Licence

The examples are Apache-2.0. Each folder carries its own copy of the licence.
