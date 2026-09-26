# P4d — the admin console and the admin API it needs

## CI caching

`pnpm test` was one root-level `vitest run` writing one `trace-report.json`.
It is now `turbo run test --concurrency=4`: every workspace package that has
tests runs the root `vitest.config.ts` over itself alone and writes its own
`trace-report.json`, which Turborepo caches as the task's output, and
`pnpm trace` reads every one of them.

**Baseline, before the change.** The last three `verify` jobs on GitHub took
13m07s (`36263710579`, `main`), 11m24s (`36262833100`) and 13m53s
(`36262620798`, `main`). Locally, `pnpm verify` on this branch's first
commit — which differs from `main` only in documents — took 17m26s, 3,960
tests in 332 files, ending
`trace: 451 covered, 102 gap, 10 deferred, 212 n/a, 4 documented, 59 accepted (strict)`.
Roughly two minutes of that run overlapped a stray second suite, so it
overstates the true figure a little.

**After.** A cold `pnpm test` takes 8m52s locally, against the old suite's
16m44s, because packages now run their integration files side by side
rather than one file at a time across the whole repository. A warm one,
with nothing changed, takes 4.7s: 29 of 30 tasks replay from cache and
the one that does not is the repository checks (below). `pnpm trace` reads
the sixteen reports and prints the same line as before.

### What the verification showed

- **`vitest --dir .` does not narrow the root config's projects.** Run from
  `packages/kernel` it found no test files at all: each inline project's
  globs resolve against the working directory, not against `--dir`, and
  pointing `--root` at the repository instead left all 332 files in scope.
  The fallback taken is not a per-package config file, though. The root
  config already is the shared factory: it computes the package it was run
  from (`process.cwd()` relative to the repository) and narrows its globs to
  that package, keeping the full globs when run from the root. A per-package
  `vitest.config.ts` would have collided with the Stryker-only config
  `packages/crypto/vitest.config.ts` already holds, and seventeen more
  `*.config.ts` files would have passed the eight-file cap on
  typescript-eslint's `allowDefaultProject`. With the narrowed config,
  `packages/kernel` runs eight files, which is the count of its `*.test.ts`
  files; it has no integration files.
- **A `^typecheck` dependency does carry an upstream package's source into
  the downstream hash**, so `^test` was not needed. With a comment added to
  `packages/kernel/src/clock.ts`, `turbo run test --dry=json` showed every
  package that depends on `@odudu/kernel` as `MISS`, and `@odudu/contracts`
  and `@odudu/trace`, which do not, as `HIT`. With one added to
  `packages/db/drizzle/0071_session_secret.sql`, `@odudu/db` and all its
  dependents were `MISS` and `@odudu/kernel` `HIT`. `tools/commit-message`
  has no tests of its own — they live in `tests/lint/` — so it has no `test`
  task to hit.
- **Tests that read outside their own package** need those files named as
  inputs, or a change to them replays a stale pass. There are two, and
  `turbo.json` gives each an override through `$TURBO_ROOT$`:
  `packages/db/tests/schema-drift.int.test.ts` reads every package's
  `src/schema/`, and `packages/protocol-oidc/src/view/html-response.test.ts`
  reads every package's `src/view/` and every app's `src/`. A comment in
  `packages/account/src/view/` turned `@odudu/protocol-oidc#test` into a
  `MISS`, though it does not depend on `@odudu/account`. `drizzle/**` is in
  every package's inputs, since `@odudu/db`'s own tests run its migrations.
  A third such file is caught rather than remembered:
  `tests/lint/cross-package-reads.test.ts` scans every package's and app's
  `src/` and `tests/` for a `join`, `resolve` or `new URL` whose `..`
  segments climb above the package root, and fails, naming the file, unless
  turbo.json has a `<package>#test` override with a `$TURBO_ROOT$` input.
  With both overrides removed it named exactly the two files above. An
  override **replaces** the generic `test` task rather than merging with
  it, so an edit to the generic task has to be copied into each override.
- **The repository checks are never cached.** `tests/` became the
  workspace package `@odudu/repo-checks`, but its checks read documents,
  every package's source and the built server bundle, so their inputs are
  the whole repository. A `$TURBO_ROOT$/**` glob does not respect
  `.gitignore` — it hashed 40,075 files, `.git` and `node_modules`
  included — so `@odudu/repo-checks#test` sets `cache: false` instead. It
  takes about five seconds. Five of its checks had assumed the working
  directory was the repository root and now resolve paths from their own
  file instead.
- **Concurrency is bounded at four.** At Turborepo's default of ten, a cold
  `pnpm test` peaked at ten containers above the idle count, one
  Testcontainers PostgreSQL per package process plus its reaper. At
  `--concurrency=4` the peak was five, with no timeouts and the same wall
  time (8m50s at ten, 8m52s at four), because the longest package's
  integration suite, which runs one file at a time, sets the time either
  way.

`verify.yml` restores `.turbo/cache` with `actions/cache@v6`, keyed per
commit with a prefix fallback to the newest earlier entry, and points
`TURBO_CACHE_DIR` at it. The CI duration after the change is recorded here
once the pull request has run twice.

**The saved cache holds only what the run used.** Restoring the newest
cache and saving it back under a new key would make every archive a
superset of the last. So the job sets `TURBO_RUN_SUMMARY=true`, which has
each `turbo run` write `.turbo/runs/<id>.json` listing every task's hash,
and a step after `pnpm verify` runs `tools/turbo-cache`, which deletes every
cache entry no summary names before the post-job save. Access times were
the rejected alternative: a restored archive's atimes, and whether a
cache hit updates them under `relatime`, are not something to rely on.
Simulated locally over three runs against a copy of a 3,085-entry cache —
`typecheck`, `build` and `test`, pruning after each — the first run kept
35 entries and removed 3,085, and the next two, each changing one
package's source, found 37 and kept 35. The cost is that a hash last used
two runs ago is gone: reverting that change missed on the third run.
