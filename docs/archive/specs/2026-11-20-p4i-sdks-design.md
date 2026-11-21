# P4i: SDKs for signing in and for the admin API

Phase spec. The umbrella spec fixes the row (section 11, "P4i") and the rule
that no SDK handles a password; this document fixes everything else.

## Why

Odudu publishes no library. The examples under `examples/` sign in through
`openid-client`, `oauth4webapi` and `jose`, which is what an application has to
do today, and the introduction page says so. An app that wants refresh,
`prompt=create`, logout, an application-initiated action or the "me" API
writes each of them from the protocol notes. P4i ships the official libraries
that wrap what exists, a typed client for the two APIs, and `odudu mcp` as a
package a laptop can install.

**Owner decisions (2026-11-20).** Names: npm scope `@odudu-io` (the owner chose it after
the spike found `@odudu` held by another npm user), PyPI project `odudu`. The five design calls below are taken as recommended. The "me" API's
missing OpenAPI document is solved in this phase. Nothing P4i owns is placed
elsewhere: "complete" means every bullet in the goals is shipped, documented and
run in CI by the time the branch is finished.

## Goals

1. **A shared-components admin OpenAPI document** and a **new "me" OpenAPI
   document**, both generated from the route tables, both checked for size.
2. **Sign-in SDKs** (TypeScript, Apache-2.0): `@odudu-io/oidc` (framework-neutral
   core), `@odudu-io/react`, `@odudu-io/bff`, `@odudu-io/next`, `@odudu-io/node`.
3. **Typed clients, generated**: `@odudu-io/admin-client` and `@odudu-io/me-client`
   (TypeScript) and `odudu` on PyPI (admin and "me" clients and an access-token
   verifier, Python 3.10+).
4. **`@odudu-io/mcp-stdio`**, `odudu mcp` installable without the image or a
   checkout, and the server's own `odudu mcp` command built on the same code.
5. **Per SDK**: a page in a new SDKs docs section, a runnable example run in CI, its
   own version and changelog, and a dry run of its publish in CI. The four
   existing examples are rewritten on the SDKs.
6. **Every document and check the closing pass of CLAUDE.md names**: roadmap,
   section 11, `docs/NEXT.md`, the introduction, `README.md`, the landing page,
   `CHANGELOG.md`, the phase note, ADRs.

## Non-goals

- Vue, Svelte and Angular bindings, native mobile SDKs, verifiers for Go, Java,
  .NET, PHP and Ruby, headless sign-in components, and an agent delegation
  library: P14 (roadmap, "Later"). Researched 2026-11-20: a Python verifier is
  in this phase (the Python package would otherwise have clients and no way to
  verify a token), and so is a guide to using the core without React. Mobile
  stays out because a guide that cannot run in CI would break the rule that
  examples run; RFC 8252 and the AppAuth libraries already serve it.
