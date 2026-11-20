# Releasing Odudu

A release is a tag. Push `v0.1.0` and a workflow builds the image, signs it and
publishes a GitHub Release. This page is for the people who cut one.

The README, the quick start and the landing page download
`releases/latest/download/compose.yaml`. That address follows the newest stable
release and skips candidates, which are fetched by tag as in "Verify an image"
below.

## Versions

Odudu is before 1.0, so a minor version (`0.2.0`) may break something and a
patch version (`0.1.1`) only fixes. The changelog says which. Tags are
`vMAJOR.MINOR.PATCH`. A release candidate adds `-rc.N`, counting from 1, as in
`v0.1.0-rc.6`. No other suffix is accepted: the workflow refuses it.

A release candidate is never `latest`. It gets its own image tag and a GitHub
Release marked as a pre-release, and nothing that follows `latest` moves.

## Cut a release

1. Write the changelog first. In `CHANGELOG.md`, give the changes under
   `Unreleased` a heading `## [X.Y.Z] - YYYY-MM-DD` and update the links at the
   foot. The date is a real `YYYY-MM-DD` in UTC, the day GitHub shows for the
   release; a test checks the form. The workflow
   takes the release notes from that section and stops without it.
2. Merge to `main` and wait for the `gate` check to pass on that commit. The
   workflow refuses a commit it has not passed on. A stable tag must point at
   a commit on `main`, and the workflow refuses one that does not. A release
   candidate can be tagged on a pull request's head instead.
3. Tag the commit and push the tag:

   ```text
   git tag -s v0.1.0 -m "Odudu 0.1.0"
   git push origin v0.1.0
   ```

4. Watch the `release` workflow. It takes a while: the arm64 half is built
   under emulation.
5. Verify the image you published (below).

To run everything except the publishing, start the `release` workflow by hand
from the Actions tab and give it a version. It builds both architectures and
checks the notes and the compose file, and pushes nothing. The workflow file has to be
on `main` for the tab to offer it.

## What the workflow does

- **prepare** checks the tag has the right shape, that `CHANGELOG.md` has its
  section, that the compose file can be stamped, that a stable tag is on `main`
  and that `gate` passed.
- **image** builds `linux/amd64` and `linux/arm64`, pushes them with an SBOM and
  build provenance, checks both architectures are in the pushed image, signs
  it by digest without a key, and verifies the signature it just made.
- **release** attaches `compose.yaml` with this version's image in it, the SBOM
  and `SHA256SUMS` to a GitHub Release.
- **site** calls `pages.yml` after the release exists, for a stable tag only.
  A release candidate never replaces the live site, and a failed release leaves
  it as it was. `pages.yml` can also be run by hand, on its own.

A stable tag gets the tag `X.Y.Z`. It also moves `X.Y` when no newer patch of
that line exists, and `latest` when no newer stable release exists, so patching
an older line leaves `latest` where it is. A release candidate gets only
`X.Y.Z-rc.N`. Each job holds only the permissions it uses, and the one
credential is the workflow's own token.

If a run fails after the `image` job succeeded, run it again from the Actions
tab (re-run the failed jobs). The image keeps its digest. If `image` itself
failed, the rerun builds again, and the build record holds times, so the new
image has a new digest: the tags move to it and it is signed.

## Verify an image

The signature says this workflow built the image from this repository. You
need cosign 3.0 or newer: it is the line the workflow signs with, and an older
one is not known to read the signature.

```text
cosign verify ghcr.io/wizzywit/odudu:<version> --certificate-identity-regexp '^https://github.com/wizzywit/odudu/.github/workflows/release.yml@refs/tags/v' --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The contents list and the build record are in the image:

```text
docker buildx imagetools inspect ghcr.io/wizzywit/odudu:<version> --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/wizzywit/odudu:<version> --format '{{ json .Provenance }}'
```

Check the compose file against the list of checksums published with it:

```text
curl -fsSLO https://github.com/wizzywit/odudu/releases/download/<tag>/SHA256SUMS
grep ' compose.yaml$' SHA256SUMS | sha256sum -c -
```

On macOS use `shasum -a 256 -c -` in place of `sha256sum -c -`.

## Where the image and compose file come from

The quick start downloads
`https://github.com/wizzywit/odudu/releases/latest/download/compose.yaml`.
GitHub's `latest` skips pre-releases, so a release candidate never moves that
address. Take a
candidate's file from `https://github.com/wizzywit/odudu/releases/download/<tag>/compose.yaml`.
The file in the repository names version `0.0.0`. The workflow replaces it for
the release.

