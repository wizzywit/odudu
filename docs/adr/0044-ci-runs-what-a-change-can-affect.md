# 0044 — CI runs what a change can affect, in parallel, and one check says whether it passed

**Status:** Accepted · 2026-10-19

## Context

One job, `verify`, ran every static check and every package's tests in series,
and the heavy jobs (`e2e`, `conformance`, `query-plans`, `container`) ran on
every pull request, a one-word change to a document included.

Run 39244251543 showed what that costs. `verify` was cancelled at its 45-minute
limit and `docs` at ten minutes. The log of the cold `verify` shows where the
time went: `protocol-admin` 21 minutes, `admin-console` 18, `protocol-oidc` 16,
`server` 8, in one job. A cancelled or failed run saves no Turborepo cache
(`actions/cache` saves only on success), so every red run was followed by a
cold one.

The `docs` job's cause was not slowness. `pnpm test` in `apps/docs` ran vitest
without `--project`, so the `browser` project ran before Chromium was
installed. `chromium.launch()` threw in `beforeAll`; `afterAll` then called
`browser.close()` on `undefined` before it reached `server.kill()`, and the
orphaned `serve.mjs` held the worker's stdio open. Vitest never exited. The
same hang sat at the end of `verify`, which also runs the docs tests through
Turborepo.

## Decision

- **Cut the work by what changed.** A `changes` job classifies the files a pull
  request touches (`tools/ci/src/changes.ts`, unit-tested). The diff lists both
  sides of a rename and is NUL-separated, so a source file moved into `docs/`
  still counts, and only Markdown under `docs/` is prose. A change confined
  to prose and the docs app skips `e2e`, `conformance`, `query-plans` and the
  heavy test slices. Anything not recognised as prose, including every
  workflow, tool, lockfile and root config, runs everything, as does a push to
  main and any diff the script cannot compute. `docs/protocols/` counts as
  code: the trace check reads it against every package's report.
- **Split `verify`.** `static` runs the checks that need no database; the tests
  are a matrix. The four packages that dominate are sliced with vitest's
  `--shard`, set through `ODUDU_TEST_SHARD` and listed in the `env` of every
  test task in `turbo.json`, so a slice's cache entry is its own and typecheck
  entries stay shared. `tests/lint/ci-workflow.test.ts` fails if a test task
  omits it. A command-line `--` argument would have hashed into the typecheck
  tasks too. The other packages share one job. `docs` is its own job.
- **The trace check runs after the slices.** Each leg uploads its
  `trace-report.json`; `trace` joins the slices of a package
  (`tools/ci merge-reports`) and runs `pnpm trace` unchanged. Each report is
  uploaded beside a `trace-shard` file holding the `i/n` its leg ran; the merge
  fails on a missing, repeated or differently counted slice, and the uploads
  fail on a missing file, so a lost slice cannot pass as a smaller package.
- **Save the Turborepo cache on a red run.** `actions/cache/restore`, then
  `actions/cache/save` with `always() && !cancelled()`. The prune step runs
  only on success: a failed run's summary omits the tasks it never reached, and
  pruning to it would discard exactly the entries the next run needs. Each leg
  has its own key prefix.
