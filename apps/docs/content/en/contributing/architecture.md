---
title: Architecture
description: The five layers every package follows, the imports each may make and a map of what each directory of the repository holds.
---

# Architecture

You will learn how the code is organised so you can put a new piece in the right place the first time. Odudu is a TypeScript monorepo. Every part of it, the server and the admin console alike, is built from the same five layers, and the build checks the rules between them. This documentation site follows the same layout with the three layers it needs.

## The five layers

| Layer      | What it holds                                                  | Business logic    |
| ---------- | -------------------------------------------------------------- | ----------------- |
| view       | Rendering, and the glue that connects a screen or route        | no                |
| usecase    | Orchestration of one journey, from request to result           | no                |
| repository | State, and the decision of when to read it again               | no                |
| adapter    | The wire contract: endpoints, data shapes and their mapping    | API-contract only |
| service    | The domain and application logic: the rules, in pure functions | yes               |

Read the last column as a rule about where decisions live. A rule, a message, the mapping of a failure to words and a formatter are each a function in a service. A usecase wires hooks, state and calls together and decides nothing. A repository holds queries, mutations and cache keys and decides nothing. That keeps the rules testable without a database or a screen.

## Who may import whom

| Layer      | May import                          | Never imports             |
| ---------- | ----------------------------------- | ------------------------- |
| view       | Its own model, the shared view code | repository, adapter       |
| usecase    | repository, service, view models    | adapter                   |
| repository | adapter, service                    | view, usecase             |
| adapter    | The transport, service              | view, usecase, repository |
| service    | nothing                             | everything else           |

A feature exposes one `index.ts`, and no feature reaches into another's internals. Domain packages never import protocol packages, and protocol packages never import each other. `pnpm boundaries` checks these rules and fails the build on a breach, because a convention that nothing checks decays within weeks.

The documentation site has no remote data, so it has only `view`, `usecase` and `service`. Each feature under `apps/docs/src/features` holds those three folders and one `index.ts`; what more than one feature or MDX content uses is under `shared`. Each component is a folder with its markup, its CSS module and its test, no type carries `readonly` (immutable constants use `as const`), and anything the browser provides that a service needs, such as a clock or an observer, is passed in by the usecase. The build holds this by the same kinds of checks.

Inside a package, imports use `#/` and never a relative path. Across packages they use the package name, such as `@odudu/kernel`, and resolve only through that package's `index.ts`. In the console an import never carries a `.ts` or `.tsx` extension.

## Server pages

A page the sign-in flow shows is a function that returns markup and nothing else, in a `view` directory of the package that owns the step. Its text comes from a catalogue of messages, never typed into the markup, and its security headers come from one function so no route sets them by hand. `tests/lint` fails the build on text typed in a renderer.

## Volume, designed in

Every increment is designed for one volume: a million subjects and ten thousand clients in a tenant, ten thousand tenants and a hundred million audit events. A collection read is bounded, a list or search is served by an index, and a list endpoint makes a constant number of queries. The console renders nothing unbounded.

## Where the documentation is served

Both builds of the documentation site put every page at `docs/<page>/` under the root of the site that serves them. On the public site the landing page is the site root, so the pages are at `<root>docs/<page>/`; inside the image the server mounts the build at its `docs/` path, and the build serves its pages from its own root, which gives the same shape. `apps/docs/site.config.ts` is the one file that names the public address and these two shapes. The `llms.txt`, `sitemap.xml` and `robots.txt` files stay at the root of the public site, as crawlers expect, and the search results page sits beside them because the search plugin fixes its address.

## The map

Every directory of the workspace, grouped by what it is for.

**Applications**

- `apps/server` is the server: it wires every package into one process, owns the boot guards, and holds the `odudu` command line.
- `apps/admin-console` is the admin console, a React single-page app.
- `apps/docs` is this documentation site and the generators of its reference pages.

**Foundations**

- `packages/kernel` holds configuration, errors, identifiers and the page headers. It has no transport dependency.
- `packages/db` holds the schema, the migrations and the tenant-scoped transactions that row-level security relies on.
- `packages/crypto` wraps keys under the key-encryption key, generates signing keys and signs and verifies tokens.
- `packages/contracts` holds the shapes and rules the server and the console share.
- `packages/i18n` holds message catalogues and locale negotiation.

**Domains**

- `packages/domain-identity` holds subjects, credentials and password rules.
- `packages/domain-tenant` holds tenants, their settings and clients.
- `packages/domain-theme` holds theme versions and uploaded assets, the theme model and the checks on templates and stylesheets.
- `packages/domain-authz` holds roles, groups and scopes.
- `packages/domain-audit` holds the audit trail and its vocabulary.

**Flows and protocols**

- `packages/authn-flows` holds the steps of signing in: sessions, one-time passwords, passkeys and recovery codes.
- `packages/account` holds registration, email verification and password reset.
- `packages/protocol-oidc` holds the OAuth 2.1 and OpenID Connect endpoints.
- `packages/protocol-admin` holds the admin API and its OpenAPI description.
- `packages/console-gateway` holds the server side of the console, which keeps its tokens out of the browser.

**Presentation and delivery**

- `packages/email` holds the mail templates and the senders.
- `packages/instrument` builds the stylesheet and fonts every server page uses.
- `packages/web-assets` serves the documentation and static files under their own policy.

**Testing and tooling**

- `packages/testkit` holds what tests share: a real PostgreSQL in a container and a software authenticator.
- `tools/bench` holds benchmarks that are not part of the test run, such as the burst against an unknown address.
- `tools/ci` works out which CI jobs a change needs.
- `tools/commit-message` checks commit messages.
- `tools/docs-run` runs the commands in the guides against a live stack.
- `tools/release` works out a release's version and image tags, and writes its notes and its compose file.
- `tools/trace` checks every requirement in a protocol note has a test.
- `tools/turbo-cache` prunes the build cache.

The root also holds `tests`, which are the checks that span packages: boundaries, lint rules, documentation and end-to-end traces.