## Yank a release

Do not move a tag and do not reuse a version number.

1. Mark the GitHub Release as a pre-release (`gh release edit v0.1.1 --prerelease`)
   so `latest/download` goes back to the one before.
2. Point `latest` back at the good image:
   `docker buildx imagetools create -t ghcr.io/wizzywit/odudu:latest ghcr.io/wizzywit/odudu:<good-version>`
3. Mark its changelog heading `[YANKED]` and say why.
4. Publish the fix as the next patch version.

Deleting a package version cannot be undone, so only the owner does it, from
the package's page on GitHub.

## Releasing an SDK

The libraries under `sdks/` are released one at a time, each by its own tag,
and the image's `v*` tags do not start them. The tag is `<name>-vX.Y.Z`, or
`<name>-vX.Y.Z-rc.N` for a candidate, as in `oidc-v0.1.0` and
`python-v0.1.0-rc.1`. The name is the directory under `sdks/`: `oidc`, `react`,
`bff`, `next`, `node`, `admin-client`, `me-client`, `mcp-stdio` or `python`. The
first eight go to npm as `@odudu-io/<name>`, and `python` goes to PyPI as
`odudu`. The workflow refuses any other name, and a number with a leading zero.

1. Write the package's changelog first. In `sdks/<name>/CHANGELOG.md`, give the
   changes under `Unreleased` a heading `## [X.Y.Z] - YYYY-MM-DD`, as in "Cut a
   release". Set the version in `package.json`, or in `pyproject.toml`, to the
   same number. PyPI spells a candidate `0.1.0rc1` where the tag says
   `0.1.0-rc.1`, and the workflow expects that spelling. The `version` committed
   in `sdks/python/pyproject.toml` must equal the tag's, so every Python release,
   a candidate included, needs a commit that bumps it before the tag.
2. Take the package out of private: remove `"private": true`. The workflow
   refuses a private package.
3. Merge to `main` and wait for `gate`. A stable tag must point at a commit on
   `main`, and every tag at one `gate` passed on, as for the image.
4. Tag the commit and push the tag:

   ```text
   git tag -s oidc-v0.1.0 -m "@odudu-io/oidc 0.1.0"
   git push origin oidc-v0.1.0
   ```

5. Watch the `sdk-release` workflow, and approve the `sdk-release` environment
   when it asks.

A package that depends on another SDK is released after it: `pnpm pack` writes
the dependency's exact version into the tarball, so `mcp-stdio`'s `odudu-mcp`
command installs only once `@odudu-io/oidc` at that version is on npm. Tag `oidc`
first.

What the workflow does:

- **prepare** checks the tag has the right shape and names a package, that the
  package's name and version are what the tag says and that it is not private,
  that its `CHANGELOG.md` has the section, that a stable tag is on `main` and
  that `gate` passed.
- **build** runs the package's `build` and `test` scripts where it has them,
  packs it (`pnpm pack` for npm, `python -m build` and `twine check` for PyPI)
  and keeps the result for the publish job. It holds no registry credential. A
  package's example needs the quick start stack, so the release does not run it:
  the `examples` job of `verify` has run it on a commit `gate` passed on.
- **publish-npm** or **publish-pypi** publishes what `build` kept, behind the
  `sdk-release` environment. Neither registry is given a token: each trusts
  this workflow's own identity (trusted publishing). npm gets the dist-tag
  `latest`, or `rc` for a candidate, so a candidate never becomes what
  `npm install` gives. npm is expected to generate the provenance statement
  for a public package from a public repository, so the workflow passes no
  flag for it (unverified: not observed outside GitHub Actions).

To run everything except the publishing, start the `sdk-release` workflow by
hand from the Actions tab and give it a tag. It checks the tag, builds, tests
and packs, and sends nothing to a registry. The workflow file has to be on
`main` for the tab to offer it. The `sdks` job of `verify` runs the same
build, `npm pack --dry-run` and `npm publish --dry-run` on every pull request
that touches code, for each package that is not private.