- Any sign-in form, password field or credential ceremony in an app's page
  ("Decided against": until P14's flow API exists). An SDK only redirects.
- Changing the server's protocol behaviour. P4i adds two documents, one
  route that serves the "me" one, and a refactor behind `odudu mcp`; it adds no
  grant, scope or claim.
- Publishing to the registries is a tag, like the image (`RELEASING.md`). The
  workflow and its dry run are the phase; running it with the registry
  credentials is the owner's release step and is written into `RELEASING.md`.

## Anti-goals

An SDK that reimplements token verification differently from the server's own
rules; an SDK that stores a token where a compromised dependency can read it
without saying so; a generated client nobody regenerates; a runnable example
that is only type-checked; an Apache package that imports AGPL code.

## Owner prerequisites

Before the first publish, and checked first in the plan (spike S5): the `@odudu-io`
organization exists on npm, the `odudu` project exists on PyPI, and trusted
publishing is configured for each against `sdk-release.yml`. `RELEASING.md` gets
this as a checklist in the same increment that adds the workflow.

## Constraints from the repository

Each carries the command that showed it (run in this worktree on 2026-11-20).

- `@odudu/*` internal names are private and taken (`packages/*/package.json`,
  `ls packages`): the public names below avoid every one of them.
- `LICENSING.md` maps `packages/*` to AGPL and `examples/*` to Apache;
  `tests/lint/licence-fields.test.ts` enforces it. SDKs need their own row.
- `pnpm-workspace.yaml` lists `apps/*`, `packages/*`, `tools/*` and `tests`;
  `minimumReleaseAge: 1440` applies to every SDK dependency.
- The admin OpenAPI document is built by `buildAdminOpenApiDocument()`
  (`packages/protocol-admin/src/view/routes/openapi.ts:268`) from `ADMIN_ROUTES`,
  and written to `apps/docs/static/openapi/admin.json` by
  `apps/docs/scripts/generate.ts`. Its `info.version` is `0.0.0`.
- `ME_ROUTES` (`packages/me/src/view/routes.ts:83`) holds method and URL only.
  The response and body schemas are in `packages/contracts/src/me/*`
  (`meProfileSchema`, `meCredentialsResponseSchema`, `meSessionsEndedSchema` and
  others), so a document needs them attached to the routes.
- `odudu mcp` (`apps/server/src/cli/mcp.ts`) imports from `@odudu/mcp`, which is
  AGPL and imports `protocol-admin` and `protocol-oidc` (ADR 0051).
- No npm or PyPI publishing and no Python exists in `.github` or `tools`
  (`git grep -i 'pypi\|npm publish'` returns nothing).
- The "me" audience is `<issuer>/me`, scopes `me:read` and `me:write`;
  `prompt=create` and the `/authorize` parameter `action` exist
  (`docs/phases/p4f.md`, `docs/protocols/oidc-prompt-create.md`).

## Approaches considered

Each contested call had two or three approaches; the owner took the
recommendation on all five.

| Call                  | Taken                                                                                           | Rejected, and why                                                                                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Layout and versioning | `sdks/*` in this monorepo, Apache-2.0, a tag per package                                        | A separate repository (the generated client and the server's document could drift, and an example in CI would boot a server from another repository). `packages/*` (AGPL, and the licence lint forbids it). |
| Client generation     | Generate TypeScript and Python from the committed documents; CI regenerates and fails on a diff | Generate only at publish time (a reviewer cannot see what changed, and P4h's `fieldErrorSchema` change would land unseen).                                                                                  |
| Runnable examples     | One example per SDK under `examples/`, run in CI against the quick start stack                  | One combined app (hides what each SDK needs).                                                                                                                                                               |
| BFF                   | A real `@odudu-io/bff`, which Next builds on                                                    | Documentation and an example only (leaves cookie and CSRF rules to each app).                                                                                                                               |
| `odudu mcp`           | A standalone package, the server's command built on it                                          | A bundle of the existing command (ships AGPL code in an Apache package).                                                                                                                                    |

Calls made without being asked (mine; each can be reversed):

- **The core wraps `oauth4webapi` and `jose`, and no more.** The protocol's
  low-level steps are a tested library's job; the core adds Odudu's defaults and
  the things only Odudu has. `assumption:` both run on Node 24, in a browser and
  on an edge runtime without a Node-only API (spike S1).
- **The core uses `fetch` and WebCrypto only**, so it runs in the browser, Node
  and edge. Storage, clocks and random sources are handed in.
- **The "me" document is served at `/me/openapi.json`**, unauthenticated and
  readable from any origin, as `/admin/openapi.json` is, and absent from its own
  `paths`.
- **Public names:** `@odudu-io/oidc`, `@odudu-io/react`, `@odudu-io/bff`, `@odudu-io/next`,
  `@odudu-io/node`, `@odudu-io/admin-client`, `@odudu-io/me-client`, `@odudu-io/mcp-stdio`;
  PyPI `odudu`. `assumption:` all are free on both registries; checked by
  `npm view` and a PyPI lookup in the first task, before anything is built on a
  name.

## Design

### 1. OpenAPI documents (increment 1)

**Shared components.** Every admin operation's problem response moves to
`components.responses` (one per status class) and every repeated schema the
builder inlines more than once moves to `components.schemas`, the way
`ThemeBody`, `Palette` and `Logo` already do. The document's size is measured
before and after, and a test pins a ceiling at the measured size plus 5 per
cent. The ceiling is the check that a later field does not inline again.
`verified:` none yet; the baseline is measured with
`node -e` over `buildAdminOpenApiDocument()` in the first task and recorded in
the spec's amendment.

**The "me" document.** `ME_ROUTES` becomes a table that carries, for each route,
its path parameters, query schema, body schema, response schemas by status, and
`Cache-Control: no-store`. A builder in `packages/me` (view layer) turns it
into OpenAPI 3.1 with a `bearerAuth` scheme, the `me:read` and `me:write` scope
each route needs, and the shared `ProblemDetails` response. A test holds the
table and the registered Fastify routes equal both ways, as
`openapi.int.test.ts` does for the admin API. The generated reference pages and
`apps/docs/static/openapi/me.json` follow, and so does `tests/docs/endpoints.test.ts`.

**Both documents get a real `info.version`** (the server's version at build)
so a generated client records what it came from.

### 2. SDK workspace and release (increment 2)

- Directory `sdks/<name>` for TypeScript packages, `sdks/python` for PyPI. Added
  to `pnpm-workspace.yaml`; a row in `LICENSING.md` (Apache-2.0); each package
  carries its `LICENSE`. `licence-fields.test.ts` gains the row.
- **Dependency rule** (new, `.dependency-cruiser.cjs`, with a fixture in
  `tests/boundaries`): `sdks/*` may import no `@odudu/*` workspace package other
  than another SDK. The licence boundary is a dependency edge, so it is checked as one.
- Each package: `exports` map, ESM only, a `types` entry, `files`, `engines`,
  `sideEffects: false`, `publishConfig` with provenance. Versions start `0.1.0`
  and move by tag `<name>-vX.Y.Z`; each has `CHANGELOG.md` of its own.
- **Release workflow** `sdk-release.yml`: on a tag, build, run the package's
  tests and its example, `npm publish --provenance` or `twine upload` with a
  trusted publisher. A manual run does everything except publish (as
  `release.yml` does). `assumption:` npm trusted publishing from GitHub Actions
  works for a scoped public package; spike S4 runs `npm publish --dry-run` and
  `npm pack`, and reads the provenance requirements.
- The layout inside a TypeScript package follows the docs app's: `ui` (only in
  `react` and `next`), `use-cases`, `services` (pure functions), `adapter`
  (the wire), one `index.ts`. No `any`, no `void` statements, the comment rules
  and `complexity: 8` hold, with no allowlist.

### 3. `@odudu-io/oidc`: the core (increment 3)

Pure functions and one small client, over `oauth4webapi`.

- `discover(issuer)`: reads the metadata, checks `issuer` equals the address
  asked (RFC 8414 section 3.3) and caches by issuer with a bound and a TTL.
- `beginSignIn(options)`: state, nonce, PKCE S256; returns the URL and a
  `pending` record the caller stores (session storage, a cookie, a server
  session; the core stores nothing). Options carry `prompt: 'create'`,
  `action` (change password, enrol TOTP, enrol a passkey, a fresh set of
  recovery codes), `scope`, `resource`. It sends no `login_hint` (Odudu ignores it).
- `completeSignIn(callbackUrl, pending)`: checks `state`, `iss` (RFC 9207),
  exchanges the code, validates the ID token (issuer, audience, nonce, `azp`,
  expiry) and returns tokens.
- `refresh(tokens)` with **single-flight per refresh token** (a second call
  waits for the first, so one use is never replayed: Odudu's reuse detection
  would end the family).
- `clientCredentials(options)` and `createTokenSource(options)`: the machine
  grant with `client_secret_basic` or `private_key_jwt`, renewed before expiry,
  single-flight. It is how `examples/machine-to-machine` runs on the SDK.
- `signOutUrl(options)`: RP-initiated logout with `id_token_hint` and
  `post_logout_redirect_uri`, and the confirm-by-default page of ADR 0047 named.
- Tokens are held **per audience** (`Tokens` is keyed by `resource`): a sign-in that
  names `resource=<issuer>/me` with `me:read` (and `me:write`) gets a token whose
  audience is the me URL with the issuer beside it (`docs/phases/p4f.md`, "What
  the live run found"); a token for another API is a separate request. The core
  asks for the extra audience at sign-in when `meAccess` is set, and
  `refresh(tokens, { resource })` renews one audience. `assumption:` a refresh
  with a changed `resource` is accepted or refused by the server as ADR 0050 and
  RFC 8707 say. Spike S6 settled it: a refresh may only name an audience the
  grant already carries (`400 invalid_target` otherwise), so a new audience needs
  a new authorization, which `requestAudience` drives and signals with a distinct
  error; whether `prompt=none` avoids a second interaction is untested, and the
  `me:*` scope is passed unchanged on refresh.
- Errors are a closed set of typed values with Odudu's own codes carried
  through (`prompt=create is not supported: registration is off`, the
  `invalid_request` forms); no thrown string is shown to a person.

### 4. `@odudu-io/node`: token verification (increment 4)

`verifyAccessToken(token, options)` plus middleware for Fastify, Express and
Node's `http`. Rules are the server's own for an API (RFC 9068): signature
by JWKS, `iss`, `aud`, `typ: at+jwt`, `exp`/`nbf`, required scope, a
refusal for an ID token and for a token naming the "me" audience at an API.
The JWKS is cached with a TTL and a size bound, re-fetched on an unknown `kid`
under a rate limit (so an unknown `kid` cannot drive fetches). Failure
answers `401`/`403` with `WWW-Authenticate` (RFC 6750). The former
`examples/api` verifier becomes the independent oracle (section 9); a
differential runs the same tokens through it and the package and requires the
same verdict.

### 5. `@odudu-io/bff` (increment 5)

The backend-for-frontend of RFC 10017, built on `Request`/`Response`, so Next,
Fastify and Express adapters are thin. Routes: `/login`, `/callback`,
`/logout`, `/session` (the signed-in person's claims, never a token),
`/proxy/*` (attaches the access token to calls to an allowlisted upstream,
refreshes on expiry).

- **Cookie:** `__Host-` prefix, `HttpOnly`, `Secure`, `SameSite=Lax`, a random
  session id; tokens live in a **`SessionStore`** the app supplies. The
  default is an in-process store with a **bounded size and idle expiry** and a
  warning in the guide that more than one instance needs a shared store.
- **CSRF:** every state-changing route requires a custom request header and an
  `Origin` match; `GET` never changes state; the login redirect's `pending` is
  bound to the browser by the cookie.
- **Refresh** runs through the core's single-flight; a refused refresh ends the
  session and answers `401`.
- It stores no password and renders no form.
- `assumption:` the console gateway (`packages/console-gateway`, ADR 0038)
  already implements the same shape; the SDK does not import it (licence) but
  its tests are the model for the BFF's cases.

### 6. `@odudu-io/react` and `@odudu-io/next` (increments 6 and 7)

- **React:** `OduduProvider`, `useAuth`, `useUser`, `useAccessToken`, `SignedIn`,
  `SignedOut`. Two modes: **BFF mode** (talks to `@odudu-io/bff`'s `/session`;
  recommended) and **in-browser mode** (PKCE in the page, tokens held in memory
  only, as `examples/single-page-app` does; a guide section says the risk RFC
  10017 gives). The React Compiler rule of the repository's consoles applies to
  the hooks: no hand-written memoisation without a measurement. Server
  components import nothing browser-only.
- **Next.js:** App Router route handlers (`createOduduHandlers`), `getSession()`
  for server components and actions, `withAuth` for middleware, all on
  `@odudu-io/bff`. `assumption:` Next's `cookies()` and middleware APIs are as
  the current docs say (spike S3 builds the example against the pinned Next).

### 7. Generated clients (increments 8 and 9)

- **TypeScript:** `@odudu-io/admin-client` and `@odudu-io/me-client`: generated types
  and a thin `fetch` client from the two committed documents; tenant is a
  client option, so a path never repeats it; `Idempotency-Key` is supplied for
  the methods that take one; **cursor pagination helpers** iterate with a page
  bound; `ProblemDetails` is a typed error. `assumption:` `openapi-typescript`
  and `openapi-fetch` accept OpenAPI 3.1 and the shared-components shape (S1).
- **Python:** `odudu` with `odudu.admin` and `odudu.me`, typed (`py.typed`),
  Python 3.10+, `httpx`. `assumption:` `openapi-python-client` (or
  `datamodel-code-generator` with a hand-written transport) handles the
  documents (S1); the spike picks one and records the other as rejected.
- **Regeneration:** `pnpm sdks:generate` writes the generated sources from
  `apps/docs/static/openapi/*.json` and a CI check fails on any diff. When P4h
  generalises `fieldErrorSchema`, the diff is the review.
- A client is never hand-edited: a hand-written file lives beside the generated
  directory, and the generated directory is marked generated.

**Python verifier.** `odudu.verify` applies `@odudu-io/node`'s rules (RFC 9068:
signature by JWKS, `iss`, `aud`, `typ: at+jwt`, expiry, required scope, ID tokens
and me-audience tokens refused at an API) with a bounded, TTL-cached JWKS and
rate-limited unknown-`kid` refetch, plus FastAPI and Flask helpers as optional
extras. It runs the same shared token fixtures as `@odudu-io/node`, so one set of
tokens gives one verdict in both languages. `assumption:` `PyJWT` with its
crypto extra or `joserfc` covers the checks; the Python spike picks one.

### 8. `@odudu-io/mcp-stdio` (increment 10)

The end state: `npx @odudu-io/mcp-stdio --base-url … --tenant …` works on a
machine with neither the image nor a checkout, and `odudu mcp` in the server CLI
runs the same code.

- Moves into `sdks/mcp-stdio`: the stdio transport, the HTTP caller, the
  credential store, the loopback login and the budget, i.e. everything
  `apps/server/src/cli/mcp.ts` imports from `@odudu/mcp` except the catalogue.
- The catalogue (tools and their agent scope allowlist, ADR 0050) is a **data
  file generated from the server's source** (`mcp-tools.json`) and read by the
  package; a CI check fails when it differs from the generated one. The server
  still enforces every call (the token's `mcp:read`/`mcp:write` scope narrows
  it), so a stale client file can refuse a tool but never widen one.
- Spike S2 settled it: the moved code reaches only a few kernel address
  helpers, the scope and client constants, and `@odudu/contracts/admin`'s
  response schemas, limits and bidi helpers. Those are copied or generated into
  the package (and covered by the same CI drift check as the catalogue), and the
  catalogue carries a JSON Schema per tool response, validated with a small
  validator the task chooses and verifies. `service/deps.ts` is split. Service
  account assertions use `@odudu-io/oidc`'s `private_key_jwt` support, so the
  package copies nothing from `@odudu/crypto`. The vendoring fallback is not needed.
- The injection suite and `mcp-endpoint.int.test.ts` keep running against the
  server's command, so the moved code is covered by the tests that cover it today.

### 9. Examples and CI (increment 11)

**The four examples that exist move onto the SDKs.** `examples/web-app`
(`openid-client`), `examples/single-page-app` (`oauth4webapi`),
`examples/api` (hand-written verifier) and `examples/machine-to-machine`
(hand-written `fetch` token source) each do by hand what an SDK now does, so each
is rewritten to use it and keeps its folder, its test and its guide:

| Example              | Uses                                                                                       | Before                          |
| -------------------- | ------------------------------------------------------------------------------------------ | ------------------------------- |
| `web-app`            | `@odudu-io/oidc` and `@odudu-io/bff` on Node's `http`                                      | `openid-client`                 |
| `single-page-app`    | `@odudu-io/oidc` in the browser, no framework (also the model for Vue, Svelte and Angular) | `oauth4webapi`                  |
| `api`                | `@odudu-io/node`                                                                           | its own verifier                |
| `machine-to-machine` | `@odudu-io/oidc`'s client credentials token source                                         | `fetch` and a hand-rolled cache |

So the core gains `clientCredentials()` and a `createTokenSource()` (renews
before expiry, single-flight, `client_secret_basic` and `private_key_jwt`).
`examples/api/verifier.test.ts` is not lost: its verifier moves to
`sdks/node/test/reference-verifier.ts` as the independent oracle the
differential in section 4 runs against, so the SDK is still checked against
code it did not write.

**New examples**, each Apache-2.0 with its own `test.ts`:
`examples/react-bff` (`@odudu-io/react` over `@odudu-io/bff`), `examples/next`
(`@odudu-io/next`), `examples/admin` (admin and "me" clients, TypeScript),
`examples/python` (the clients and the verifier behind a small FastAPI app) and
`examples/mcp` (the stdio client run against the stack). That is nine in all.
`examples/README.md` lists every one with what it shows and how to run it.

- Every example depends on the **published version range** and is copyable out
  of the repository. In CI the `examples` job packs each SDK (`npm pack`,
  `python -m build`) and installs the tarballs into a scratch copy of the
  example, so the committed `package.json` and lockfile stay as a reader copies them.
- A new `sdks` job holds what is not an example: build and test of each package,
  the regeneration check, the MCP catalogue check and the publish dry runs. Both
  jobs stay in `gate`, and ADR 0044's path filters name `sdks/**`, the two
  OpenAPI builders and the contracts.
- Each example's test signs in through the stack and checks what came back (as
  the four do now); the admin and "me" examples create and read a record; the
  Python example does the same and verifies a token; the MCP example runs the
  stdio client against the stack.
- `tests/lint/ci-workflow.test.ts` (which holds every `examples/*` directory to a
  `test.ts` and the job to `gate`) and `.github/dependabot.yml` (an entry per
  example directory) are extended for the new folders in the same increment.

### 10. Documentation (increment 12)

**A new top-level "SDKs" section** in the docs site, beside Guides, added to
`apps/docs/nav.ts` and `apps/docs/sidebars.ts` and held by `ia.test.ts`:

- **An index** with a table of every package (name, registry, what it is for,
  version, licence) and a "which do I need" list by kind of app.
- **A page per package**: install, the shortest working use, the options, the
  errors it raises, the security notes (where tokens live, what the BFF stores),
  and a link to its example.
- **An examples page** that shows all nine examples, one section each: what it
  demonstrates, the files that matter, the command that runs it, and a link
  to the folder. `apps/docs/tests/example-links.test.ts` holds every link to a
  file that exists, and a new test holds this page to the `examples/` directory
  both ways (a folder with no section, or a section with no folder, fails).
- **A page on the backend-for-frontend** (the concept, and the cookie, CSRF and
  store rules of ADR 0054) and **a guide on using the core without React**.
- **The existing guides**: `web-app`, `single-page-app`, `api` and
  `machine-to-machine` are rewritten around the SDK versions of their examples
  and teach the SDK only: no "without an SDK" section. A reader on another
  stack is served by pages that stay as they are: the curl walkthrough
  `sign-a-user-in`, the concepts and the protocol reference. Runnable blocks
  stay run by `tools/docs-run`; a command nobody ran is not shown.
- **Elsewhere:** the introduction's "Odudu has no SDK of its own" sentence,
  `README.md`, the landing page and its "Planned" bands, the quick start's
  next steps, the roadmap (P4i out of "Next", the P14 text kept), the
  generated reference pages for the "me" document, and `llms` entries.
- **CLAUDE.md** gains a row in the documentation-owner table, "A change to an
  SDK's public surface", naming its page, its example and its checks;
  `documentation-owner-table.test.ts` holds that row to files that exist.

## Calls taken after the builder check (mine; each can be reversed)

- **Tenant and auth in the clients.** The admin document keeps its `{tenant}`
  path parameter (`/admin/tenants/:tenant/...`, `capability.ts:427`); the
  generated client is wrapped, not rewritten: a hand-written `createAdminClient({
baseUrl, tenant, token })` fills it. `token` is a string or an async provider,
  so `@odudu-io/admin-client` depends on no other SDK; the guide shows
  `@odudu-io/oidc`'s `refresh` as a provider. The "me" client takes the same.
  Python: both a sync and an async `httpx` client, the same helpers (cursor
  iteration, `Idempotency-Key`, typed `ProblemDetails`); S1 picks a generator that
  emits both or the hand-written transport wraps its models.
- **Size threshold.** Bytes of the document as served, pretty-printed as now.
  The target is that no `POST` inlines a problem schema; the ceiling is the
  measured size plus 5 per cent. A smaller-than-before result is required, and a
  result that is not smaller is a failure of the increment, not a waiver.
  Measured baseline: 2,304,007 bytes before, 775,798 bytes after; the ceiling
  `ADMIN_DOCUMENT_MAX_BYTES` is 815,104 (775,798 plus 5 per cent, rounded up to a
  whole KiB).
- **Dependency direction.** The server's `odudu mcp` imports `@odudu-io/mcp-stdio`
  (AGPL consuming Apache is allowed); the dependency rule stays one-way. When the
  vendoring fallback is taken, `mcp-tools.json` is generated by a script in
  `tools/` and owned by the `sdks` job's check, never edited by hand. The loopback
  login keeps its Node listener and opener, which the package declares as its
  runtime (Node only).
- **No example depends on a package it cannot resolve.** Examples list the
  published range. In CI, `npm install <tarball>` replaces each SDK dependency in
  a scratch copy of the example, so the committed `package.json` and lockfile stay
  as a reader would copy them. The pnpm release-age rule does not apply to npm
  inside the example.
- **BFF adapters.** `@odudu-io/bff` exports the `Request`/`Response` handlers plus
  Fastify and Express adapters at subpaths (`@odudu-io/bff/fastify`,
  `@odudu-io/bff/express`), with those frameworks as optional peers. `@odudu-io/node`
  stays verification only, and `@odudu-io/next` the Next binding.
- **Proxy defaults.** The allowlist is a list of exact origins plus path
  prefixes per origin; methods default to `GET`, `POST`, `PUT`, `PATCH`,
  `DELETE`; request and response bodies are streamed with a 10 MiB default
  limit; the person's cookie and every hop-by-hop header are stripped; a redirect
  from an upstream is never followed. An empty allowlist proxies nothing.
- **Runtimes.** ESM only, Node 24, React 19, the current Next major at the
  start of the build, Fastify 5 and Express 5 as peers. A CommonJS app can
  `import()` an ESM package, and the guides say so.
- **Token claims.** Odudu sends `iss` in every authorization response
  (`docs/protocols/rfc9207.md`, rows 2) and `azp` is checked when present, as
  OIDC Core requires. The core is strict by default with no option to relax
  `iss`.
- **The `node` differential.** The oracle and its fixtures live in
  `sdks/node/test`; the Python package reads the same fixture files from
  `sdks/node/test/fixtures`, so there is one copy.

## Decisions to record

- **ADR 0053:** SDKs live in `sdks/*`, are Apache-2.0, version by their own
  tag, and import no server package (the dependency rule).
- **ADR 0054:** the BFF's cookie, CSRF, store and refresh rules, and why the
  React package's in-browser mode exists beside it.
- `rfc10017.md` in the protocols directory: the reading note for the BFF cases.

## Performance and scale (ADR 0041)

- **Verification (`node`):** one JWKS fetch per key set per TTL, a key cache
  bounded by key count, unknown-`kid` refetch rate-limited per issuer; per
  request cost is one signature verification and no I/O.
- **BFF:** the default store is bounded (maximum sessions, idle expiry, a sweep
  on insert); the guide states that 1,000,000 sessions belong in a shared store
  the app supplies. Refresh is single-flight, so a burst of requests spends one
  refresh. The proxy streams and holds no body in memory beyond a stated limit.
- **Clients:** list helpers page by cursor and stop at a caller-set bound; none
  collects an unbounded collection. The generated code adds no per-call work
  beyond serialisation.
- **Servers:** the "me" document is built once at boot; `/me/openapi.json` sends
  that value. The admin document's size ceiling is the measured check.
- **Tenants:** the SDKs hold per-tenant state only by issuer key; a process
  serving 10,000 tenants holds one bounded discovery entry per tenant it has
  seen, with eviction (the cache bound states the number).

## Exit criteria

1. Both OpenAPI documents use shared components; the admin document is smaller
   than before by a measured amount and a test pins its ceiling; the "me"
   document equals `ME_ROUTES` both ways and is served and published.
2. Each of the eight npm packages and the PyPI package builds, passes its tests
   and publishes in dry run; versions and changelogs are per package.
3. Each example runs in the `sdks` job against the quick start stack; the
   regeneration check and the MCP catalogue check are green.
4. `npx @odudu-io/mcp-stdio` (from a packed tarball) completes a sign-in and a
   read call on a machine whose `PATH` has no `odudu` and no checkout.
5. An SDKs section with an index, a page per package, an examples page showing all nine examples, the BFF page and the no-React guide; the four existing examples and their guides run on the SDKs; the introduction, `README.md`, the landing page, the
   console and docs that said "no SDK" are corrected; transcripts re-run.
6. Section 11 and the roadmap agree both ways (`roadmap-section-11.test.ts`);
   the two P4i rows in `docs/NEXT.md` are gone; `CHANGELOG.md` `Unreleased`
   holds the phase; `docs/phases/p4i.md` records what building it found.
7. The licence boundary: `licence-fields`, the dependency rule and the
   boundary fixture are green with no allowlist.
8. CI is green on the pushed branch and every review thread is answered.

## Left to the planner

Task order inside the increments, the exact generator versions the spikes pick,
the Python layout (`src/odudu`), test frameworks per package, and the hours: the
section 11 row says 60 to 90, and this scope is larger. The row's range is
recomputed when the plan is written, with the totals, as earlier phases did.

## Spikes the plan opens with

| Spike | Question                                                                                                                               | Done when                           |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| S1    | Do `oauth4webapi`, `jose`, `openapi-typescript`, `openapi-fetch` and the Python generator run on Node 24 and handle our two documents? | each command run, output recorded   |
| S2    | Does the stdio code compile with no import of `protocol-*` once the catalogue is data?                                                 | `dependency-cruiser` result         |
| S3    | Does a Next App Router app build with the BFF handlers on the pinned version?                                                          | an example builds and signs in      |
| S4    | Does a scoped npm package publish in dry run with provenance, and a PyPI package build and pass `twine check`?                         | both commands run                   |
| S6    | Does a refresh with a changed `resource` work against a built stack?                                                                   | the request run, response recorded  |
| S5    | Do the names in the plan exist unclaimed on npm and PyPI?                                                                              | `npm view` and the PyPI JSON lookup |
