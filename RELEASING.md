# Releasing Odudu

A release is a tag. Push `v0.1.0` and a workflow builds the image, signs it and
publishes a GitHub Release. This page is for the people who cut one.

Until the first stable release, the README and the quick start use the
newest candidate tag, now `v0.1.0-rc.4`, in the download address. When `0.1.0` is out, switch
them to `releases/latest/download`: edit `README.md`,
`apps/docs/content/en/quick-start/index.mdx`,
`apps/docs/src/features/landing/service/content.ts` and the caveats beside them.

## Versions

Odudu is before 1.0, so a minor version (`0.2.0`) may break something and a
patch version (`0.1.1`) only fixes. The changelog says which. Tags are
`vMAJOR.MINOR.PATCH`. A release candidate adds `-rc.N`, counting from 1, as in
`v0.1.0-rc.4`. No other suffix is accepted: the workflow refuses it.

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
address. Until the first stable release the address answers 404. Take a
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

## Before the stable release

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
   `docs/phases/p4b.md`. This gates a stable release only; a release
   candidate may go ahead without it.

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