### Owner setup, once

These settings are only the owner's to make, and the first release needs them.
Nothing here is done yet except the two accounts. The registries' pages were
read on 2026-11-20 and nothing was configured, so a setting below is unverified
until a release has used it, and the two that the pages leave open are marked.
`docs/phases/p4i.md` has what was read.

1. **npm.** The `@odudu-io` organization exists (done). Turn on two-factor
   authentication for the account that owns it.
2. **A trusted publisher for each of the eight npm packages**, on the package's
   settings page at npmjs.com: repository `wizzywit/odudu`, workflow
   `sdk-release.yml`, environment `sdk-release`. The workflow is the file name
   alone, and `repository.url` in the package's `package.json` must name that
   repository exactly. npm does not check the configuration when you save it,
   so a mistake shows only when the workflow publishes, and a new
   configuration expires after 2 days if no publish has used it. Configure it
   just before you push the tag.
3. **If npm will not let you configure a trusted publisher for a package that
   has never been published (unverified: the page read gives no steps for
   one),** publish `0.1.0` once from your machine with
   `npm publish --access public` and two-factor authentication, then configure
   trusted publishing for the later versions. That first version would have no
   provenance statement (inferred, not observed).
4. **PyPI.** The account exists (done). Add a pending publisher for the
   project `odudu`: owner `wizzywit`, repository `odudu`, workflow
   `sdk-release.yml`, environment `sdk-release`. The project does not exist
   yet, so the first publish creates it. Add the publisher just before the
   first tag, because the name `odudu` is not reserved until that publish: if
   someone registers it first, the pending publisher stops working. Whether
   the workflow's `id-token: write` permission and the PyPA publish action it
   calls are what PyPI expects is unverified, because the page read names
   neither.
5. **The `sdk-release` environment.** In the repository's Settings, Environments,
   create `sdk-release` and add yourself as a required reviewer, so a tag
   publishes only after you approve it. Without the environment, GitHub creates
   one with no reviewers when the workflow first names it, and nothing waits
   for you. The workflow file at the tagged commit is the one that runs, and a
   candidate tag may point at any commit, not only one on `main`. Limit the
   environment's deployment rule to the SDK tag pattern `*-v*`, optionally add a
   repository ruleset for `*-v*` tags as there is for `v*`, and as reviewer
   open the tagged commit and read its workflow before you approve.
6. **Two assumptions the workflow makes** (each marked unverified until a
   release has run them): unverified: `npm publish <tarball>`, run after
   `pnpm pack`, is accepted by trusted publishing and gets provenance; and
   unverified: the npm in the workflow, `11.21.1`, is the version that ships
   trusted publishing (the job fails if `npm --version` is below `11.5.1`).
   `npm view npm time --json` showed 11.21.1 as published on 2026-10-15.
7. **After the first publish of all SDKs: the examples' lockfiles.** Each
   example's `package-lock.json` holds third-party packages only, because no
   registry had the SDKs when it was written, so `npm ci` fails in a copy of an
   example until then. Run `npm install` in each `examples/<name>` that names an
   SDK, with the published `^0.1.0` ranges, commit the lockfiles, and re-check
   Dependabot: its pull requests for those folders fail to resolve `@odudu-io/*`
   until the packages exist.

## Owner settings

These are settings only the owner can change. They are done:

- **The package is public.** `docker pull ghcr.io/wizzywit/odudu:<version>` works
  with no login.
- **`main` requires `verify`, `container`, `commit-messages`, `query-plans` and
  `gate`.** `gate` waits for the Lighthouse, end-to-end, quick start,
  conformance, examples, console screenshots and docs jobs, and passes one that
  was skipped, so one check stands for all of them.
- **A `release tags` ruleset covers `v*`.** Only a repository administrator can
  create such a tag, and nobody can move or delete one.
- **The `github-pages` environment allows `main` and `v*` tags.** The `site`
  job runs from a stable tag and is refused without the tag rule.
- **Private vulnerability reporting is on**, and `SECURITY.md` links to it.
- **GitHub Pages uses GitHub Actions as its source.** The site is at
  `https://wizzywit.github.io/odudu/`. To republish it, open Actions, pages,
  Run workflow, from `main`. Each newest stable release redeploys it.

