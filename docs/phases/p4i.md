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
collision names (`Item1`...) come from inline schemas, which stay inline
until shared components exist.

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
