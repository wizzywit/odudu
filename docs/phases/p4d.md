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
  `tests/lint/cross-package-reads.test.ts` scans every package's, app's and tool's
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

## Spikes

Throwaway code under `.superpowers/spikes/` (git-ignored), each installed
there with `npm install --before=2026-09-26T00:00:00Z`, so nothing resolved
is younger than the workspace's `minimumReleaseAge`. The workspace's own
`package.json` files and lockfile are untouched. `pnpm install
--ignore-workspace` is not a way to do that under pnpm 12.3.4: run inside
`.superpowers/spikes/fastify-inject` it rewrote the repository's
`pnpm-lock.yaml`, which was restored with `git checkout` and a frozen
install.

### `inject` and the client address

Fastify 5.12.3, a route answering `request.ip`, `request.ips` and
`request.socket.remoteAddress`, called with
`app.inject({ method: 'GET', url: '/ip', remoteAddress: '203.0.113.9' })`
and again with `headers: { 'x-forwarded-for': '198.51.100.7' }`.

verified: `cd .superpowers/spikes/fastify-inject && node inject.mjs`

```
trustProxy=false remoteAddress only: {"ip":"203.0.113.9","socket":"203.0.113.9"}
trustProxy=false remoteAddress + x-forwarded-for 198.51.100.7: {"ip":"203.0.113.9","socket":"203.0.113.9"}
trustProxy=true remoteAddress only: {"ip":"203.0.113.9","ips":["203.0.113.9"],"socket":"203.0.113.9"}
trustProxy=true remoteAddress + x-forwarded-for 198.51.100.7: {"ip":"198.51.100.7","ips":["203.0.113.9","198.51.100.7"],"socket":"203.0.113.9"}
```

`inject` presents whatever `remoteAddress` it is given as the socket
address, so `request.ip` is the browser's address under `trustProxy: false`
and an `x-forwarded-for` is ignored. Under `trustProxy: true` the header
wins, exactly as for a real socket. Without `remoteAddress`, `inject`
answers `127.0.0.1` (verified: the same app, `app.inject({ url: '/ip' })`,
answered `{"ip":"127.0.0.1"}`).

### Vite and inline script

`create-vite@9.2.1 --template react-ts`, then pinned to `vite@8.3.1`,
`@vitejs/plugin-react@6.1.1`, `react@19.3.0`, `react-dom@19.3.0` and
`typescript@6.0.3`. The inline-script count is the `<script>` tags in
`dist/index.html` without `src`.

verified: `cd .superpowers/spikes/vite-csp && npm run build && grep -o '<script[^>]*>' dist/index.html | grep -vc 'src='; grep -o 'style=' dist/index.html | wc -l`

```
0
0
```

The whole of the built `index.html` is one
`<script type="module" crossorigin src="/assets/index-….js">` and one
stylesheet `<link>`; there is no `<style>` element either. Vite 8 puts the
module-preload polyfill inside the entry chunk rather than inline.

verified: the same build with `build: { modulePreload: { polyfill: false } }`
(`npx vite build --config vite.config.nopolyfill.ts`) gives `0` and `0`
again, and a `diff` of the two `index.html` files differs only in the
entry chunk's hash; the entry chunk shrinks from 222,523 to 221,849 bytes.
With a lazily imported chunk added, the build adds only a
`<link rel="modulepreload" … href="/assets/rolldown-runtime-….js">`,
still no inline script. So `script-src 'self'` needs no nonce, and the
polyfill setting is irrelevant to it.

### React Aria under a strict CSP

`verified:` served by `node .superpowers/spikes/vite-csp/serve.mjs` with
`content-security-policy: default-src 'self'; style-src 'self'; script-src 'self'`,
opened in Chromium, the React Aria Components 1.21.1 `Dialog` opened and
closed with Escape, and the lazily loaded `ComboBox` typed into and its
options listed. Both behave correctly. The page and the console report
exactly one violation, on first render, before either is opened:

