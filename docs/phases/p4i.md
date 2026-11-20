# P4i: SDKs

Notes the phase records as it goes. Spikes come first, because the plan's
later tasks read them.

## Spikes

### S5: registry names

Checked on 2026-11-20 from a machine with no npm login (`npm whoami` fails
with `ENEEDAUTH`), so every answer below comes from the public registry.

verified: `npm view @odudu/<name> name version` for each name. Every one
returned `npm error code E404` ("404 Not Found - GET
https://registry.npmjs.org/@odudu%2f<name>"), which means no such package.

| npm name              | Result    |
| --------------------- | --------- |
| `@odudu/oidc`         | unclaimed |
| `@odudu/react`        | unclaimed |
| `@odudu/bff`          | unclaimed |
| `@odudu/next`         | unclaimed |
| `@odudu/node`         | unclaimed |
| `@odudu/admin-client` | unclaimed |
| `@odudu/me-client`    | unclaimed |
| `@odudu/mcp-stdio`    | unclaimed |

verified: `curl -s https://pypi.org/pypi/odudu/json` returned
`{"message": "Not Found"}` with status 404. The PyPI project `odudu` is
unclaimed. The spec's "the `odudu` project exists on PyPI" therefore means the
owner creates a pending publisher for it, because the name is free, and the
name stays unreserved until the first publish uses that publisher.

The scope is not free, and that is expected rather than a collision:

- verified: `npm org ls odudu` prints `odudu - owner`, and
  `curl -s https://registry.npmjs.org/-/org/odudu/user` returns
  `{"odudu":"owner"}`. The npm organization `@odudu` exists and its one
  member, the npm user `odudu`, is its owner.
- verified: `npm access list packages @odudu` prints
  `noboarding: read-write`, so the scope lists a package named
  `@odudu/noboarding`. `npm view @odudu/noboarding` returns E404 without a
  login, so the package is private or unpublished. It does not collide with
  any name this phase publishes.
- unknown: whether the npm user `odudu` is the person who will publish. The
  owner must confirm that they control it before the first publish.

### S4: publish dry runs

verified, npm. A scratch package (`package.json` with name `@odudu/probe`,
version `0.0.0`, `"type": "module"`, `"files": ["dist"]`, an `exports` map and
`"publishConfig": {"access": "public"}`, plus one file `dist/index.js`) in the
session scratchpad, not in the repository, with Node 24.15.0 and npm 11.12.1:

```text
$ npm pack
npm notice package: @odudu/probe@0.0.0
npm notice Tarball Contents
npm notice 24B dist/index.js
npm notice 168B package.json
npm notice package size: 268 B
npm notice total files: 2
odudu-probe-0.0.0.tgz

$ npm publish --dry-run --provenance=false
npm warn This command requires you to be logged in to https://registry.npmjs.org/ (dry-run)
npm notice Publishing to https://registry.npmjs.org/ with tag latest and public access (dry-run)
+ @odudu/probe@0.0.0
```

The dry run succeeds without a login. It does not prove that a scoped public
publish will be accepted; only the real first publish does, and that needs
the owner's registry configuration below.

unknown: whether `npm publish --dry-run` with provenance enabled works. The
provenance dry run was not exercised outside GitHub Actions, and every
command above passes `--provenance=false`.

The scratch setup, rebuilt and re-run on 2026-11-20 from the commands above
(the first run's file contents were not kept, so these are a reconstruction
that gave the same results, not a copy):

```text
mkdir -p s4/npm/dist s4/py/src/odudu_probe && cd s4
# npm/package.json
{ "name": "@odudu/probe", "version": "0.0.0", "type": "module",
  "files": ["dist"], "exports": { ".": "./dist/index.js" },
  "publishConfig": { "access": "public" } }
echo "export const probe = 1;" > npm/dist/index.js
(cd npm && npm pack && npm publish --dry-run --provenance=false)

# py/pyproject.toml
[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
[project]
name = "odudu-probe"
version = "0.0.0"
readme = "README.md"
echo "# probe" > py/README.md; : > py/src/odudu_probe/__init__.py
python3 -m venv py/.venv
py/.venv/bin/pip install build==1.6.1 twine==7.0.0
(cd py && .venv/bin/python -m build && .venv/bin/twine check dist/*)
```

The re-run printed the same results, except that the wheel is tagged
`py2.py3-none-any` rather than `py3-none-any`, which the first run's
`pyproject.toml` (not recorded) evidently produced differently.

verified, PyPI. A scratch project (`pyproject.toml` with the `hatchling`
backend, project `odudu-probe` 0.0.0, a `src/odudu_probe/__init__.py`, a
`README.md`) with Python 3.14.7, `build` 1.6.1, `twine` 7.0.0 in a venv in
the scratchpad:

```text
$ python -m build
* Installed build dependency versions:
  - hatchling==1.33.0
Successfully built odudu_probe-0.0.0.tar.gz and odudu_probe-0.0.0-py3-none-any.whl

$ twine check dist/*
Checking dist/odudu_probe-0.0.0-py3-none-any.whl: PASSED
Checking dist/odudu_probe-0.0.0.tar.gz: PASSED
```

`python -m build` installs its build backend from the network into an
isolated environment, so a CI job running it needs network access.

### Trusted publishing: what each registry asks the owner to set

Read from the registries' own pages on 2026-11-20 with a web fetch of
<https://docs.npmjs.com/trusted-publishers> and
<https://docs.pypi.org/trusted-publishers/creating-a-project-through-oidc/>.
Nothing was configured or published.

npm, per package on npmjs.com:

- Organization or user, repository, and workflow filename (filename only,
  with `.yml` or `.yaml`, in `.github/workflows/`). Optional: an environment
  name, and which actions are allowed (`npm stage publish` is always allowed;
  direct `npm publish` and `npm dist-tag` can be added).
- The workflow needs `id-token: write`, npm CLI 11.5.1 or later and Node
  22.14.0 or later, on a GitHub-hosted runner. Self-hosted runners are not
  supported.
- Provenance is generated automatically for a public repository and a public
  package, so no `--provenance` flag is needed. `repository.url` in
  `package.json` must match the GitHub repository exactly.
- npm does not validate the configuration when it is saved, so a mismatch
  shows only at publish time. A new configuration must complete its first
  successful publish within 2 days or it expires.
- unknown: whether a trusted publisher can be configured for a package that
  has never been published. The page gives no steps for a brand-new package,
  so the owner should expect to find out in the npm UI before the release
  workflow depends on it.

PyPI, a pending publisher for a project that does not exist yet:

- The same fields as a normal publisher (for GitHub: repository owner,
  repository, workflow filename, optional environment) plus the name of the
  project to create, here `odudu`.
- The project is created by the first publish that uses the publisher, which
  then becomes a normal publisher. The name is not reserved until then; if
  someone else registers `odudu` first, the pending publisher is invalidated.
- unknown: the workflow permission and action. The fetched page names neither
  `id-token: write` nor a publishing action, so the release workflow's use of
  them is an assumption: the workflow needs `id-token: write`, and the
  PyPA publish action is the usual consumer.

### S1: libraries and generators

Run on 2026-11-20 with Node 24.15.0, npm 11.12.1 and Python 3.14.7, in
scratch directories outside the repository. Versions are the newest release
older than two weeks for the JavaScript packages, and the newest older than
24 hours for the Python ones (the repository's `minimumReleaseAge` is 1440
minutes).

#### The document

verified: `pnpm --filter @odudu/docs generate` printed `generated 126 files`
and wrote `apps/docs/static/openapi/admin.json` (git-ignored, not committed):
`openapi` `3.1.0`, 113 paths, 2,305,358 bytes. Only four schemas are in
`components.schemas` (`ProblemDetails`, `ThemeBody`, `Palette`, `Logo`);
every other request and response body is inlined, problem responses included.
The generator figures below are the baseline for comparing once shared
problem components exist.

#### (a) oauth4webapi and jose on Node 24 and in a browser bundle

| Package              | Version |
| -------------------- | ------- |
| `oauth4webapi`       | 3.8.8   |
| `jose`               | 6.2.15  |
| `openapi-typescript` | 7.13.0  |
| `openapi-fetch`      | 0.17.0  |
| `vite`               | 8.3.6   |

verified: `node --input-type=module -e "const a=await import('oauth4webapi');
const j=await import('jose');console.log(typeof a.discoveryRequest, typeof
j.jwtVerify, Object.keys(a).length)"` printed `function function 95`. Both
import on Node 24.

verified: a page whose `main.js` is
`import * as oauth from 'oauth4webapi'; import { jwtVerify } from 'jose';
console.log(oauth.discoveryRequest, jwtVerify);` and whose `index.html` is
one `<script type="module">` tag, built with `npx vite build`:
`51 modules transformed`, `dist/assets/index-B15YPlU-.js  17.38 kB | gzip:
6.60 kB`, `built in 43ms`. Both bundle for a browser. The bundle was built
and not run in a browser.

#### (b) openapi-typescript and openapi-fetch

verified: `npx openapi-typescript ../admin.json -o ../out.d.ts` printed
`openapi-typescript 7.13.0` and `../admin.json -> ../out.d.ts [471.5ms]`, with
no warnings or errors. The output is 20,915 lines and 1,033,865 bytes.

verified: a file doing `import createClient from 'openapi-fetch'; import type
{ paths } from '../out.d.ts'; const c = createClient<paths>({ baseUrl:
'http://x' }); export const f = c.GET;`, checked with `npx tsc --noEmit
--strict --skipLibCheck --module esnext --moduleResolution bundler
--allowImportingTsExtensions t.ts` (TypeScript 5.9.3), exited 0. The OpenAPI
3.1 document is accepted without hand-patching and the generated `paths`
type works with `openapi-fetch`. Not checked: that individual calls typecheck
against real operations.

#### (c) Python generators

Both ran in one venv (`python3 -m venv pv`; `pip install
openapi-python-client datamodel-code-generator httpx`) against the same
document. `openapi-python-client` 0.30.0 was published 2026-11-07. The newest
`datamodel-code-generator`, 0.99.0, was published 2026-11-20 07:09 UTC, less
than 24 hours before the run, so it was replaced by 0.98.0 (2026-11-18).

`openapi-python-client`: verified: `openapi-python-client generate --path
admin.json --meta none --output-path client` exited 0 in 3.5 seconds and
printed `Warning(s) encountered while generating. Client was generated, but
some pieces may be missing`. Five warnings, all for binary bodies:

- `POST /admin/tenants/{tenant}/theme/assets` (three: `Unsupported content
type` for `image/png`, `image/jpeg`, `image/webp`);
- `GET /admin/tenants/{tenant}/theme/assets/{assetId}/content` (`Unsupported
content_type image/*`, response omitted);
- `GET /admin/tenants/{tenant}/audit/export` (the warning prints no message;
  an operation module for it was still generated, and what it parses from the
  response was not inspected).

The output is 1,727 Python files, 192,320 lines, 9.1 MB, of which 1,563 are
models (a class per inline body and per status code, for example
`delete_admin_tenants_tenant_clients_id_grants_response_401`) and 160 are
operation modules. Each operation module has `sync`, `sync_detailed`,
`asyncio` and `asyncio_detailed`, on `httpx`. The generated code imports and
exposes `Client` and `AuthenticatedClient`. `mypy --strict client` reports
12 errors, all in the generated `client.py` (`__exit__`/`__aexit__` argument
types), none in a model.

`datamodel-code-generator` 0.98.0: verified, models only, no client:

- default scope (`datamodel-codegen --input admin.json --input-file-type
openapi --output dmcg.py --output-model-type pydantic_v2.BaseModel
--use-annotated`): 252 lines, 12 classes, exactly the four components and
  their children, no model for any operation body;
- with `--openapi-scopes schemas paths --use-annotated --formatters black
isort`: 20,537 lines, 1,319 classes; it warned `NamingHintWarning: 515 of
826 class names are numbered collisions (Item1...Item38)` (the 826 count is
  from the run without `--use-annotated`), and `mypy --strict` reports one
  error (a `str` field with a `None` default at line 5390). Without
  `--use-annotated` it emitted `conint(...)` annotations and `mypy --strict`
  reported 732 errors, so that flag is needed. The module imports.

Decision: `openapi-python-client`. It is the only one of the two that emits
typed models and sync and async `httpx` clients from one run, and it needed no
hand-patching of the document. `datamodel-code-generator` emits Pydantic models
only, so the transport would be hand-written around them, and the numbered
collision names (`Item1`...) are, inferred: a result of inline schemas, which
stay inline until shared components exist.

Rejected: `datamodel-code-generator`, for those reasons. It stays the fallback
if the hand-written transport has to wrap its own models.

Consequences for later tasks:

- The generator does not handle the binary bodies of the theme asset upload and
  download; the warnings above name the routes the hand-written transport
  covers. The audit export needs a look at the generated module first.
- unknown: how the output size and the class count change once problem
  schemas are shared components. Re-run the same two commands after that and
  compare with 1,563 models and 192,320 lines.
- unknown: whether the attrs models of `openapi-python-client` suit the
  hand-written layer; not tried.
- unknown: both generators against the `me` document. It does not exist yet
  (a later task builds it), so only `admin.json` was run.
- unknown: the shared-components shape the spec lists as an assumption this
  spike settles. The admin document still inlines its problem schemas, so no
  generator has seen the shared shape. The client-generation task re-runs both
  generators on the rebuilt `admin.json` and on `me.json` and records the
  result.
- unknown: Python 3.10 compatibility of the generated code. It was run on
  3.14.7 only.

### S2: the `odudu mcp` cut

Checked on 2026-11-20 at commit `5420b15e3`. The question: what the files
`apps/server/src/cli/mcp.ts` uses from `@odudu/mcp` import in turn, and whether
the stdio side can be cut into a package that imports no `@odudu/*` package.

Method. verified: `pnpm exec depcruise --config .dependency-cruiser.cjs
--include-only '^packages/mcp/src' --output-type json packages/mcp/src` exits 0
and lists 172 modules. It is no use for this question: `--include-only` drops
every edge that leaves `packages/mcp/src`, and a workspace package resolves to
a path outside it, so the edges to `@odudu/*` do not appear. The closure below
was computed instead by following every `#/` import (and every re-export) from
the files that define the stdio-side exports, with a small script kept in the
scratchpad: each `import` and `export ... from` statement of each file, test
files excluded. verified: it reports 20 entry files and a closure of 76 files.
The entry files are the definitions of the exports `mcp.ts` takes from the
package (`createHttpCaller`, `createOauthClient`, `listenOnLoopback`,
`createBrowserOpener`, `createCredentialStore`, `runTool`, `toolServer`,
`loopbackLogin`, `createTokenSource`, `serveMcpStdio`, `stdioTarget`,
`StdioError`, `renewableWriteBudget`, `callMcpTool`, `TOOLS`, `visibleTools`,
`directCallerTools`, and the helpers `mcp.ts` also takes: `createFileLock`,
`fileModeProblem`, `configDirectory`, `failureLine`).

#### What leaves the package

Of the 76 files, 14 import something that is not a sibling, a Node built-in or
an npm package. Every edge below is a value import unless marked type.

| File (under `packages/mcp/src/`)       | Imports                                                                      | What it uses                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `service/stdio-target.ts`              | `@odudu/kernel`                                                              | `addressIssuer`, `domainAddress`, `pathAddress`: three one-line functions |
| `service/admin-access.ts`              | `@odudu/protocol-oidc`                                                       | `MCP_READ_SCOPE`, `MCP_WRITE_SCOPE`                                       |
| `service/visible-tools.ts`             | `@odudu/protocol-admin`, `@odudu/protocol-oidc`                              | `ADMIN_ROUTES` (the whole route table), the two scope names               |
| `service/tool.ts`                      | `@odudu/protocol-admin` (type)                                               | `AdminCapability`                                                         |
| `service/read-tool.ts`                 | `@odudu/contracts/admin`, `@odudu/protocol-admin` (type)                     | `MAX_LIMIT`, `AdminCapability`                                            |
| `service/write-tool.ts`                | `@odudu/contracts`, `@odudu/contracts/admin`, `@odudu/protocol-admin` (type) | `noBidiControls`, `LOCALISED_TEXT_ENTRIES_MAX`, two length limits         |
| `service/sanitize.ts`                  | `@odudu/contracts`                                                           | `stripBidiControls`                                                       |
| `service/deps.ts`                      | `@odudu/protocol-oidc` (type), `fastify` (type)                              | `MintAgentTokenInput` and a Fastify type, for the in-process endpoint     |
| `service/theme-draft.ts`               | `@odudu/contracts` (type), `@odudu/contracts/admin`                          | `ThemeBodyWire`, `themeViewSchema`                                        |
| `service/tools/theme-write.ts`         | `@odudu/contracts`, `@odudu/contracts/admin`, `@odudu/protocol-admin` (type) | theme limits, three response schemas                                      |
| `service/tools/settings-write.ts`      | `@odudu/contracts`, `@odudu/contracts/admin`                                 | `LOCALISED_TEXT_ENTRIES_MAX`, `DISPLAY_NAME_MAX`, `settingsSchema`        |
| `service/tools/*.ts` (the other files) | `@odudu/contracts/admin`                                                     | the Zod response schema of each admin route the tool reads or writes      |

No file of the closure imports `@odudu/protocol-oidc` or
`@odudu/protocol-admin` for anything beyond the three uses in the table: two
scope-name constants, the route table, and the `AdminCapability` and
`MintAgentTokenInput` types. verified: `grep -n "@odudu/"` over the files
above. All other files of the closure import only siblings, `node:*`, `zod`,
`@modelcontextprotocol/server` and `@modelcontextprotocol/server/stdio` (the
last two in `adapter/tool-server.ts` and `view/stdio.ts`).

Beyond the package, `apps/server/src/cli/mcp.ts` itself imports
`loadClientKey`, `generateClientKey`, `signClientAssertion` from
`@odudu/crypto` and `ADMIN_API_AUDIENCE`, `MCP_CLIENT_ID`,
`SYSTEM_TENANT_NAME` from `@odudu/domain-tenant`. verified: reading
`mcp.ts` lines 1 to 10. `packages/crypto/src/service/client-key.ts` imports
`OduduError` from `@odudu/kernel`, `jose`, `node:crypto` and a sibling
(`#/service/jwks`). unknown: what `jwks.ts` imports; it was not followed. The
three `domain-tenant` constants are the strings `urn:odudu:params:admin-api`,
`odudu-mcp` and `system` (verified: `grep` in
`packages/domain-tenant/src/service/`), and `MCP_READ_SCOPE` and
`MCP_WRITE_SCOPE` are `mcp:read` and `mcp:write`.

Consequences. A package that is a copy of this closure can import nothing from
`@odudu/*` once these are replaced:

- `@odudu/kernel`: copy the three address functions, 11 lines in
  `packages/kernel/src/address.ts`.
- The five string constants above: copy.
- `@odudu/protocol-admin` and `@odudu/protocol-oidc` in `visible-tools.ts` and
  `admin-access.ts`: nothing to copy but the constants. inferred: the route
  table is not needed on the stdio path. `mcp.ts` calls
  `visibleTools(directCallerTools(TOOLS), [scope], null, inSystemTenant)`, with
  `capabilities` null, and `toolVisible` returns before it reads `ALSO_ADMITS`
  when `capabilities === null`. So `ADMIN_ROUTES` is loaded (it imports the
  whole `@odudu/protocol-admin` package, with its database and Fastify
  dependencies) only to build a map that is never read in this command.
- Type-only imports (`AdminCapability`, `MintAgentTokenInput`, the Fastify
  type) disappear with a local string-union type for the capability and by
  splitting `service/deps.ts`: `usecase/call-mcp-tool.ts` takes
  `McpCallDeps` from it, and `mcp.ts` uses its logger shape, so the logger type
  moves and the in-process endpoint's types stay on the server. unknown: not
  tried.
- `@odudu/contracts` and `@odudu/contracts/admin`: this is the only real
  dependency. It supplies the Zod schemas of the responses (see below), the
  length limits, and `stripBidiControls` and `noBidiControls`. The two bidi
  helpers and the five limits (`MAX_LIMIT`, `CLIENT_NAME_MAX`,
  `DESCRIPTION_MAX`, `DISPLAY_NAME_MAX`, `LOCALISED_TEXT_ENTRIES_MAX`) are
  plain values to copy or generate. The response schemas are not.

#### What the catalogue depends on

verified: a throwaway Vitest file importing `TOOLS` and `directCallerTools`
from `@odudu/mcp` (run with `pnpm exec vitest run --config vitest.config.ts`,
then deleted) printed: `TOOLS 76` (`GET` 64, `PATCH` 5, `POST` 3, `PUT` 3,
`DELETE` 1) and `direct 69` (`GET` 64, `PATCH` 5). `directCallerTools` is what
`odudu mcp` serves, so 69 tools matter: the five writes are
`update_client_metadata`, `update_group_description`, `update_role_description`,
`update_scope_metadata` and `update_tenant_text_settings`, each a `PATCH` with
`spends: 'mutating'`. The 7 tools left out (create, put, delete, theme draft
`PUT`) are served by the tenant's MCP endpoint only.

Each tool of the 69 is built by one of three factories in
`service/read-tool.ts` and `service/write-tool.ts` (`pageTool`, `valueTool`,
`contentWriteTool`/`metadataTool`), plus `defineTool`, which validates the
input and the output. The only tool with logic of its own is
`service/tools/theme-write.ts` (a read of the draft, an etag comparison, a merge
and a `PUT`), and neither of its tools is in the 69. verified: `grep -n "run:"
service/tools/*.ts` finds one hit outside tests, in `theme-write.ts`.

What the stdio client needs per tool to build and answer the admin request:

- `name`, `description` (the text already includes the data notice), `access`
  (`read` or `write`), `annotations` (three booleans), `routeKey`
  (`METHOD /admin/tenants/:tenant/...`) and, for a write, `spends`.
- The input as JSON Schema. verified: `tool.input['~standard'].jsonSchema` is how
  `adapter/tool-server.ts` already lists the input; the first of the 69 gives a
  draft 2020-12 document with `type`, `enum`, `format`, `pattern`.
- Which input fields are path parameters (`pathParams`, `:id`, `:assetId`) and
  that every other one of a read is a query parameter; for a write, `mode`
  (`amend` for all five) and `bodyFields`, the field names sent as the body.
- How the answer is cut to a result: the kind (`page`: rows under `items` and
  the cursor under `next`; `value`; write), `etag` (whether the entity tag is
  passed back), `longText` (dot paths whose strings may run to 128 KiB), and
  `tooLargeDetail` (only `get_theme` and `get_client_theme` have one).
- The output schema, for `defineTool`'s check of the answer. This is the part
  that depends on `@odudu/contracts/admin`.

What is not data: the cross-field checks in the schemas' `superRefine`, which
the JSON Schema may not carry. verified by reading: `inputOf` in `read-tool.ts`
refuses any string over 1,024 characters; `contentWriteTool`'s `checked` refuses
an amend naming no field and a body over 60,000 bytes (or `bodyCap`);
`localisedField` refuses more than `LOCALISED_TEXT_ENTRIES_MAX` languages.
unknown: how much of this `z.toJSONSchema` carries (the first two are
`maxLength` and `minProperties` in spirit but are written as refinements, so
probably not). All three are driven by data the catalogue holds (`bodyFields`,
`bodyCap`) or are constants, so the stdio client can run them as generic code
instead of as per-tool Zod code. `sanitize.ts` (`cleanData`, `cleanText`) and
`call-tool.ts` (`problemOf`, `errorResult`, the 256,000-byte result cap) are
generic and move as they are.

#### Conclusion

Feasible as planned, with one condition. The catalogue can be a generated JSON
file, because no tool among the 69 that `odudu mcp` serves needs server-side
logic: a `GET` read, or a `PATCH` of named fields under `If-Match`. Each entry
holds `name`, `description`, `routeKey`, `access`, `annotations`, `spends`,
`pathParams`, `bodyFields`, `etag`, `longText`, `tooLargeDetail`, `bodyCap`,
the input JSON Schema, and the response as JSON Schema. The path-segment,
sanitizing, result-cap and cursor code is generic and moves as hand-written
code. The three admin-request builders in `service/admin-request.ts` and
`service/admin-path.ts` import nothing outside the package.

The condition is the response schemas. The tools validate what the admin API
answers with the Zod schemas of `@odudu/contracts/admin`. A package with no
`@odudu/*` import cannot hold them, so the check of the answer is either
replaced by a JSON Schema validator over the generated `response` (adds a
dependency; unknown which, not tried) or dropped for a shape check of the
fields the tool reads (`items`, `next`, `etag`). Dropping it changes what
`defineTool` guarantees (`mcp:unexpected_response` for an answer that is not
the documented one), which the plan should decide. No fallback of vendoring
the Zod schemas is needed to make the cut work. If the JSON Schema route is
refused, the fallback is a generated `.ts` file of Zod schemas shipped in the
SDK package (a generator for it does not exist; not tried).

Not decided here: the three things `mcp.ts` takes from `@odudu/crypto`
(`signClientAssertion` and two key helpers, on `jose`); they cannot be cut
without the plan saying what the SDK's `jose` dependency is.

### S6: refresh with a changed resource

Checked on 2026-11-20 against an image built from the worktree at `5420b15e3`
(`docker build -f infra/docker/Dockerfile`, as `.github/actions/image/action.yml`
does), started with `quickstart/stack.sh up <image> 3217` under the project
`odudu-p4i-s6` and removed with `stack.sh down` and `docker rmi` after the
runs. A tenant `s6demo` with the person `ada` and three public clients was
seeded with `odudu seed` inside the container, as `examples/_shared/provision.sh`
does. Sign-in was a PKCE code flow driven by a Node script (the HTML sign-in
form, then the code at the redirect URI, then `POST /token`), kept in the
scratchpad and not committed. Tokens are truncated below to 12 characters and
their length; `aud` and `scope` are read from the access token's payload.

Clients. verified: `docker compose exec -T odudu odudu seed client --tenant
s6demo --client-id <id> --public --grant-type authorization_code --grant-type
refresh_token --redirect-uri http://127.0.0.1:8080/callback ...`:

- `s6-me`: `--audience <issuer>/me --audience https://other.example.test/api
--allow-action verify-email`. The last flag is how a client gets the
  `me:read` scope (`odudu seed client --help`: it "assigns me:read to the
  client"). Without it, the first client I made (`s6-app`, no `--allow-action`)
  was refused `openid me:read offline_access` with `invalid_scope` at
  `/authorize`.
- `s6-multi`: `--audience https://a.example.test/api --audience
https://b.example.test/api`, no `me` scope.

`ME` below is `http://localhost:3217/tenants/s6demo/me`, the issuer being
`http://localhost:3217/tenants/s6demo`.

#### Run A: a grant authorized with `resource=ME`

verified: `/authorize` with `scope=openid me:read offline_access` and
`resource=ME`, then `POST /token grant_type=authorization_code` answered `200`
with `scope` `openid me:read offline_access`, a refresh token and an access
token whose `aud` is `[ME, <issuer>]`. Then, each on the refresh token the
previous successful call returned (a refused call leaves the token usable):

| Case | `POST /token` (`client_id` and `refresh_token` omitted) | Status and body                                                                                              |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| a    | `grant_type=refresh_token&resource=ME`                  | `200`, `aud` `[ME, issuer]`, same scope, a rotated refresh token                                             |
| b1   | `resource=https://other.example.test/api`               | `400 {"error":"invalid_target","error_description":"A requested resource is not available to this client."}` |
| b2   | no `resource`                                           | `200`, `aud` `[ME, issuer]`, same scope                                                                      |
| b3   | `resource=<issuer>`                                     | `400 {"error":"invalid_scope","error_description":"A requested scope is not available to this client."}`     |
| c    | `resource=https://not-allowed.example.test/api`         | `400 {"error":"invalid_target","error_description":"A requested resource is not available to this client."}` |
| e    | two `resource` parameters (`ME` and the other)          | `400 invalid_target`, the same body                                                                          |

Case b1 is the important one: `https://other.example.test/api` is in the
client's own audience list, and the refresh still refuses it, because the
grant was authorized for `ME` alone. The refusal is `invalid_target` and is the
same one case c gets, so a caller cannot tell "not allowed for this client" from
"allowed, but not part of this grant". Case b3 is refused for the scope, not the
resource: a `me:read` token cannot have an audience of the issuer alone, as
`scopesCoherentWithAudience` in
`packages/protocol-oidc/src/service/mcp-scopes.ts` requires (verified by
reading).

Scope on a refresh, same client and a fresh sign-in (run C), verified:

| Case | Request                                              | Result                                                     |
| ---- | ---------------------------------------------------- | ---------------------------------------------------------- |
| h    | `scope=openid`, no `resource`                        | `400 invalid_scope`                                        |
| i    | `scope=openid me:read`, `resource=ME`                | `200`, `scope` `openid me:read` (`offline_access` dropped) |
| j    | `scope=openid me:read offline_access`, `resource=ME` | `200`, full scope                                          |

inferred: case h fails because the grant's audience contains `ME` and the
scope no longer holds a `me` scope; a fresh `/authorize` with `scope=openid`
only, for the same client and for `s6-app`, which has no `me:read`, also gives
`invalid_scope` (verified), and so does `openid offline_access` with
`resource=ME`. That is the converse of the rule the code comment states, and
fits all five observations. unknown: the code line that applies it was not
found.

#### Run B: a grant with no `resource` (`s6-multi`)

verified: `/authorize` with `scope=openid offline_access` and no `resource`
gave an access token with `aud` `[a, b, issuer]`, where `a` and `b` are the
client's two audiences. Then:

| Case | `POST /token` refresh       | Result                        |
| ---- | --------------------------- | ----------------------------- |
| f    | `resource=a`                | `200`, `aud` `[a, issuer]`    |
| g    | `resource=b` (on f's token) | `200`, `aud` `[b, issuer]`    |
| h2   | no `resource`               | `200`, `aud` `[a, b, issuer]` |

So a narrowing at a refresh applies to that access token only. The grant keeps
the audience it was authorized with, and the next refresh may name any member of
it.

#### What the core's `refresh` should be

`refresh(tokens, { resource })` maps to `grant_type=refresh_token` with that
`resource` parameter, and its contract is:

- `resource` may be any audience the original authorization carried: with
  `resource` at `/authorize`, that one; with none, every audience the client is
  registered for. It selects one of them for this access token.
- A `resource` outside that set, whether or not the client may ask for it at
  `/authorize`, is `400 invalid_target`. The core does not retry. It reports the
  error with a code the caller can act on (a distinct `invalid_target` error)
  and says that reaching that resource needs a new authorization (a new
  `/authorize` with that `resource`).
- No `resource` keeps what the grant has. The core passes none by default and
  sends `resource` only when the caller asks for one.
- The core passes `scope` unchanged (or none) and does not narrow it to
  something with no `me` scope while the audience is `me`: that is
  `invalid_scope`.
- A refresh rotates the refresh token on success (cases a, b2 each returned a
  new one), and the core stores the new one. verified: every `200` above carried
  a `refresh_token` different from the one sent.

A second authorization (`prompt=none`) is therefore required to get a token for
an audience the first authorization did not name, and is not needed to switch
among the audiences it did. unknown: whether `prompt=none` returns a code
without interaction when the session is live and the new `resource` is allowed;
not run, because the spike's question was the refresh. The SDK plan should keep
one authorization per audience it needs (for example `me` for the account
page, the admin API in a separate sign-in) rather than rely on a later
`resource` at a refresh.

### S3: Next.js App Router with the BFF handlers

Checked on 2026-11-20 on Node 24.15.0 and npm 11.12.1.

Version. verified: `npm view next dist-tags --json` gives `latest: 16.4.6`,
and `npm view next time --json` gives `"16.4.6": "2026-11-09T20:33:38.821Z"`,
eleven days before the check; the repository's `minimumReleaseAge` is 1440
minutes (`pnpm-workspace.yaml`). `examples/next` pins `next` 16.4.6 exactly,
beside `react` and `react-dom` 19.3.1, the version `sdks/react` pins.
`sdks/next` takes `next` ^16.0.0 and `react` ^19.0.0 as peers and `next`
16.4.6 as a dev dependency (added to `pnpm-lock.yaml`: seven packages, `next`
and its SWC binary among them).

The example. `examples/next` is not a pnpm workspace member (`pnpm-workspace.yaml`
lists `apps`, `packages`, `tools`, `sdks` and `tests`) and installs with npm,
like the other examples, so it depends on the two SDKs as `file:` links to the
built packages: `@odudu-io/bff` and `@odudu-io/next` at `file:../../sdks/...`.
npm symlinks them, so `pnpm --filter @odudu-io/next build` must run first. It
holds `lib/odudu.ts` (`createOduduHandlers`), the catch-all
`app/api/auth/[...odudu]/route.ts`, a server component page that calls
`getSession()`, a protected `/dashboard`, and `proxy.ts` with `withAuth`.

Build. verified: `cd examples/next && npm install --ignore-scripts && npm run
typecheck && npx next build` ends with `Compiled successfully` (Turbopack, the
default in 16), and routes `/` (dynamic), `/api/auth/[...odudu]` and
`/dashboard`, and `Proxy (Middleware)`.

Against a live issuer. verified: a stack from the existing `odudu-try-odudu`
image (the image the port 3090 try stack runs; not rebuilt from this branch),
started with `quickstart/stack.sh up odudu-try-odudu 3219` under the project
`odudu-p4i-s3` and removed with `stack.sh down`. In the `demo` tenant,
`odudu seed` made `ada` and the client `example-next` (confidential, redirect
`http://localhost:8085/api/auth/callback`, `authorization_code` and
`refresh_token`). The app ran as `next start --port 8085` with
`ODUDU_BASE=http://localhost:3219` and was stopped afterwards. A Node script
(scratchpad, not committed) drove it with `fetch`, handling cookies by hand
because `__Host-` cookies are `Secure` and the script runs over http:

```text
login status                       302
login set-cookie count             2
issuer authenticate status         302
callback status                    302
callback location                  /dashboard?tab=2
callback set-cookie names          __Host-odudu, __Host-odudu-login, __Host-odudu-return
dashboard status                   200
dashboard text                     Hello, 01a1fa63-cbc7-73fd-9813-719fb9245b4f.
session status                     200
session body has a JWT             false
anon dashboard                     307 /api/auth/login?returnTo=%2Fdashboard
logout status                      200
logout clears cookie               true
home after logout                  Signed out.
unknown route                      404
```

The listed lines are the ones that bear on the SDK; the script printed three
more (the redirect back to the app, the home page signed in and the session
body). The home page read `Signed in as` followed by nothing only because the
script's pattern stops at the `<!-- -->` React puts between text parts.

What the pinned Next does:

- `cookies()` is asynchronous. verified: `node_modules/next/dist/server/request/cookies.d.ts`
  declares `cookies(): Promise<ReadonlyRequestCookies>`, and the server
  component's `await cookies()` returned the browser's cookies in the run above.
  `getSession` reads the session cookie with `get()` and the record from the
  store, and never refreshes: each module graph has its own refresh guard, so a
  render could spend a rotating refresh token twice. Refreshing stays with the
  route handlers and the proxy.
- A route handler receives a standard `Request` (a `NextRequest`), and its
  `Response` goes out as built. verified: the BFF handlers ran in the catch-all
  route unchanged, and the login answer carried two `Set-Cookie` lines and the
  callback three, each as the BFF wrote it (`Path=/; HttpOnly; Secure; SameSite=Lax`).
- Route `params` are a Promise (docs: `dist/docs/01-app/03-api-reference/03-file-conventions/route.md`).
  The SDK does not read them: it dispatches on the request's path against a
  `mountPath` option, so the folder name `[...odudu]` is free.
- `middleware.ts` is deprecated in 16; the file is `proxy.ts`, exporting
  `proxy` (docs: `proxy.md`), and it runs on the Node.js runtime. The `runtime`
  option is not available in it and throws if set (the same file, "Runtime").
  `withAuth` returns a plain function, so `export const proxy = withAuth(...)`
  works, and so does `export const middleware = ...` on Next 15.
  assumption: the Edge runtime is no longer offered for this file in 16; the
  docs say Node.js is the default and `runtime` is not accepted, and the SDK
  uses neither Node nor Edge-only APIs in `withAuth`.
- The proxy file is a separate module graph and "should not rely on shared
  modules or globals" (docs: `proxy.md`). assumption: the in-memory store the
  route handlers use is therefore not visible from the proxy. `withAuth`
  checks the cookie's shape by default and asks a store only when given one.
- `NextResponse.redirect` needs an absolute URL. verified: `NextResponse.redirect('/x')`
  throws `URL is malformed "/x". Please use only absolute URLs`;
  `NextResponse.redirect(new URL('/x', base))` answers 307. On the wire the
  `Location` the proxy sent was relative (`/api/auth/login?returnTo=%2Fdashboard`):
  Next rewrites a same-origin redirect.
- `next/server` and `next/headers` have no `exports` map, so under `nodenext`
  `tsc` refuses the bare specifier. verified: `tsc` error TS2307 for
  `from 'next/server'`, gone with `from 'next/server.js'`. The SDK imports the
  `.js` forms and `tsup` leaves `next` and `next/*` external.

A divergence from the plan's wording, and the finding of the spike: a route
handler and a server component do not share module instances in a production
build, so a store created when `lib/odudu.ts` loads is two stores. verified:
with the BFF's default in-memory store, `/api/auth/session` answered with the
claims while `/` and `/dashboard` rendered `Signed out.` and `No session.`;
with one store kept on `globalThis` in `lib/odudu.ts` the same run rendered
`Hello, <sub>`. The SDK therefore keeps its default store on `globalThis`
(one per issuer, client and cookie name, split so a flood of `login` requests
cannot evict a session), and says that a deployment with more than one
process needs a store of its own.

Linking. verified: the example resolved `@odudu-io/next` through a symlink to
`sdks/next`, whose `node_modules` holds a second copy of `next`; `cookies()`
still read the request, so Turbopack resolved `next/headers.js` to the app's
copy. A registry install has one copy.

Not run: `next dev`, a `basePath`, the Edge or a serverless target (a process
per request has no shared store at all), `output: 'standalone'`, the proxy
streaming a large body through a route handler, and the example in CI, which
needs a tarball install and `example-next` in `examples/_shared/provision.sh`.

### S7: the Python JWT library

Checked on 2026-11-20 for `odudu.verify`, which has to run on Python 3.10 to 3.13
(`requires-python = ">=3.10"`). Candidates: `PyJWT[crypto]` and `joserfc`.

verified: `curl -s https://pypi.org/pypi/<name>/json` for each. `pyjwt` 2.15.1
(uploaded 2026-09-28, `requires_python >=3.9`, `cryptography` only through the
`crypto` extra), `joserfc` 1.8.0 (uploaded 2026-11-03, `requires_python >=3.11`,
`cryptography>=45.0.1`), `cryptography` 50.0.2 (uploaded 2026-09-30). Every
version is more than a day older than the pin date `--exclude-newer
2026-11-19T00:00:00Z` that `requirements-dev.txt` already uses.

verified: `uv pip install --python <venv-3.10> joserfc==1.8.0 --dry-run` fails with
"joserfc==1.8.0 depends on Python>=3.11". The last `joserfc` line that installs
on 3.10 is 1.7.x (`requires_python >=3.10`, uploaded 2026-06-02), so choosing
it would pin the package to a line its maintainer has already moved on from.

verified: the same signature check over the signed tokens of
`sdks/node/test/fixtures/cases.json` (a script that imports each case's key from
`jwks.json` and verifies the compact JWS with `alg` fixed to the header's, on
Python 3.10 with `PyJWT 2.15.1` and with `joserfc 1.7.0`). Both accept the same
23 tokens whose signature is good and both refuse the two tampered ones
(`InvalidSignatureError` and `BadSignatureError`); neither reads `typ`.

verified: `inspect.getsource(jwt.api_jwt)` shows `datetime.now(tz=timezone.utc)`
in claim validation, so PyJWT takes no injectable clock. The verifier therefore
asks PyJWT only for the signature (`jwt.api_jws.decode_complete(token, key,
algorithms=[alg])`, one algorithm, the key's own) and checks `exp`, `nbf`, `iss`,
`aud` and the 5 s leeway itself, with the clock it was given. That is also what
keeps `typ` exact and gives the verdicts the shared fixtures ask for.

| Criterion                | `PyJWT[crypto]`                                       | `joserfc`                |
| ------------------------ | ----------------------------------------------------- | ------------------------ |
| Python 3.10              | latest line supports it (>=3.9)                       | latest line needs >=3.11 |
| Strict `alg` allowlist   | `algorithms=[alg]`, one algorithm per call            | `algorithms=[alg]`       |
| `typ` exact              | not checked by the library; done in the verifier      | same                     |
| RSA and EC JWK import    | `RSAAlgorithm.from_jwk`, `ECAlgorithm.from_jwk`       | `import_key`             |
| Injectable clock, leeway | none in either; leeway and clock done in the verifier | none                     |
| Size (pure Python)       | 136 KB                                                | 320 KB                   |

Chosen: `PyJWT[crypto]`, in an extra (`odudu[verify]`, and the FastAPI and Flask
extras include it) because the admin and me clients need neither it nor the
compiled `cryptography`, and `import odudu.admin` must not load them. Rejected:
`joserfc`, because its current release does not install on the interpreter the
package supports.

verified: the declared floor works. With `PyJWT==2.8.0`, `httpx==0.27.0`,
`fastapi==0.110.0` and `flask==2.3.3` in a Python 3.10 venv, the verifier's
test files (`tests/test_verify_*.py`) pass, so the extras declare `PyJWT>=2.8,<3`,
`fastapi>=0.110` and `flask>=2.3`.

## Documentation coverage baseline

`apps/docs/scripts/coverage-ratchet.test.ts` holds each area of the me API to
the table below, as it holds the admin API to the table in `docs/phases/p4g.md`.
A count may rise and never fall; an area new to the API must be added. The
fields counted are the path and query parameters, the request body and the body
of the success response of every operation. The admin table counts no path
parameters, so its numbers stand.

### Me API documentation coverage

| Area          | Described | Fields |
| ------------- | --------- | ------ |
| `consents`    | 10        | 10     |
| `credentials` | 22        | 22     |
| `profile`     | 77        | 77     |
| `sessions`    | 18        | 18     |