- **One check to require: `gate`.** It needs every other job and fails on a
  failed or cancelled one, or if `changes` wrote no outputs (every skip would
  then be nobody's decision); a skipped job passes. GitHub's documentation
  says a job skipped by a job-level `if` reports success, so a required check
  that is skipped does not block a merge; only a workflow-level `paths` filter
  leaves a required check pending forever, and this workflow has none. That is
  documentation read, not behaviour observed here: the first validation run
  (a prose-only pull request, docs/phases/p4g.md) confirms it before any
  required check is removed. `gate` makes the rule independent of the answer:
  one check that is always reported. `verify` stays as the aggregate of
  `static`, `test`, `test-rest` and `trace`, so a branch protection rule that
  names it keeps working.
- **Slow steps carry their own limit** (the docs tests 8 minutes, the browser
  test 4), so a hang fails in the step that hung, and the cache-saving step
  after it still runs. Chromium is cached by Playwright version.

`turbo --affected` is not used. It selects by changed package files; measured
here, a commit touching only `docs/phases/p4g.md` selected no test task at all,
although `tests/docs` reads that directory. The Turborepo cache already skips
an unchanged package by content hash, including inputs outside it, and
replays its report, which the trace check needs. A task skipped by
`--affected` writes none.

## Consequences

- Slice counts (`protocol-oidc` 3, `protocol-admin` 4, `admin-console` 2,
  `server` 2, plus a rest job) follow the cold run's per-package times
  (1273, 1054, 960 and 505 s, four packages sharing one runner), aiming at
  about five minutes a leg. vitest cuts slices by file hash, not duration, and
  integration files are the slow ones, so legs will not be equal; adjust from
  the per-job times of the first runs.
- Cache volume: a run writes about 14 caches (`static`, 11 test legs,
  `test-rest`, `docs`), most of them kilobytes (test tasks output one report;
  the builds and the docs site are the large ones), expected under 250 MB a
  run. GitHub's limit is 10 GB per repository with least-recently-used
  eviction, so a busy week could evict main's entries, which are the ones a new
  branch restores. The prune step stays: it holds a cache to what its run
  names. Check the cache list after about five runs. A red run saves unpruned,
  bounded by one run's growth.
- A new job must be added to `gate`'s `needs`; the lint test enforces it, with
  the other structural rules of the workflow.
- A prose-only pull request still runs `static`, `docs`, the repository checks
  and `commit-messages`.
- `concurrency` cancels an earlier run of `main` when two merges land close
  together, so that commit's `gate` reads cancelled. It was so before; read
  main's state from the newest run.

## The console e2e job

Measured on run 39254678576: `e2e` took 19 minutes. The image built in 1 minute
cold; the stack was healthy 10 seconds later; `global-setup.ts` then seeded
for 2 minutes 20 seconds (several hundred `docker compose exec` calls); the 231
tests took the remaining 15 minutes on two workers (1832 s of test time, so
nothing but the tests themselves was large: `clients` 338 s, `audit` 176 s,
`groups-roles` 120 s, `subjects` 117 s).

- **Three slices, `e2e-shards`.** Playwright's `--shard` with `fullyParallel`
  cuts by test, not by file, so a slice is balanced without reading durations.
  Each slice is a runner with its own stack, so nothing shares a port or a
  database. The matrix in `verify.yml` is the one place the count is written;
  `run.sh` takes `E2E_SHARD` and passes it on. Expected per slice: about 20 s
  checkout and install, 25 s Chromium, 1 minute image, 2.3 minutes seeding
  (paid by every slice, as each needs the whole fixture) and 5 minutes of tests:
  9 to 10 minutes against 19. A fourth slice would save about 1.3 minutes more
  and cost another runner's setup; raise it if the first runs sit above 10.
- **`e2e` stays one job**, waiting for the slices and skipped as they are, so a
  reference to it, and `gate`, read as before.
- **The image is built in each job that runs it, against a shared layer
  cache, not once and passed on.** A built image is 1.2 GB on disk; saving, uploading,
  downloading and loading it costs about as much as the minute a build takes,
  and a warm build is faster than either. `.github/actions/image` builds with
  `docker/build-push-action` (`type=gha`, one scope), and tags the result with the
  name compose gives it (`odudu-e2e-odudu`, `odudu-smoke-odudu`), so
  `E2E_PREBUILT=1` and `ODUDU_PREBUILT=1` skip `--build` and compose starts what is
  there, or builds if it is not. `container` reads the same cache. Only the first slice of
  a push to main writes it, so no pull request's leg waits on a 1.5 GB export and a
  pull request reads main's cache; the first pull request after a lockfile change builds cold.
- **The Dockerfile fetches before it copies.** `pnpm fetch` needs the lockfile
  and the workspace settings, so the download is a layer that a source edit does not invalidate, and
  `pnpm install --offline` links from it. The `COPY packages apps` that
  preceded the install made every edit re-download everything, so a cache would
  have kept only the base images.
- **Cost.** Runner minutes for an `e2e` run go from about 19 to about 31 (three
  legs of about 10, which each repeat the seeding and setup), so +60%, spent for
  the wall-clock win. Legs are not equal: summed test time in run 39254678576 is
  708, 527 and 594 s for slices 1/3, 2/3 and 3/3. Playwright cuts contiguous
  slices by test count, not duration, and has no setting that balances by
  time, so the heavy `clients` and `audit` files land together in slice 1. Left as
  it is; a fourth slice would save 1.5 to 2 minutes of wall time for another runner.
- Not done: seeding the fixture once and sharing a database dump, or in parallel;
  it is the largest remaining fixed cost and a change to every spec's setup.

## Alternatives rejected

**Nx.** Considered for its affected graph, Nx Cloud's distributed task
execution and its test atomizer, which splits a test task per file. Rejected for
now. Migrating a working Turborepo setup (task definitions, cache inputs,
per-package scripts) costs more than the saving, and Turborepo already has
content-hash caching and `--affected`. The distributed execution and the
atomizer are the paid part. A required-check problem (a conditional job that
is skipped) exists under Nx as under anything else, and `gate` solves it
either way. **Revisit** when several apps have separate release cycles, so
that an affected graph picks which to release, or when CI minutes become a
real cost that matrix sharding on hosted runners no longer holds down.

**`dorny/paths-filter`.** A third-party action for what is forty lines of
tested script, and one more thing to pin and trust.

**One job per package.** Fine-grained, but the cold-install cost repeats
twenty-five times; slicing only the four large packages gets most of it.

## Amendment (2026-11-20): the `sdks` job

A change under `sdks/` is not prose, so `changes` already sets `server` for it
and no filter changed: the `sdks` job runs when `server` is true, and a change
confined to prose skips it as it skips the others. `gate` waits for it.