```
Applying inline style violates the following Content Security Policy directive 'style-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='), or a nonce ('nonce-...') is required to enable inline execution. The action has been blocked.
```

It is `usePress` prepending `<style id="react-aria-pressable-style">`
(`react-aria/dist/private/interactions/usePress.mjs:592`), whose whole text
is one rule, `touch-action: pan-x pan-y pinch-zoom` on
`[data-react-aria-pressable]`. Styles set through the CSSOM — React's
`style` prop and React Aria's positioning — raise nothing, as `style-src`
does not govern them. `usePreventScroll` injects a second element on iOS
WebKit only, which this check could not exercise.

So the SPA's shell stays static: the constant stylesheet is allowed by its
hash, `style-src 'self' 'sha256-38RhXrc7EdReTKsOm23ZPOCUgniTUUcjky8QOOrQx6o='`,
with a test that recomputes the hash from the pinned React Aria's source so
an upgrade that changes the text fails the build rather than the page. The
iOS element's hash is taken the same way from its source and added beside
it. A per-response nonce is not needed.

### Prefix search as one range scan

`postgres:17-alpine` through `startTestDatabase()` (server 17.11,
`datcollate` `en_US.utf8`), a `users`-shaped table (`subject_id`,
`tenant_id`, `username`), `ENABLE` and `FORCE ROW LEVEL SECURITY` with the
migrations' policy
`tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid`,
200,000 rows over 5 tenants (40,000 in the queried one, 5,758 of them
matching `ad%`, 213 after the cursor), the index
`(tenant_id, lower(username) text_pattern_ops, subject_id)`, `ANALYZE`d.
Each query runs in a transaction after `set_config('app.tenant_id', …, true)`
and `SET LOCAL ROLE spike_app` (`NOSUPERUSER NOBYPASSRLS`).

verified: `cd .superpowers/spikes/prefix-scan && node spike2.ts`, the
query the plan names and its expanded fallback:

```
SELECT subject_id, username FROM users
  WHERE lower(username) LIKE 'ad%' AND (lower(username), subject_id) > ('adz', '7f000000-…')
  ORDER BY lower(username), subject_id LIMIT 51

Limit  (actual time=17.578..17.588 rows=51 loops=1)
  ->  Sort  Sort Key: (lower(username)), subject_id
        ->  Bitmap Heap Scan on users
              Filter: ((lower(username) ~~ 'ad%'::text) AND (ROW(lower(username), subject_id) > ROW('adz'::text, '7f000000-…'::uuid)))
              Rows Removed by Filter: 39787
              ->  Bitmap Index Scan on users_tenant_username_prefix
                    Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
Execution Time: 17.648 ms

… AND (lower(username) > 'adz' OR (lower(username) = 'adz' AND subject_id > '7f000000-…')) …

Limit  (actual time=14.630..14.637 rows=51 loops=1)
  ->  Sort  Sort Key: (lower(username)), subject_id
        ->  Bitmap Heap Scan on users
              Filter: ((lower(username) ~~ 'ad%'::text) AND ((lower(username) > 'adz'::text) OR …))
              Rows Removed by Filter: 39787
              ->  Bitmap Index Scan on users_tenant_username_prefix
                    Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
Execution Time: 14.719 ms
```

**Both forms fail the pass condition**: the index narrows to the tenant
only, every one of its 40,000 rows is filtered, and a Sort follows. The
row comparison is not the cause. Under RLS the planner uses a user
predicate as an index condition only if every function in it is
leakproof, and `lower(text)` is not. `text_pattern_ops` does not help
either, since `ORDER BY lower(username)` sorts in the database collation,
not the pattern operators' byte order.