## The unique address index builds itself once its blockers are gone

Accounts that held one address apart from its case are folded by `odudu reconcile-accounts`.
The partial unique index on `(tenant_id, email_search)` is migration `0139`, which skips the
build with a warning where a pair remains, so the migration cannot stop the server booting, and
the start-up step builds it on the first start after the command has folded the pairs, saying at
every earlier start that it has not. The statement, which the test `reconcile-accounts.int.test.ts`
runs against the real schema, is:

```sql
CREATE UNIQUE INDEX users_email_search_unique ON users (tenant_id, email_search) WHERE email_search IS NOT NULL
```

Release notes for the release with the index tell operators to run `odudu reconcile-accounts
--dry-run`, then `odudu reconcile-accounts`, and to settle every group it refuses, before
upgrading, and say the migration's build blocks writes to `users` while it reads the table (Drizzle runs
every pending migration in one transaction, so it is not `CONCURRENTLY`; the server is stopped for
the upgrade), whereas the start-up step builds it `CONCURRENTLY`, under an advisory lock so two
instances starting together build it once, and again at the next start if it was dropped. A check fails if the index
is not there after the migrations (`packages/db/tests/email-unique-index.int.test.ts`).
`docs/phases/p4f.md`, "Increment 11", has the argument.

## Before the stable release

`0.1.0` was released without these three checks, at the owner's decision. They
stay outstanding: do them next, and record the result.

1. **Run the quick start by hand** once on a Mac and once on Windows, with
   Docker Desktop, and once on an arm64 machine. CI proves the full run on
   linux/amd64 only: its macOS and Windows runners cannot run Linux containers.
2. **Test the CLA once.** Open a throwaway pull request from a second GitHub
   account (a fork works) and check that the `cla` job comments, that signing
   by comment turns it green, that the signature lands on the `cla-signatures`
   branch, and that your own pull request and Dependabot's pass without
   signing. Write down the status name the pull request shows. Only then add
   `cla` to the required checks.
3. **Have a reader of Arabic review the catalogue.** Arabic is shipped and its
   text was drafted without one. Every `messages.ar.ts` (account, authn-flows,
   console-gateway, protocol-oidc and the email one) is read in a rendered
   page and mail of each kind, and the owner records who read it and when in
   `docs/phases/p4b.md`. It gates a stable release; `0.1.0` went ahead
   without it, so do it before `0.1.1` or `0.2.0`.

## Moving the site to a domain

Until there is a domain the site is at `https://wizzywit.github.io/odudu/`.
The address is written in one file, `apps/docs/site.config.ts`, and the
workflow never names it. These steps follow GitHub's documentation
on custom domains for Pages, read on 2026-10-16.

1. Verify the domain in your account's Pages settings. GitHub recommends doing
   this first.
2. In Settings, Pages, Custom domain, enter it, and tick Enforce HTTPS when
   GitHub offers it, which can take up to 24 hours. No `CNAME` file is needed
   or read, because a workflow publishes the site.
3. At your registrar, for an apex domain, add four `A` records,
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153` and
   `185.199.111.153`, and four `AAAA` records, `2606:50c0:8000::153` to
   `2606:50c0:8003::153`. For `www`, add a `CNAME` to `wizzywit.github.io`.
4. Commit one change to `apps/docs/site.config.ts`: `SITE_ORIGIN` to
   `https://<domain>` and `PAGES_BASE` to `/`.
5. The next stable release redeploys the site. It is published only for the
   newest stable release, so the site matches the latest release.
6. In Google Search Console add the domain as a property with a DNS `TXT`
   record, and submit `https://<domain>/sitemap.xml`. Leave the old property's
   sitemap in place until the old addresses stop being served.
7. GitHub should redirect the old `github.io` address. That is our reading, not
   GitHub's statement, so check it with `curl -sI` on the old address.

Cloudflare Pages or Vercel could serve the same built site. Neither is set up,
and only `pages.yml` would change. Vercel's free tier limits commercial
use, so read its current terms first if Odudu may be offered commercially.

## Link check

`links.yml` checks the external links in the Markdown sources every Monday and
when run by hand. It is not a pull request check. A failed run means a page
moved or went away: fix the link. `.lycheeignore` lists addresses to skip.
