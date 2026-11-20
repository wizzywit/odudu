# 0053 — SDKs live in `sdks/*`, are Apache-2.0, version by their own tag, and import no server package

**Status:** Accepted · 2026-11-20

## Context

Odudu published no library before the SDKs. The packages under `packages/*` are
the server and are AGPL-3.0-only; ADR 0042 puts the whole identity provider in
the open product and licenses the part an application links against, the SDKs,
under Apache-2.0, so a closed-source application may use them. That makes the
boundary between the two licences a boundary between two sets of source files.

Eight TypeScript packages and one Python package are published. They change at
different speeds (a React hook is not a token verifier), the generated clients
follow the server's OpenAPI documents, and a reader copies an example out of
the repository and depends on the published version.

The npm scope `@odudu` is already an organization on npm, owned by an account
the project owner has not confirmed they control, and it lists a package this
project did not publish. Publishing under it would depend on that account.

## Decision

- **Layout.** TypeScript SDKs are `sdks/<name>` workspace packages and the
  Python package is `sdks/python`. They live in this repository, so a generated
  client and the document it came from change in one commit, and an example
  runs against the stack of the same commit.
- **Licence.** Everything under `sdks/*` is Apache-2.0 (ADR 0042). Each package
  carries its own `LICENSE` and a `license` field, and `LICENSING.md` maps the
  directory to the licence.
- **No server imports.** Nothing under `sdks/` imports a package, app or tool of
  the server, by path or by an `@odudu/` name. The rule is `sdks-import-no-server`
  in `.dependency-cruiser.cjs`, run by `pnpm boundaries` in the `static` job and
  checked against fixtures in `tests/boundaries`. An SDK may import another SDK.
- **A version and a tag each.** A package is released by the tag
  `<name>-vX.Y.Z` (`oidc-v0.1.0`, `python-v0.1.0`), with `-rc.N` for a
  candidate, and keeps its own `CHANGELOG.md`. The server's `vX.Y.Z` tags are
  untouched, and its release workflow does not match an SDK tag.
- **Private until real.** A package keeps `"private": true` until it has the
  behaviour its page documents. The release workflow refuses a private package,
  and the `sdks` job skips one, so a package cannot be published by accident.
- **npm scope `@odudu-io`.** The packages are `@odudu-io/oidc`, `react`, `bff`,
  `next`, `node`, `admin-client`, `me-client` and `mcp-stdio`. The Python project
  is `odudu` on PyPI. `@odudu` was not used because of the account described
  above, and a scope can be chosen once without a move later.
- **Release by trusted publishing behind an approval.** `sdk-release.yml`
  publishes on a pushed tag with the workflow's own OIDC identity, holds no
  registry token, and runs its publish jobs in the `sdk-release` GitHub
  environment, where the owner can require a reviewer. A manual run builds,
  tests and packs but publishes nothing. The `sdks` job of `verify.yml` runs the
  build, the tests and the registry tools' dry runs on every change that can
  affect an SDK, and `gate` waits for it.

## Consequences

- A change to an SDK is a change to the repository's checks: it runs the heavy
  jobs as any change outside prose does (ADR 0044), and the `sdks` job adds the
  pack and publish dry runs.
- Releasing is per package, so a fix to one package does not move the others'
  versions, and a candidate goes to the `rc` dist-tag on npm.
- The registries' settings are the owner's and are written down in
  `RELEASING.md`. Two are unverified and may need a different route on the
  first publish: whether npm accepts a trusted publisher for a package never
  published, and the permission and action PyPI expects.
- Moving an SDK's code from `packages/*` is a relicensing and cannot happen
  silently: `sdks-import-no-server` fails the build on the import that would
  carry AGPL code across.

## Alternatives rejected

**A separate repository.** It gives the SDKs their own release history but lets a
generated client drift from the OpenAPI document it came from, and an example
in CI would have to boot a server from another repository. Rejected for the
drift, which a same-commit check catches and a second repository cannot.

**`packages/*`.** It would reuse the layout, but the directory decides the
licence (`LICENSING.md`), and the licence lint requires AGPL-3.0-only there.

**Generating the clients at publish time.** A reviewer would see nothing of what
a release contains, and a change to the server's error shape would reach users
unseen. The clients are committed, so a reviewer sees them change.