verified: in the same run,
`select proname, proleakproof from pg_proc …` answered
`text_gt=true text_pattern_ge=true text_pattern_gt=true texteq=true textlike=false uuid_eq=true uuid_gt=true`
and `lower(text)` `false`. Rewriting with `~>=~`/`~<~` and
`ORDER BY lower(username) USING ~<~` removed the Sort, but under RLS the
bounds stayed a `Filter` (`Rows Removed by Filter: 5709`), while the same
query run as the superuser, which bypasses RLS, put them in the
`Index Cond`.

**What passes**: a stored generated column in the `C` collation, with a
plain index on it, queried with an explicit upper bound instead of `LIKE`.

verified: `cd .superpowers/spikes/prefix-scan && node spike3.ts`, with
`username_lower_c text COLLATE "C" GENERATED ALWAYS AS (lower(username)) STORED`
and `CREATE INDEX … ON users (tenant_id, username_lower_c, subject_id)`:

```
SELECT subject_id, username FROM users
  WHERE username_lower_c >= 'ad' AND username_lower_c < 'ae'
    AND (username_lower_c, subject_id) > ('adz', '7f000000-…')
  ORDER BY username_lower_c, subject_id LIMIT 51

Limit  (cost=0.43..121.89 rows=51 width=48) (actual time=0.026..0.074 rows=51 loops=1)
  Buffers: shared hit=51 read=4
  ->  Index Scan using users_prefix_collate_c on users  (actual time=0.025..0.070 rows=51 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_lower_c >= 'ad'::text) AND (username_lower_c < 'ae'::text) AND (ROW(username_lower_c, subject_id) > ROW('adz'::text, '7f000000-…'::uuid)))
Execution Time: 0.104 ms
```

One Index Scan, no Sort, no Filter, 55 buffers against 2,826, and the row
comparison is itself an index condition, so the expanded form is not
needed. The same run shows two near misses. `LIKE 'ad%'` on that column
stays a `Filter`, since `textlike` is not leakproof, so a short last page
would scan to the end of the tenant: the upper bound has to be computed
by the caller. And a generated column in the default collation with a
`text_pattern_ops` index gets its bounds into the `Index Cond` but leaves
the cursor comparison a `Filter` (`Rows Removed by Filter: 5545`). The
planned index shape, on an expression, cannot serve this under RLS at
all: Part 2 needs the generated column.

### The admin audience on refresh

Against `startAdminFixture()`: a user in a fresh tenant signs in through
`/authorize` and `/login-actions/authenticate` as `odudu-admin` (public,
PKCE, `redirect_uri` `ADMIN_CLIENT_REDIRECT_URI`, `scope=openid`); the code
is exchanged with `resource=urn:odudu:params:admin-api`; the resulting
refresh token is refreshed without `resource`, and that one's with it.
Run once with no `resource` at `/authorize` and once with it.

verified: `cd packages/protocol-admin && pnpm vitest run --config ../../vitest.config.ts --project integration --silent=false --reporter=verbose tests/spike-admin-audience.int.test.ts`
(the file was deleted afterwards; a copy is in
`.superpowers/spikes/admin-audience/`)

```
SPIKE /authorize resource=false; code exchange with resource: 200  [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ] refresh_token issued: true
SPIKE   refresh without resource: 200  [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ]
SPIKE   refresh with resource: 200  [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ]
SPIKE /authorize resource=true; code exchange with resource: 200  [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ] refresh_token issued: true
SPIKE   refresh without resource: 200  [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ]
SPIKE   refresh with resource: 200  [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ]
SPIKE issuer: [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/spike' ] (code exchange with no resource at all)
```

Every access token's `aud` is the admin API and the tenant's issuer. A
refresh keeps the grant's audience with or without `resource`
(`resolveAudience(grant.audience, request.resource)`,
`packages/protocol-oidc/src/usecase/token-issuance.ts:786`), and since
`odudu-admin` registers only the admin API as its audience, even a code
exchange naming no `resource` gets it. A refresh token is issued on
`scope=openid` alone.
