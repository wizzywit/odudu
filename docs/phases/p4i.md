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
unclaimed.

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
