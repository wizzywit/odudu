---
title: SDKs
description: The npm packages and the Python package that sign people in, protect an API and call the admin and me APIs, which to pick, and their licence.
---

# SDKs

Odudu speaks OpenID Connect and OAuth 2.0, so a library for them can talk to it. The SDKs are the packages the project itself writes and tests against its own server. They sign a person in, keep a session on a server, check the access tokens an API receives, call the admin API and the me API with types, and connect an AI client. Each has a page here with its install command, its shortest use, its options, the errors it raises and what it does to keep tokens safe.

There are eight npm packages under the scope `@odudu-io` and one Python package, `odudu` on PyPI. All of them are at the version in the table, and each has its own `CHANGELOG.md` and its own release.

The first release has not been published yet. Until it is, an example installs the packages from a checkout of the repository: its README says how, with `examples/_shared/install.sh`.

## The packages

| Package                                       | Version | Language   | Use it to                                                                                 | Example                                                                                                                                                                                                                                                         |
| --------------------------------------------- | ------- | ---------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`@odudu-io/oidc`](./oidc.md)                 | `0.1.0` | TypeScript | Sign a person in from a browser or a server, refresh tokens, sign a service in as itself. | [web app](https://github.com/wizzywit/odudu/tree/main/examples/web-app), [single-page app](https://github.com/wizzywit/odudu/tree/main/examples/single-page-app), [machine to machine](https://github.com/wizzywit/odudu/tree/main/examples/machine-to-machine) |
| [`@odudu-io/react`](./react.md)               | `0.1.0` | TypeScript | Show who is signed in in a React app, with a provider, components and hooks.              | [react-bff](https://github.com/wizzywit/odudu/tree/main/examples/react-bff)                                                                                                                                                                                     |
| [`@odudu-io/bff`](./bff.md)                   | `0.1.0` | TypeScript | Run the sign-in on a server that keeps the tokens, and give the browser a cookie.         | [react-bff](https://github.com/wizzywit/odudu/tree/main/examples/react-bff)                                                                                                                                                                                     |
| [`@odudu-io/next`](./next.md)                 | `0.1.0` | TypeScript | The same for a Next.js App Router app, with a server-side session read.                   | [next](https://github.com/wizzywit/odudu/tree/main/examples/next)                                                                                                                                                                                               |
| [`@odudu-io/node`](./node.md)                 | `0.1.0` | TypeScript | Check the access token an API in Node receives, with Express, Fastify and `http` helpers. | [api](https://github.com/wizzywit/odudu/tree/main/examples/api)                                                                                                                                                                                                 |
| [`@odudu-io/admin-client`](./admin-client.md) | `0.1.0` | TypeScript | Call the admin API of a tenant from code.                                                 | [admin](https://github.com/wizzywit/odudu/tree/main/examples/admin)                                                                                                                                                                                             |
| [`@odudu-io/me-client`](./me-client.md)       | `0.1.0` | TypeScript | Call the me API: a person's own profile, credentials, sessions and consents.              | [admin](https://github.com/wizzywit/odudu/tree/main/examples/admin)                                                                                                                                                                                             |
| [`@odudu-io/mcp-stdio`](./mcp-stdio.md)       | `0.1.0` | TypeScript | Run the Odudu admin tools as an MCP server for a local AI client.                         | [mcp](https://github.com/wizzywit/odudu/tree/main/examples/mcp)                                                                                                                                                                                                 |
| [`odudu`](./python.md)                        | `0.1.0` | Python     | Call the admin and me APIs, and check the access token a Python API receives.             | [python](https://github.com/wizzywit/odudu/tree/main/examples/python)                                                                                                                                                                                           |

The TypeScript packages need Node 24 or later. The Python package needs Python 3.10 or later.

## Which one do you need

| You are building                                              | Use                                                                                                         |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| A web app with a server that renders its own pages            | [`@odudu-io/oidc`](./oidc.md), and keep the session yourself.                                               |
| A single-page app with no server                              | [`@odudu-io/oidc`](./oidc.md), or [`@odudu-io/react`](./react.md) in `browser` mode. Tokens stay in memory. |
| A React app with a server that can keep the tokens            | [`@odudu-io/react`](./react.md) with [`@odudu-io/bff`](./bff.md). The browser never holds a token.          |
| A Next.js app                                                 | [`@odudu-io/next`](./next.md).                                                                              |
| An API in Node that receives access tokens                    | [`@odudu-io/node`](./node.md).                                                                              |
| An API in Python that receives access tokens                  | [`odudu`](./python.md) with the `fastapi` or `flask` extra, each of which includes `verify`.                |
| A service or a job that calls an API as itself                | [`@odudu-io/oidc`](./oidc.md): its token source keeps a token and renews it.                                |
| A script or service that manages clients, users or settings   | [`@odudu-io/admin-client`](./admin-client.md), or [`odudu`](./python.md).                                   |
| A tool that reads or changes a person's own account           | [`@odudu-io/me-client`](./me-client.md), or [`odudu`](./python.md).                                         |
| An AI client that should read, or change, a tenant's settings | [`@odudu-io/mcp-stdio`](./mcp-stdio.md).                                                                    |

If your app sits behind a server you control, prefer a backend for frontend to tokens in the page: a script that runs in the page can read anything the page holds. [Backend for frontend](../concepts/backend-for-frontend.mdx) explains the pattern, and [`@odudu-io/bff`](./bff.md) says what the server stores and how it protects the cookie. To sign a person in with the core and no framework, read [the core without React](./core-without-react.md).

## What the code blocks on these pages are

A block tagged as TypeScript, Python or `text` is shown and not run by the documentation's own checks, because the packages cannot be installed from a registry until they are published. Most are taken from the source of an example in the repository, which the repository's CI does run against a live stack; `node.md` and `me-client.md` say where a block is not. The documentation's tests check that every name a block imports from an SDK is exported by that package, that every package has a page, that this table names each package's version, and that each page links an example folder that exists.

The commands in the [guides](../guides/index.md) are the ones that run against the quick start stack.

## Licence

The SDKs are licensed under Apache-2.0, and each package carries its own `LICENSE`. The server, the console, the gateway and the command line are licensed under AGPL-3.0. The directory a file lives in decides which licence covers it: `sdks/*` and `examples/*` are Apache-2.0. `LICENSING.md` says an application that only talks to Odudu over OpenID Connect, OAuth 2.0 or the admin API is not a derivative work of Odudu, whatever its own licence is, and ADR 0053 gives the SDKs Apache-2.0 so that a closed-source application may use them. [`LICENSING.md`](https://github.com/wizzywit/odudu/blob/main/LICENSING.md) has the table, and [ADR 0053](https://github.com/wizzywit/odudu/blob/main/docs/adr/0053-sdks-live-in-sdks-and-are-apache.md) records why the SDKs live in `sdks/` and are Apache-2.0 while the server is AGPL.

## Where the code is

Every package is in [`sdks/`](https://github.com/wizzywit/odudu/tree/main/sdks) in the repository, with the example that uses it in [`examples/`](https://github.com/wizzywit/odudu/tree/main/examples). [Examples](./examples.md) shows all nine, with how to run each and what its test checks.
