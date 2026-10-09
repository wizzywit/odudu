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

**On CI.** The `verify` job ran 11m57s, 11m50s and 10m30s on the branch's
first three pushes, each of which changed a migration or `@odudu/db`, so
nearly every package missed the cache; that is what caching cannot help.
Against the pre-branch 15 minutes, the gain there comes from running
packages side by side. A push touching one leaf package replays the rest.

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
  `tests/lint/cross-package-reads.test.ts` follows every path a file in a
  package's, app's or tool's `src/` or `tests/` builds from `import.meta` or
  `process.cwd()`, and fails, naming the file, when one climbs above the
  package root or passes through anything it does not model — a
  concatenation, a template, an options object, any call but a path builder
  or a reader. A file it cannot bound is listed with what it reads, and each
  target must be one of that package's test inputs. It replaced a resolver
  that took any shape it did not model as safe, found by the final review
  of Part 1. An
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

## Field-scoped search on subjects

`GET /subjects?username=` and `?email=` are the shape the spike above
passed: stored generated columns `username_search` and `email_search`,
`text COLLATE "C"` over `lower(<column>)`, indexed
`(tenant_id, <column>_search, subject_id)`
(`packages/db/drizzle/0073_list_indexes_subjects.sql`). `listSubjects`
first asks the database for `lower($1)`, derives the exclusive upper bound
from that answer with `prefixUpperBound`, and binds the raw prefix as
`lower($1)` again for the lower bound, so no string is folded in
JavaScript.

`postgres:17-alpine` through `startTestDatabase()` (17.11, `datcollate`
`en_US.utf8`), every migration, 250,000 users over 5 tenants (50,000 in
the queried one; usernames half upper-case, a third with no email, one
subject in 97 disabled, one role held by one subject in 50 and one group
holding one in 40), `ANALYZE`d. The statement explained is the one
drizzle logged from `listSubjects` itself, run under
`set_config('app.tenant_id', …, true)` as `odudu_svc`
(`rolbypassrls false`, `rolsuper false`).

verified: `cd packages/protocol-admin && pnpm vitest run --config ../../vitest.config.ts tests/list-plans.int.test.ts`
(see "Field-scoped search on tenants and clients" below), which asserts
the plan shape on every run at 30,000 rows per tenant. The 250,000-row
figures in this section are not its output: they came from a scratch run
whose file is no longer in the repository, so they are a record of that
run rather than something the command above reproduces.

The statement, then its plan for the second page of `?username=A`
(excerpted from the saved output: the join to `subjects` and the planning
lines are left out):

```
select … from "subjects" left join "users" on "subjects"."id" = "users"."subject_id" where ("users"."username_search" >= lower($1) and "users"."username_search" < $2 and ("users"."username_search", "users"."subject_id") > ($3, $4)) order by "users"."username_search" asc, "users"."subject_id" asc limit $5
params: ["A","b","a03caec5-8671","a7b8c801-560c-4092-9bee-208309a722ae",51]

Limit  (cost=0.85..2394.37 rows=51 width=106) (actual time=0.019..0.172 rows=51 loops=1)
  Buffers: shared hit=259
  ->  Nested Loop  (cost=0.85..10325.85 rows=220 width=106) (actual time=0.018..0.168 rows=51 loops=1)
        Buffers: shared hit=259
        ->  Index Scan using users_username_search on users  (cost=0.43..3334.95 rows=1082 width=69) (actual time=0.011..0.044 rows=51 loops=1)
              Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_search >= 'a'::text) AND (username_search < 'b'::text) AND (ROW(username_search, subject_id) > ROW('a03caec5-8671'::text, 'a7b8c801-560c-4092-9bee-208309a722ae'::uuid)))
              Buffers: shared hit=55
Execution Time: 0.192 ms
```

The second page of `?email=a`, the same way:

```
->  Index Scan using users_email_search on users  (cost=0.43..1607.68 rows=487 width=80) (actual time=0.016..0.048 rows=51 loops=1)
      Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (email_search >= 'a'::text) AND (email_search < 'b'::text) AND (ROW(email_search, subject_id) > ROW('a05cdb8440637@example.com'::text, '5107a942-e28a-4aa5-b3f4-93a3837f0ace'::uuid)))
Execution Time: 0.214 ms
```

Both first pages, and a prefix matching nothing (`ab12`, 3 buffers), are
the same Index Scan with the bounds alone in the `Index Cond`; none of the
single-search plans has a Sort or a Filter on `users`. A prepared statement run under
`plan_cache_mode = force_generic_plan` keeps the same plan with
`username_search >= lower($1)`, `< $2` and `ROW($3, $4)` in the
`Index Cond`, so a driver that switches to a generic plan loses nothing.
`?enabled=false` with no search is `Index Scan using subjects_disabled`,
in `id` order; `?role=` and `?group=` are `Index Scan using
subject_roles_by_role` and `subject_groups_by_group` (`Index Cond:
role_id = …`), joined to `subjects_pkey` in `id` order, 51 rows read for a
page of 50. A search combined with a role is not one range scan: the
planner reads the role's 1,000 holders through `subject_roles_by_role`,
filters them by the bounds and sorts the 52 left (2 ms, 4,227 buffers).
It chose that plan because the role is small next to the prefix's 2,923
estimated matches; a combined filter is left to the planner rather than
given a composite index, and only a single search is held to one scan.

## Field-scoped search on tenants and clients

`GET /admin/tenants?name=`/`?display_name=` and
`GET /clients?client_id=`/`?name=` repeat the subjects shape exactly:
stored `text COLLATE "C"` columns over `lower(<column>)`, a bound derived
from PostgreSQL's own `lower($1)`, the keyset `(key, id) > (sort, after)`
(`packages/db/drizzle/0074_list_indexes_tenants_clients.sql`,
`packages/protocol-admin/src/usecase/prefix-search.ts`, which the subjects
listing now uses too). `tenants` has no `tenant_id` and is listed through
the owner connection, so its indexes are `(name_search, id)` and a partial
`(display_name_search, id) WHERE display_name_search IS NOT NULL`;
`clients` is under row-level security and indexed
`(tenant_id, <column>_search, id)`. The generated `clients` columns are
also refused by `PATCH /clients/{id}`'s allowlist, which is derived from
the table's columns and would otherwise have offered them as amendable.

The plans are asserted rather than recorded:
`packages/protocol-admin/tests/list-plans.int.test.ts` seeds 30,000 rows
per table in each of three tenants (plus 30,000 extra tenants), `ANALYZE`s,
runs each listing through its own usecase to capture the statement it
issues, and `EXPLAIN (FORMAT JSON)`s that statement — as `odudu_svc`
(`rolbypassrls` and `rolsuper` both false, asserted) under
`set_config('app.tenant_id', …, true)` for subjects and clients, through
the owner connection for tenants, since that is the one the listing uses.
For the first page and a later page of each search it requires an
`Index Scan` of the search index whose `Index Cond` holds both bounds (and
`ROW(<key>, id) > …` past the first page), no `Filter` on the key, and no
`Sort` or `Incremental Sort` anywhere in the plan. Swapping the range for
`lower(key) like lower($1) || '%'` fails all twelve.

verified: `cd packages/protocol-admin && pnpm vitest run --config ../../vitest.config.ts tests/list-plans.int.test.ts`
(13 passed in 15.6 s against `postgres:17-alpine`). With
`LIST_PLANS_OUT=<file>` the same run appends each statement and its
`EXPLAIN (ANALYZE, BUFFERS)`. Excerpted from that output, the later page
of `tenants ?name=T3` (through the owner connection) and of
`clients ?client_id=B` (as `odudu_svc`); the other two follow the same
shape on `tenants_display_name_search` and `clients_name_search`:

```
Limit  (cost=0.29..108.03 rows=51 width=72) (actual time=0.032..0.079 rows=51 loops=1)
  Buffers: shared hit=54
  ->  Index Scan using tenants_name_search on tenants  (cost=0.29..3048.75 rows=1443 width=72) (actual time=0.031..0.074 rows=51 loops=1)
        Index Cond: ((name_search >= 't3'::text) AND (name_search < 't4'::text) AND (ROW(name_search, id) > ROW('t305ec2f9-14865'::text, 'fe333f4d-c58d-4885-9f1f-566f357ddf7a'::uuid)))
Execution Time: 0.095 ms

Limit  (cost=0.84..417.89 rows=51 width=503) (actual time=0.029..0.279 rows=51 loops=1)
  ->  Nested Loop  (cost=0.84..4416.59 rows=540 width=503) (actual time=0.029..0.274 rows=51 loops=1)
        ->  Index Scan using clients_client_id_search on clients  (cost=0.43..861.18 rows=535 width=84) (actual time=0.017..0.077 rows=51 loops=1)
              Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (client_id_search >= 'b'::text) AND (client_id_search < 'c'::text) AND (ROW(client_id_search, id) > ROW('b060700f-8238'::text, 'ca9dfe92-445f-4d6f-b3e3-8b5207707c6d'::uuid)))
        ->  Index Scan using client_oidc_config_pkey on client_oidc_config  (cost=0.42..6.65 rows=1 width=435) (actual time=0.004..0.004 rows=1 loops=51)
              Index Cond: (client_id = clients.id)
Execution Time: 0.311 ms
```

Every one of the twelve, subjects included, ran in under 0.35 ms and read
51 rows of its search index for a page of 50.

## Search and filters on roles, groups, scopes and keys

`GET /roles?name=`, `GET /groups?name=` and `GET /scopes?name=` are the
same shape again: a stored `name_search` column, `text COLLATE "C"` over
`lower(name)`, indexed `(tenant_id, name_search, id)` on `roles`, `groups`
and `client_scopes`
(`packages/db/drizzle/0075_list_indexes_roles_groups_scopes.sql`), matched
through `prefixRangeConditions`. `GET /roles?client=` is an exact filter
beside it: `tenant` for the tenant roles (`client_id IS NULL`), or a
client's id for the roles scoped to that client, `AND`ed with a search.
Combined with a search it is not held to the one-range-scan shape; what
the planner does was measured, and is described below with the other
roles plans.

`GET /keys` takes `?status=` and `?alg=`, exact and `AND`ed, and gets **no
index**: a tenant holds a handful of signing keys (one active, a few
staged or retired), so a filter over them reads the table and is never
worth an index to maintain. The status values are the ones
`signing_keys_status_check` admits — `active`, `rotating`, `retired` —
since a staged key is `rotating`; there is no `pending`.

The three allowlists `PATCH` reads for these resources
(`role-patch.ts`, `group-patch.ts`, `scope-patch.ts`) derive from the
contract's wire shape rather than the table's columns, so, unlike
`clients`, the new column never became amendable; each resource's tests
hold that `PATCH` and `POST` refuse `name_search` with `400` naming it and
that no response carries it, and `openapi.int.test.ts` that the published
document names no `*_search` column.

`packages/protocol-admin/tests/list-plans.int.test.ts` now seeds 30,000
tenant roles, groups and scopes in each of its three tenants too, plus
30,000 client-scoped roles (300 on each of 100 clients), and holds the
three searches to the same plan as the other six, first page and later
page, as `odudu_svc` under row-level security. With the three `CREATE
INDEX` lines of `0075` commented out, those six cases fail and the other
thirteen still pass.

A search narrowed by `?client=` gets two different plans, and the test
holds each to what was measured rather than to the single-search shape.
Under **`client=tenant`** no index orders tenant roles by `name_search`
(`roles_tenant_name` is `(tenant_id, name) WHERE client_id IS NULL`), so the
planner walks `roles_name_search` in order and applies
`client_id IS NULL` as a `Filter`, discarding the client-scoped rows in
the range — 65 on the first page, 71 on a later one, for 51 kept. The test
asserts that shape (Index Scan, both bounds and the keyset in the `Index
Cond`, the owner test in the `Filter`, no Sort), and it fails with
`roles_name_search` dropped. Under **`client=<id>`** the planner prefers another plan: a `BitmapAnd` of `roles_client_name` (the
client's 300 roles) with the search range, then a **Sort** of the 29 rows
left. That is bounded by one client's role count rather than the tenant's,
so it is left to the planner; the test asserts only that the plan reads
through an index condition on `client_id` and has no `Seq Scan`.

verified: `cd packages/protocol-admin && LIST_PLANS_OUT=<file> pnpm vitest run --config ../../vitest.config.ts tests/list-plans.int.test.ts`
(22 passed in 23.5 s against `postgres:17-alpine`). Excerpted from that
run's `LIST_PLANS_OUT` output: the later page of `roles ?name=A` (and
`groups ?name=B` on `groups_name_search` and `scopes ?name=c` on
`client_scopes_name_search` are the same plan), then the later page of
`?name=A&client=tenant`, then the first and only page of
`?name=A&client=<id>`:

```
Limit  (cost=0.43..132.00 rows=51 width=115) (actual time=0.021..0.057 rows=51 loops=1)
  Buffers: shared hit=54
  ->  Index Scan using roles_name_search on roles  (cost=0.43..4058.43 rows=1573 width=115) (actual time=0.020..0.052 rows=51 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (name_search >= 'a'::text) AND (name_search < 'b'::text) AND (ROW(name_search, id) > ROW('a0346531-15494'::text, '8c3ed9f5-a8c1-436a-9246-35c29c641229'::uuid)))
Execution Time: 0.072 ms

Limit  (cost=0.43..263.18 rows=51 width=115) (actual time=0.031..0.160 rows=51 loops=1)
  Buffers: shared hit=126
  ->  Index Scan using roles_name_search on roles  (cost=0.43..4055.07 rows=787 width=115) (actual time=0.030..0.155 rows=51 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (name_search >= 'a'::text) AND (name_search < 'b'::text) AND (ROW(name_search, id) > ROW('a07c2f3b-450'::text, '5749f467-c908-40a3-8e60-e35937e0a453'::uuid)))
        Filter: (client_id IS NULL)
        Rows Removed by Filter: 71
Execution Time: 0.206 ms

Limit  (cost=274.26..274.28 rows=7 width=115) (actual time=0.512..0.517 rows=29 loops=1)
  Buffers: shared hit=75
  ->  Sort  (cost=274.26..274.28 rows=7 width=115) (actual time=0.512..0.514 rows=29 loops=1)
        Sort Key: name_search COLLATE "C", id
        ->  Bitmap Heap Scan on roles  (cost=247.09..274.16 rows=7 width=115) (actual time=0.419..0.497 rows=29 loops=1)
              Recheck Cond: ((client_id = '00030058-a47f-4f2a-aa43-e1a2b438ef8b'::uuid) AND (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (name_search >= 'a'::text) AND (name_search < 'b'::text))
              ->  BitmapAnd  (cost=247.09..247.09 rows=7 width=0) (actual time=0.410..0.410 rows=0 loops=1)
                    ->  Bitmap Index Scan on roles_client_name  (cost=0.00..14.65 rows=298 width=0) (actual time=0.061..0.061 rows=300 loops=1)
                          Index Cond: (client_id = '00030058-a47f-4f2a-aa43-e1a2b438ef8b'::uuid)
                    ->  Bitmap Index Scan on roles_name_search  (cost=0.00..232.18 rows=4140 width=0) (actual time=0.333..0.333 rows=3734 loops=1)
                          Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (name_search >= 'a'::text) AND (name_search < 'b'::text))
Execution Time: 0.564 ms
```

`createDatabase`'s statement hook, which that test uses to capture what a
listing issues, hands every statement's parameters to its caller —
password hashes, secret hashes, emails and TOTP seeds among them. It is
now `onQueryForTests`, and `tests/lint/query-hook-tests-only.test.ts`
fails the build if any non-test source file under `packages/*/src`,
`apps/*/src` or `tools/*/src` names it.

## The plan `GET /audit?resource_type=&resource_id=` is given

0067's `audit_events_resource` ordered on `(tenant_id, resource_type,
resource_id)` alone, not on `(occurred_at, id)` the listing itself orders
by, so a per-resource read the index bounded still took a `Sort` to put
what was left in order — measured cheap against a resource holding a
single row, but wrong to generalize from: `resource_type='grant'` rows
accumulate per grant id across refresh rotation
(`packages/protocol-oidc/src/usecase/refresh-rotation.ts`), token issuance
(`token-issuance.ts`) and revocation (`revocation.ts`), so a long-lived
grant's own trail is not the handful of rows a resource ordinarily has,
and a Sort over an unbounded working set is exactly the shape a keyset
listing exists to avoid.

`packages/db/drizzle/0076_audit_events_resource_keyset.sql` replaces the
index with one ordered `(tenant_id, resource_type, resource_id,
occurred_at DESC, id DESC)` — the listing's own order appended after the
equality columns — so the keyset condition on `(occurred_at, id)` is
itself an index condition, and the read stops at `LIMIT` without touching
a row outside the page. `list-plans.int.test.ts` seeds a busy resource
(5,000 rows against one grant id, alongside the 30,000-row-per-tenant
fixture the other cases share) and holds both its first and later page to
an `Index Scan` on `audit_events_resource` with no `Sort` or `Incremental
Sort` anywhere in the plan, the resource and keyset conditions both inside
the one `Index Cond` — the same shape the six search columns get, not the
weaker one 0067 gave a resource trail.

verified: `cd packages/protocol-admin && LIST_PLANS_OUT=<file> pnpm vitest run --config ../../vitest.config.ts tests/list-plans.int.test.ts -t "sort-free"`
(2 passed in 23.9 s against `postgres:17-alpine`). First and later page of
`?resource_type=grant&resource_id=<busy>`, 51 rows read (`limit 50` plus
one to learn whether another page follows) with nothing beyond the index
condition itself:

```
Limit  (cost=0.43..123.50 rows=51 width=236) (actual time=0.023..0.035 rows=51 loops=1)
  Buffers: shared hit=6
  ->  Index Scan using audit_events_resource on audit_events  (cost=0.43..241.74 rows=100 width=236) (actual time=0.023..0.031 rows=51 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (resource_type = 'grant'::text) AND (resource_id = '485c82f9-b813-4bfa-bb70-9d16af7db53b'::text))
        Buffers: shared hit=6
Planning Time: 0.059 ms
Execution Time: 0.053 ms

Limit  (cost=0.43..123.66 rows=51 width=236) (actual time=0.024..0.035 rows=51 loops=1)
  Buffers: shared hit=6
  ->  Index Scan using audit_events_resource on audit_events  (cost=0.43..239.64 rows=99 width=236) (actual time=0.024..0.030 rows=51 loops=1)
        Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (resource_type = 'grant'::text) AND (resource_id = '485c82f9-b813-4bfa-bb70-9d16af7db53b'::text) AND (ROW(occurred_at, id) < ROW('2026-09-27 05:43:39.644+00'::timestamp with time zone, 'f5bba009-ed68-4b1f-810c-93660b2ddc83'::uuid)))
        Buffers: shared hit=6
Planning Time: 0.039 ms
Execution Time: 0.054 ms
```

`0067_admin_audit.sql` is left as it first shipped — the migration history
is what it is — and `0076` is the correction, not an edit to `0067` in
place.

## The plan a bounded count is given

Each `/count` route runs its list's own statement — the WHERE and ORDER BY
builders the listing exports (`subjectListConditions`, `subjectListOrder`,
and the same pair for every other collection) and, for subjects, the same
FROM (`subjectListRows`) — with `limit COUNT_CAP + 1` in place of the page
size, wrapped in `count(*)`. The ORDER BY is not decoration: without it,
under a ceiling inside the range, the planner answered `tenants/count
?name=T3` with a `Seq Scan` and a Filter, hoping to reach the LIMIT early,
which is unbounded when the matches are sparse. With it, every searched
count under a binding ceiling is an `Index Only Scan` of its list's search
index under the `Limit`, with any join probing per row and no Sort.

`clients/count` reads `clients` alone. The listing joins
`client_oidc_config` for the columns it shows, but no filter reads it, and
it is a 1:1 extension every creation path writes (`createClient`,
dynamic registration, `provisionAdminClient`, `odudu seed`). With the join,
an uncapped count hash-joined it through a `Seq Scan` — under row-level
security, every tenant's rows.

A searched subjects count whose ceiling does not bind is the one plan that
reads more than its range: the planner may hash-join the tenant's
`subjects` rows, read through `subjects_tenant_id_unique`, rather than
probe `subjects_pkey` once per match. Accepted: the join itself is needed
the moment `?enabled=`, `?role=` or `?group=` applies, the read is an index
range of the one tenant and never another's, and it is the planner's
choice on its cost estimate against probing once per match, not a shape
the statement forces. A binding ceiling reverses it, as the second plan
below shows; how a much larger tenant plans it is not measured here.

verified: `cd packages/protocol-admin && LIST_PLANS_OUT=<file> pnpm vitest run --config ../../vitest.config.ts tests/list-plans.int.test.ts`
(47 passed against `postgres:17-alpine`). `subjects/count ?username=A`,
1,836 matches of 30,000 subjects, under `COUNT_CAP` and then under a
ceiling of 100:

```
Aggregate  (cost=4605.01..4605.02 rows=1 width=8) (actual time=7.020..7.022 rows=1 loops=1)
  Buffers: shared hit=1038
  ->  Limit  (cost=4596.18..4597.65 rows=589 width=34) (actual time=6.715..6.923 rows=1836 loops=1)
        Buffers: shared hit=1038
        ->  Sort  (cost=4596.18..4597.65 rows=589 width=34) (actual time=6.714..6.797 rows=1836 loops=1)
              Sort Key: users.username_search COLLATE "C", users.subject_id
              Sort Method: quicksort  Memory: 178kB
              Buffers: shared hit=1038
              ->  Hash Join  (cost=2971.44..4569.08 rows=589 width=34) (actual time=1.671..6.199 rows=1836 loops=1)
                    Hash Cond: (subjects.id = users.subject_id)
                    Buffers: shared hit=1038
                    ->  Bitmap Heap Scan on subjects  (cost=1225.51..2744.20 rows=30075 width=16) (actual time=0.887..3.087 rows=30000 loops=1)
                          Recheck Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
                          Heap Blocks: exact=281
                          Buffers: shared hit=526
                          ->  Bitmap Index Scan on subjects_tenant_id_unique  (cost=0.00..1217.99 rows=30075 width=0) (actual time=0.864..0.864 rows=30000 loops=1)
                                Index Cond: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
                                Buffers: shared hit=245
                    ->  Hash  (cost=1723.90..1723.90 rows=1763 width=30) (actual time=0.777..0.778 rows=1836 loops=1)
                          Buckets: 2048  Batches: 1  Memory Usage: 129kB
                          Buffers: shared hit=512
                          ->  Bitmap Heap Scan on users  (cost=98.91..1723.90 rows=1763 width=30) (actual time=0.153..0.597 rows=1836 loops=1)
                                Recheck Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_search >= 'a'::text) AND (username_search < 'b'::text))
                                Heap Blocks: exact=488
                                Buffers: shared hit=512
                                ->  Bitmap Index Scan on users_username_search  (cost=0.00..98.47 rows=1763 width=0) (actual time=0.119..0.119 rows=1836 loops=1)
                                      Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_search >= 'a'::text) AND (username_search < 'b'::text))
                                      Buffers: shared hit=24
Planning:
  Buffers: shared hit=17
Planning Time: 0.156 ms
Execution Time: 7.093 ms

Aggregate  (cost=1554.19..1554.20 rows=1 width=8) (actual time=0.214..0.215 rows=1 loops=1)
  Buffers: shared hit=509
  ->  Limit  (cost=0.84..1552.92 rows=101 width=34) (actual time=0.018..0.209 rows=101 loops=1)
        Buffers: shared hit=509
        ->  Nested Loop  (cost=0.84..9052.07 rows=589 width=34) (actual time=0.018..0.202 rows=101 loops=1)
              Buffers: shared hit=509
              ->  Index Only Scan using users_username_search on users  (cost=0.43..3059.13 rows=1763 width=30) (actual time=0.012..0.045 rows=101 loops=1)
                    Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_search >= 'a'::text) AND (username_search < 'b'::text))
                    Heap Fetches: 101
                    Buffers: shared hit=105
              ->  Index Scan using subjects_pkey on subjects  (cost=0.42..3.40 rows=1 width=16) (actual time=0.001..0.001 rows=1 loops=101)
                    Index Cond: (id = users.subject_id)
                    Filter: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
                    Buffers: shared hit=404
Planning:
  Buffers: shared hit=17
Planning Time: 0.143 ms
Execution Time: 0.229 ms
```

## A subject's consents

`revokeConsent` finds a subject's grants for one client with
`token_grants_by_subject` (`subject_id`, `id`), which migration `0095` adds;
the earlier text here accepted a scan of `token_grants` for this write as
too rare to index, and at a million subjects that scan reads every grant of
the tenant. The list is paged, so a subject with many consents answers a page
(`GET /subjects/:id/consents`, `docs/admin-paths.md`).

## What export and import found

Building the export turned up a registration gap: client metadata accepted a
`jwks` whose keys carried private members (`d`, `p`, `q`, `dp`, `dq`, `qi`,
`k`), so a pasted keypair was stored and then served back by `GET /clients`
and by the export. Registration and amendment now refuse them, on the admin
API and on dynamic registration alike, and the export strips any stored
before that and lists each under `omitted`.

Building the import turned up two ranges only the database enforced. A
client token lifetime outside CHECK 0013/0014 answered `500` from
`POST`/`PATCH /clients`, and a tenant setting outside its CHECK was found
only by writing it. Both are now refused before any write — by the import's
single `400`, by `PATCH /settings` and by the client routes — from one
predicate beside `SETTINGS`, held to the constraints by
`tenant-setting-checks.int.test.ts`, which probes every bound against the
real database and fails on any tenants CHECK shape it cannot read.

## Leftovers on the shared development stack

The `infra/docker` stack the admin-paths transcripts are captured on holds
a tenant `probe-rename-access`, created while checking a system admin's
reach before the rename capture; no transcript names it and no endpoint
deletes a tenant, so it stays until that stack is next rebuilt from an
empty volume. The export, import and settings-range transcripts left
`export-demo`, `import-source`, `import-demo` and `settings-range-demo`
beside it, for the same reason. The console foundation's Playwright spike
left `spike-console-0928` ("Part 3 spikes" below).

## Part 2 spikes

Four behaviours the console gateway builds on, each run against the real
composition (`buildApp` from `apps/server/src/app.ts`, `seedAdmin`, a real
PostgreSQL through `startTestDatabase()`). The administrator signs in as
`odudu-admin` through `/auth`, the forced password change and
`/login-actions/authenticate`, with `scope=openid` and
`resource=urn:odudu:params:admin-api` at both `/auth` and the code
exchange. Every request is a Fastify `inject`, so the default `Host` is
`localhost` and every issuer below reads `http://localhost/tenants/system`.

verified, all four: `cd apps/server && pnpm vitest run --config ../../vitest.config.ts --project integration --silent=false --reporter=verbose tests/console-spike.int.test.ts`
(the file was deleted afterwards; a copy is in
`.superpowers/spikes/console-gateway/`)

### `inject` from inside an encapsulated plugin

A plugin registered with `app.register` after `buildApp` returns defines
its own routes, and each calls `child.inject` on its own encapsulated
instance with `remoteAddress: request.ip` and the caller's
`authorization`. One forwards `GET /admin/tenants/system/whoami`, one
`POST /admin/tenants/system/scopes`; both are called with
`remoteAddress: '203.0.113.9'`. The admin routes are registered by a
sibling plugin, `adminRoutes`. The whoami route is
`/admin/tenants/:tenant/whoami`; there is no `/admin/whoami`. A read writes
no audit row, so the address is checked on the mutation's row.

```
SPIKE S1 whoami through child inject: 200 {"subjectId":"01a0e612-…","issuerTenantId":"0199aa00-0000-7000-8000-000000000001","capabilities":["manage-clients",…],"crossTenant":false}
SPIKE S1 POST scopes through child inject: 201
SPIKE S1 audit row: [{"action":"scope.create","ip":"203.0.113.9","request_id":"01a0e612-ef8e-79cc-aff3-662f1487893b"}]
```

**Confirmed.** A child instance's `inject` dispatches through the root
router and reaches routes a sibling registered. The forwarded
`remoteAddress` becomes `request.ip` downstream and lands in `audit_events.ip`.
The gateway does not need the root instance.

### Refresh for `odudu-admin` on `scope=openid`

The code exchange's refresh token is refreshed twice, each time with the
token the previous response returned. The first refresh token is then
replayed, and the newest refresh and access tokens are tried after it.

```
SPIKE S2 code exchange refresh_token issued: true
SPIKE S2 aud0 [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/system' ]
SPIKE S2 refresh 1: 200 [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/system' ] rotated: true id_token: false
SPIKE S2 refresh 2: 200 [ 'urn:odudu:params:admin-api', 'http://localhost/tenants/system' ] rotated: true
SPIKE S2 replay of the first refresh token: 400 {"error":"invalid_grant"}
SPIKE S2 newest refresh token after the replay: 400 {"error":"invalid_grant"}
SPIKE S2 newest access token after the replay, whoami: 401
SPIKE S2 grant audit rows: [{"action":"grant.revoked_on_reuse","outcome":"allowed","detail":{"reason":"replayed"}}]
```

**Confirmed.** A refresh token is issued without `offline_access`, every
refresh rotates it, and the admin audience is kept. A refresh response
carries no `id_token`, so the gateway keeps the one from the code exchange
for the logout hint. Replaying a rotated token has no grace window. The
replay answers `invalid_grant`, revokes the whole grant and records
`grant.revoked_on_reuse`. After that the newest refresh token is refused
too, and the newest access token is refused by the admin API. So two
requests that both refresh with the same token end the session. Refresh
has to be serialised per session.

### Discovery through `inject`

`buildApp` gets `publicBaseUrl: 'https://idp.example.test'`, once with
`trustProxy: false` and once with `true`. The discovery document is fetched
with no `Host`, a foreign `Host`, the base's `Host`, the base's `Host` with
`x-forwarded-proto: https`, and a foreign `Host` with
`x-forwarded-host`/`x-forwarded-proto` naming the base. Each is sent from
`remoteAddress` `203.0.113.9` and again from `10.0.0.1`, which give the same
issuer in every case below.

```
SPIKE S3 trustProxy=false remote=203.0.113.9 headers={}: 200 http://localhost/tenants/system
SPIKE S3 trustProxy=false remote=203.0.113.9 headers={"host":"evil.example"}: 200 http://evil.example/tenants/system
SPIKE S3 trustProxy=false remote=203.0.113.9 headers={"host":"idp.example.test"}: 200 http://idp.example.test/tenants/system
SPIKE S3 trustProxy=false remote=203.0.113.9 headers={"host":"idp.example.test","x-forwarded-proto":"https"}: 200 http://idp.example.test/tenants/system
SPIKE S3 trustProxy=false remote=203.0.113.9 headers={"host":"evil.example","x-forwarded-host":"idp.example.test","x-forwarded-proto":"https"}: 200 http://evil.example/tenants/system
SPIKE S3 trustProxy=true remote=203.0.113.9 headers={}: 200 http://localhost/tenants/system
SPIKE S3 trustProxy=true remote=203.0.113.9 headers={"host":"evil.example"}: 200 http://evil.example/tenants/system
SPIKE S3 trustProxy=true remote=203.0.113.9 headers={"host":"idp.example.test"}: 200 http://idp.example.test/tenants/system
SPIKE S3 trustProxy=true remote=203.0.113.9 headers={"host":"idp.example.test","x-forwarded-proto":"https"}: 200 https://idp.example.test/tenants/system
SPIKE S3 trustProxy=true remote=203.0.113.9 headers={"host":"evil.example","x-forwarded-host":"idp.example.test","x-forwarded-proto":"https"}: 200 https://idp.example.test/tenants/system
```

**Falsified.** `ODUDU_PUBLIC_BASE_URL` plays no part in the issuer. The
issuer is `issuerBaseFor(request)` (`packages/protocol-oidc/src/view/issuer.ts`),
which is `request.protocol` and `request.host`, canonicalised. So an
injected request's issuer is whatever `Host` the inject sends. With
`trustProxy` off, `request.protocol` is `http` for every inject, because
light-my-request's mock socket is never `encrypted`. With it on,
`x-forwarded-proto` and `x-forwarded-host` win. The admin API checks a
token's `iss` against the issuer recomputed from its own request
(`packages/protocol-admin/src/view/routes/router.ts`). The logout endpoint
checks an `id_token_hint` against the issuer of the browser's own logout
request (`packages/protocol-oidc/src/view/routes/logout.ts`).

The consequence for the gateway: "the discovered issuer" means nothing
until the gateway fixes the `Host` it injects with. The browser's `/auth`
request derives the callback's `iss` from its own `Host` and scheme. The
ID token is minted by the code exchange the gateway injects, so its `iss`
comes from the gateway's inject. The two agree only if the gateway injects
with the public base's authority and scheme. It must never pass the
browser's `Host` through. With an `https` base and `ODUDU_TRUST_PROXY` off,
no inject can produce the `https` issuer the browser sees. Before the login
and callback are built, one of these has to be decided:

- make `issuerBaseFor` return `ODUDU_PUBLIC_BASE_URL` when it is set, which
  changes the issuer on every OIDC and admin route, not only the
  gateway's;
- or have the gateway inject `host` and `x-forwarded-proto` taken from the
  base, and require `ODUDU_TRUST_PROXY` for an `https` base.

### Logout with `id_token_hint` and a registered `post_logout_redirect_uri`

`http://127.0.0.1:8080/console/` is written into `odudu-admin`'s
`client_oidc_config.post_logout_redirect_uris` directly, since the seeded
client registers none. The ID token's `sid` is the SSO session, and the
browser's cookie is `system-session`. The logout request is a `GET` with
`id_token_hint`, `client_id=odudu-admin`, that `post_logout_redirect_uri`
and `state=ls`. It is sent once without the SSO cookie, then with it.

```
SPIKE S4 /auth with SSO cookie before logout: 302 http://127.0.0.1:8080/callback?code=…&state=st&iss=http%3A%2F%2Flocalhost%2Ftenants%2Fsystem
SPIKE S4 logout without the SSO cookie: 302 http://127.0.0.1:8080/console/?state=ls (no set-cookie)
SPIKE S4 /auth with SSO cookie after cookieless logout: 302 redirect with code
SPIKE S4 logout: 302 http://127.0.0.1:8080/console/?state=ls [
  'system-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0',
  'system-session-persistent=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
SPIKE S4 /auth replaying the pre-logout cookie: 200 (login form) true
SPIKE S4 sessions rows for sid after logout: [{"n":1,"expired":true}]
SPIKE S4 refresh after logout: 400 {"error":"invalid_grant"}
SPIKE S4 access token after logout, whoami: 401
```

**Confirmed**, with the cookie. The logout redirects to the registered URI
with `state` and clears both session cookies. It sets the session row's
`expires_at` to now or earlier; the row is not deleted. A replay of the old
cookie gets the login form. The session's grant is revoked, so both its
refresh token and its access token are refused. Without the cookie the
logout still answers the same `302` but ends nothing, and the SSO session
signs straight back in. So the logout has to be a navigation by the browser,
which the JSON-redirect design already requires. A test that follows the
returned URL has to carry the SSO cookie, because the `302` alone proves
nothing.

### Router and inject

A path traversal test against the console shell's asset route
(`packages/console-gateway/src/view/spa.ts`) using `app.inject` with a
literal `../`, an encoded `%2e%2e`, an encoded slash or a backslash all
answered `404` — but so did the same paths sent with no route registered
at all under `/console`, which proves the assertion was never reaching the
route.

```
verified: node --experimental-strip-types p3.mts (probe script, run against
a standalone Fastify instance registering only spaRoutes; body
`/console/assets/../../etc/passwd` -> inject: 404 "Route GET:/etc/passwd
not found" (Fastify's own default 404, no route registered for that path);
raw socket: 404, content-length 0 (spaRoutes' own asset-route 404))
```

**Confirmed.** `light-my-request` (`inject`'s implementation) resolves the
URL it is given through the WHATWG `URL` parser before Fastify's router
ever sees it, so `..`, `%2e%2e` and `\` are gone before routing starts. A
raw socket sends the request line exactly as written, which is what a
traversal test has to use to exercise the route's own handling rather than
the test harness's own normalisation.

## Part 2 — what building the gateway found

The gateway's transcripts are in [docs/console-paths.md](../console-paths.md).
These are the defects and false assumptions that building it turned up,
each fixed on the branch.

- **The issuer comes from `Host`, not from `ODUDU_PUBLIC_BASE_URL`** (S3
  above). The gateway injects `host`, `x-forwarded-host` and
  `x-forwarded-proto` taken from the base, never the browser's, and the
  server refuses to boot with an `https` base while `ODUDU_TRUST_PROXY` is
  off. `console-login.int.test.ts` completes a sign-in sent with
  `Host: evil.example`.
- **A replayed refresh token revokes the whole grant** (S2 above), so two
  concurrent refreshes would end the session. A per-process single-flight
  keyed by session sits in front of a `FOR UPDATE` re-check. With either
  one removed, the two-instance race test calls `/token` twice.
- **`safeReturnTo` let a double-encoded traversal out.** Decoding once and
  then applying `path.posix.normalize` passed `/console/%252e%252e/admin`,
  which a browser resolves to `/admin`. `verified:`
  `node -e` printed `/console/%2e%2e/admin true /admin` for the old
  decode, the old prefix check and WHATWG resolution. It now parses with
  `new URL` against a sentinel origin and returns that normalisation, and
  refuses C0 controls, backslashes and `%25` (`ab736a2`).
- **A callback refused after the code exchange dropped live tokens without
  revoking them.** Everything from fetching the keys to writing the session
  now runs in one guarded step, and the grant is revoked whether that step
  refuses or throws (`d37be33`, `e9b67d2`). The tampered-nonce test shows
  the refresh token then answers `invalid_grant`.
- **The refresh deadlocked the pool.** A refresh held its connection across
  the in-process `/token` call, which needs a connection of its own, while
  concurrent touches waited on the same row lock. A burst of 13 requests
  on a pool of 5 hung. The fix is a per-process semaphore of
  `max(1, min(2, max - 2))` refreshes, a touch that takes
  `FOR UPDATE SKIP LOCKED`, and a 5 s `lock_timeout` answering `502`. The
  burst hung again with the semaphore removed and with the touch made
  blocking again. `verified:` `node -e` against postgres@3.4.9 printed `5`
  for `sql.options.max` with `{max:5}`.
- **The proxy needs its own escape check.** light-my-request resolves the
  injected URL with WHATWG `URL`, so `/console/api/admin/%2e%2e/tenants/…`
  would have carried the gateway's bearer token to an OIDC endpoint.
  `upstreamPath` answers `404` for any path that resolves outside `/admin/`
  and forwards nothing. A raw-socket test pins this as well.
- **`inject` collapses dot segments before routing** ("Router and inject"
  above), so three of four traversal tests on the shell never reached
  it, and the first account blamed find-my-way, wrongly. The same test
  exposed a real shadowing bug: the shell's `/console/*` caught unknown API
  and sign-in paths, because `setNotFoundHandler` runs only when nothing
  matches. Both prefixes now claim themselves with catch-all routes.
- **The shell followed symlinks out of the build directory** and served
  dotfiles. The boot walk now takes only regular files (`lstat`-based
  dirents), skips dotfiles, and skips an asset over 10 MB (`75afcfd`).
- **Every README command running `apps/server/src/main.ts` failed on
  Node 24.** A parameter property in `SessionEntry` is not erasable under
  type stripping. It is now a declared field, and `erasableSyntaxOnly` in
  `tsconfig.base.json` makes typecheck refuse the next one (`7db31d0`).
  `verified:` `node --experimental-strip-types` imported the file, and
  README's `main.ts reap` ran end to end.
- **The reaper deletes console sessions without revoking, and needs no
  revoke**: the grant is bound to the tenant's SSO session, and
  `console-session.int.test.ts` "held a refresh token the server refuses
  once its SSO session has idled out" pins that its token then answers
  `invalid_grant`.
- **Smaller rulings.** A browser drops a `__Host-` cookie whose `Path` is
  not `/`, so the login cookie keeps the prefix with `Path=/`. A cookie
  sent twice counts as none. `/console/auth` keeps a `4xx` error's own
  status instead of turning it into a `500` page. Logout answers
  `200 {redirect}` rather than a `302`, because only the browser's own
  navigation carries the SSO cookie (S4 above).

## Part 3 spikes

Three assumptions the console foundation builds on, run on 2026-09-28 in a
scratch app, `apps/_spike-console`, inside the workspace so that
`workspace:*` resolution was real. The app, a temporary `spike-dom` project
in the root `vitest.config.ts`, and the lockfile change were removed
afterwards. Pins: `vite@8.3.1`, `@vitejs/plugin-react@6.1.1`,
`react@19.3.0`, `react-dom@19.3.0`, `@types/react@19.3.0`,
`@types/react-dom@19.3.0`, `react-aria-components@1.21.1`, `zod@4.6.1`,
`@testing-library/react@16.3.3`, `@testing-library/dom@10.4.2`,
`@testing-library/user-event@14.6.7`, `@testing-library/jest-dom@7.0.1`,
`jsdom@30.1.1`, `axe-core@4.13.0` (the version `@axe-core/playwright@4.13.0`
takes, `~4.13.0`), `playwright@1.63.0`, and the repository's own
`vitest@5.0.0` and `typescript@6.0.3`. All were published at least 24 hours
before the run. verified: `npm view <pkg> version time --json` for each.

### Vite and `@odudu/contracts`

Confirmed, with no Vite configuration beyond `base: '/console/'` and
`react()`. No `resolve.conditions` and no `optimizeDeps` entry were needed.
The app imported `tenantSchema` from `@odudu/contracts/admin`, whose
`tenants.ts` imports `#/admin/shared`, and parsed a fixture with it.

- **Type-check** passes with a tsconfig that extends `tsconfig.base.json`
  and overrides `lib: ["es2023", "dom", "dom.iterable"]`,
  `module: "esnext"`, `moduleResolution: "bundler"`, `jsx: "react-jsx"` and
  `types: ["vite/client"]`. `module` has to move with `moduleResolution`:
  keeping the base's `nodenext` fails with `TS5095` and `TS5109`. Under
  `bundler`, TypeScript resolved `@odudu/contracts/admin` to
  `packages/contracts/src/admin/index.ts` and `#/admin/shared` to
  `src/admin/shared.ts` through the package's `imports` map. A deliberate
  type error against the schema's inferred type was refused, so the check
  is reading the contract.
  verified: `pnpm typecheck` (`tsc -p tsconfig.json`), and
  `npx tsc -p tsconfig.json --traceResolution | grep "successfully resolved"`
- **`vite dev`** serves the contracts source through `/console/@fs/…`, with
  `#/admin/shared` rewritten to an absolute `@fs` URL and `zod` pre-bundled.
  Chromium rendered `parsed tenant: acme` with no console error.
  verified: `npx vite --port 5199 --strictPort`, then
  `curl -s http://localhost:5199/console/@fs/<repo>/packages/contracts/src/admin/tenants.ts | head -4`
  and `node dev-check.mjs http://localhost:5199/console/`
- **`vite build`** emits one `index.html` and one hashed entry chunk, with
  no `#/` specifier left in it.
  verified: `npx vite build`, then `grep -o '#/admin[^"]*' dist/assets/*.js`,
  which printed nothing

### React Aria under jsdom in Vitest 5

Confirmed. The test was a Vitest project with `environment: 'jsdom'`. It
rendered a React Aria `Button` and a `DialogTrigger`/`Modal`/`Dialog`,
pressed the `Button` by click and by Enter, opened the dialog, and closed
it once by its own button and once by Escape. `axe.run(document.body)`
found no violation, either before the dialog opened or while it was open.
Focus returned to the trigger both times. As a negative control, an
unnamed `Button` does raise `button-name`.
verified: `npx vitest run --project spike-dom` from the root: 2 files and
2 tests passed, the control included.

- The **setup file** is `import '@testing-library/jest-dom/vitest'`
  followed by `afterEach(() => { cleanup(); })` from
  `@testing-library/react`. `assumption:` the explicit `cleanup` is needed,
  because Testing Library's own automatic cleanup registers itself only
  when `afterEach` is a global, and this config does not set
  `globals: true`. This was not run without it.
- The **project needs no `@vitejs/plugin-react`**. Vitest 5's transform
  compiled the `.tsx` with the automatic JSX runtime without it.
- **The matchers only type-check when the setup file is inside the
  tsconfig's `include`.** With only `src` included, `toHaveTextContent`
  and the other matchers fail with `TS2339`.
- **Focus returns asynchronously**, so the assertion needs
  `await waitFor(() => { expect(opener).toHaveFocus(); })`. Asserted
  straight after the close click, it fails.
- jsdom prints `Not implemented: HTMLCanvasElement's getContext()` once per
  run, and the run still passes. `assumption:` it comes from axe, which
  cannot measure colour contrast under jsdom. Contrast therefore belongs to
  the Playwright pages, not to the component tests.
- The existing `unit` project matches `*.test.ts` only, so it did not also
  collect the `.test.tsx` file.

### Playwright against the dev stack

This spike **falsified one assumption**, and it has a consequence for the
plan. It confirmed the rest.

The scratch app's `dist` was copied into the running dev container and only
`odudu` was restarted:
`docker cp apps/_spike-console/dist docker-odudu-1:/app/console` and
`docker compose -f infra/docker/compose.yaml --env-file infra/docker/.env restart odudu`.
`/app/console` does not exist in the image, so `docker cp` created it.
After the restart, `GET /console/` answered `200` with `SHELL_CSP`
byte-for-byte, and the hashed chunk answered `200 text/javascript`.
verified: `curl -s -i http://localhost:3000/console/`

The administrator was seeded into throwaway tenant `spike-console-0928`
with a generated password:

```
docker compose exec -T odudu node dist/main.js seed tenant --name spike-console-0928
docker compose exec -T odudu node dist/main.js seed user --tenant spike-console-0928 \
  --username spike-admin --password "$SPIKE_PASSWORD" --email spike-admin@example.com
docker compose exec -T odudu node dist/main.js seed grant-role --tenant spike-console-0928 \
  --username spike-admin --role odudu-admin:tenant-admin
```

A Playwright 1.63.0 script (`chromium.launch()`, headless shell 1243)
registered a `securitypolicyviolation` listener with `addInitScript` and
collected console errors and page errors. It then opened `/console/`,
pressed the `Button`, opened and dismissed the `Dialog`, and went to
`/console/auth/login?tenant=spike-console-0928&return_to=/console/`. There
it filled the tenant's sign-in form, submitted it, and landed back on
`/console/`. `GET /console/api/session` then answered `200` with
`{"tenant":"spike-console-0928","subject_id":"01a0e7c6-…","username":"spike-admin"}`.
verified: `npx playwright install chromium`, then
`SPIKE_TENANT=spike-console-0928 SPIKE_USERNAME=spike-admin SPIKE_PASSWORD=… node gateway-check.mjs`

- **Falsified: the shell is not free of CSP violations as soon as it loads
  a contracts schema.** The first run reported `script-src blocked eval`
  on `/console/`. The cause is zod 4.6.1's `allowsEval` probe, a
  `new Function("")` inside a `try`
  (`zod/v4/core/util.js:218`). The throw is swallowed, but the browser has
  already reported the violation. The probe runs when each `z.object` is
  **constructed** (`zod/v4/core/schemas.js:1148`), so it fires as soon as
  the `@odudu/contracts` modules are evaluated, before anything is parsed.
  zod's own switch is `z.config({ jitless: true })`, and it has to run
  before any module that imports `@odudu/contracts` is evaluated. Placed
  in `main.tsx`'s body, after the imports, it still reported the violation,
  because ES imports evaluate first. Moved into its own module
  (`zodConfig.ts`), imported as the entry's **first** import, it reported
  nothing. **Consequence for the plan:** the scaffold task adds that
  first-imported module and `zod@4.6.1` as a direct dependency of
  `apps/admin-console`, pinned to the same version as `@odudu/contracts`.
  zod's `globalConfig` belongs to its module instance, so there must be
  exactly one copy. verified: `ls node_modules/.pnpm | grep '^zod@'`
  printed only `zod@4.6.1`. Without the module, the Playwright job's
  "no `securitypolicyviolation`" guard fails on its first run. Component
  tests do not load the entry, so they run zod's JIT path while production
  runs jitless. Both paths parse the same way.
- **Confirmed: the React Aria pressable style is admitted by its hash.**
  The page's only `<style>` element is the exact `@layer { [data-react-aria-pressable] { touch-action: pan-x pan-y pinch-zoom; } }`
  text. The `Button`'s computed `touch-action` is `manipulation`, which is
  Chromium's serialisation of `pan-x pan-y pinch-zoom`; an element without
  the rule would read `auto`. No `style-src` violation was reported.
- **Confirmed: sign-in end to end with no violation**, once zod was
  jitless. `shellErrors` and `allErrors` were both empty.
- **On this plain-HTTP stack the console's cookies carry no `__Host-`
  prefix and no `Secure`.** They are `odudu-console`
  (`HttpOnly; SameSite=Strict`) and the tenant's `<tenant>-session`
  (`SameSite=Lax`). The `__Host-` names appear only behind TLS, as in
  `infra/conformance/run-console-check.sh`. A Playwright check against
  `infra/docker` must not assert the prefixed names.
- `--with-deps` on `ubuntu-latest` was not exercised, since this run was
  on macOS. That half of the assumption stays open until the `e2e` job
  first runs.

Afterwards `/app/console` was removed and `odudu` restarted. `GET /console/`
answers `503 console build unavailable` again, as it did before the spike.
Tenant `spike-console-0928` and its user remain on the dev stack.

## Part 3 — what building the foundation found

These are the defects and false assumptions building the console's
transport, design system, shell and drafts turned up, each fixed on the
branch.

- **zod's eval probe violates the shell's CSP the moment a contracts
  schema is constructed**, before anything is parsed — "Vite and
  `@odudu/contracts`" above has the trace. `z.config({ jitless: true })`,
  in its own module imported first, fixed it while the build was one
  chunk. Once two lazy features shared zod, the bundler moved zod into a
  shared chunk evaluated before the entry's first import, and the probe
  fired on every page. The build now puts zod and that module in one chunk
  that imports nothing (`apps/admin-console/vite.config.ts`), and
  `tests/lint/console-zod-chunk.test.ts` reads the built `dist` to hold it
  there; the first-import check keeps only the development server right.
- **React Aria injects a second `<style>` element, not only `usePress`'s.**
  On iOS WebKit, `usePreventScroll` prepends an `overscroll-behavior:
contain` rule. `SHELL_CSP` carries both hashes;
  `packages/console-gateway/src/view/react-aria-style.test.ts` recomputes
  each from the installed react-aria and refuses a third.
- **Two lint scans read zero files under `turbo`.** `no-any.test.ts` and
  `comment-block-length.test.ts` globbed with no `cwd`, so run from
  `tests/` — as the package-scoped test task does — they matched nothing
  and passed vacuously. verified: unrooted, the glob read 0 files; rooted
  at `REPO_ROOT`, 847. Both now glob from `REPO_ROOT` and assert a known
  file was among what they read.
- **`smoke.sh` targeted the user's own stack.** It ran `docker compose
up`/`down -v` in the default project `docker` — the user's dev stack's
  project — and would have torn it down. It now runs as
  `COMPOSE_PROJECT_NAME=odudu-smoke`, on its own ports, beside whatever
  else is running.
- **The transport's `path` escaped `/console/api/` by string
  concatenation.** `../`, `%2e%2e/` and a changed origin all got out.
  `resolve()` now builds a `URL` against `location.origin` and refuses a
  result outside that prefix; tested against nine escape forms.
- **The warning signal's first tint sat at the same hue as
  `--signal-system`'s amber** (30–44°, similar saturation), so a
  stale-password warning inside a system-authority session was hard to
  tell from the ContextBar it sat beside. Moved to an ochre at least 0.06
  OKLab ΔE from amber — three times the just-noticeable difference —
  keeping every ink at or above 4.5:1.
- **The rail's collapse query depended on AppShell's `shell` container
  name**, coupling two components' CSS modules through a name that stays
  unscoped only by accident of Vite's default transform. The rail now
  names its own `rail` container. Separately, DataTable and Section each
  queried their own width against a threshold meant to track the
  **shell's**, so a table inside the collapsed-rail range read the wrong
  breakpoint; both now query the shared `shell` container instead.
- **SecretDialog keyed its list on the secret's own value**, so the
  one-time secret it displays walked the rendered React fiber tree — the
  one place it must never appear outside its own text node. A generation
  counter supplies the key now; a test walks the fiber tree and asserts no
  key contains the secret.
- **`rebase(draft, fresh)` discarded a real conflict silently**, keeping
  every edit and dropping the server's own concurrent change with nothing
  to show for it. It now returns `{ draft, conflicts }`, computed before
  the old base is discarded, which is what the 412 view Part 4 builds
  needs.
- **A draft was keyed by its record alone**, so a system administrator's
  draft in one tenant survived into another tenant's console session —
  same route, different tenant, showing somebody else's unsaved edit.
  Drafts are now keyed `${tenant}/${record}`.
- **In the phone and collapsed-rail menu sheet, Sign out did nothing and a
  rail link reloaded the whole page.** `onClickCapture` closed the sheet
  on the capture phase, unmounting the pressed control before React
  Aria's own click handler ran. Closing the sheet inside `startTransition`
  fixed it; jsdom does not reproduce the race ("Part 3 — the browser
  tests", below, has the guard).
- **`inject` collapses dot segments before routing reaches a handler**
  ("Router and inject", Part 2 spikes, above), so a traversal probe
  against `inject` alone proves nothing. Every traversal or escape test
  the foundation added — the transport's own path check included — used
  a real socket.

## Part 3 — what the final review found

The whole-range review found these defects in the foundation, each fixed on
the branch, three of them in the session lifecycle this part owns.

- **A system administrator whose session ended inside another tenant was
  sent to that tenant's sign-in**, which cannot admit them. The sign-in is
  now at the tenant that issued the ended session, returning to the page.
- **Another tab's sign-in replaced the session under a live tab unseen.**
  Every tab shares the cookie, so the tab kept showing one administrator
  while acting as another, and dropped its drafts when it next read the
  session. Each admin request now names its tab's subject in
  `X-Odudu-Console-Subject`; the gateway refuses a mismatch `409`, and the
  console treats that, or a session read naming somebody else, as the end
  of the tab's session and asks before becoming the new principal's.
- **`?login_error=` was never read**, so a cancelled sign-in or a refused
  tenant switch came back without a word. The console now says why.
- **A feature's `index.ts` let a service reach views and stores**, since
  the layer rules are per edge and the barrel matched none. Services now
  import only services and `@odudu/contracts`, and an `index.ts` publishes
  only its feature's views, usecases and services.
- **A draft field was kept unless flagged secret**, so a new password
  field would have reached `sessionStorage` by omission. Every field now
  says `kind: 'plain' | 'secret'`, with no default.
- **The axe lint missed a single-file view layer and any view with no
  test**; twelve views had none.

A system administrator opening a well-formed tenant that does not exist
still gets the shell with placeholder areas. It is harmless while every
area is a placeholder, and it is Part 4's (spec §12, item 5). The `whoami`
read there answers a plain `401`, not a `404`: the admin router refuses an
unknown tenant before it authenticates, and the gateway passes it through
with the session kept (`apps/server/tests/console-proxy.int.test.ts`).

## Part 3 — the console's bundle

The built console is one JavaScript chunk of 561 KB (Vite warns above
500 KB): React, React Aria, TanStack Router and Query, and zod, with every
area still a placeholder. Route-level code splitting and a vendor chunk are
placed in P4d's fourth part, where the feature routes arrive and there is
something to split along; splitting placeholders now would only measure
the router.

## Part 3 — the browser tests

`apps/admin-console/e2e/run.sh` builds the image, starts `infra/docker` as
the compose project `odudu-e2e` (ports 3080 and 5462 unless
`ODUDU_HOST_PORT` and `POSTGRES_HOST_PORT` say otherwise), and runs the
Playwright specs in Chromium. The `e2e` job in `verify.yml` calls the same
script. `global-setup.ts` seeds two throwaway tenants, their administrators
(one through `seed user --require-password-change`), and a system
administrator, under names fresh on every run.

- **Every page** fails its test on a `securitypolicyviolation` or a console
  error, through an automatic fixture. The one tolerated message is the
  browser's own report of a `401` from `/console/api/session`, which is how
  the console learns it has no session; any other `401` fails the test
  unless the test forgives it. A test that fails a request on purpose
  takes back only what the browser logged about that request.
- **axe** runs with the WCAG 2.2 AA tags on each console page a spec
  reaches, under both `prefers-color-scheme` values and both `data-theme`
  overrides, and fails if `color-contrast` did not run. A control with
  low-contrast text injected into the page was reported in all four modes.
- **Cookies** are not asserted by name. On this plain-HTTP stack they carry
  no `__Host-` prefix, and `run-console-check.sh` covers the https form.

**What the specs found.** In the phone menu sheet, **Sign out did nothing
and a rail link reloaded the page**. The sheet closed on the click's
capture phase, and that discrete update unmounted the pressed control
before React Aria's click handler reached it. Sign-out's press never fired,
and the link fell back to a full navigation outside the router, and so
outside the unsaved-changes guard. jsdom and user-event did not reproduce
it, and a component test written for it passed on the broken code. The
sheet now closes as a transition. The phone specs failed with the old
`AppShell.tsx` rebuilt into the image, and pass with the fix.

This regression is guarded only by that e2e spec: jsdom's synthetic event
dispatch does not reproduce the capture-phase unmount, so a component test
for it passes on the broken code same as the original one did.

**The tenant's sign-in pages fail WCAG 2.2 AA.** axe reports `target-size`
on `#passkey-submit`: the pages are unstyled, so their buttons are smaller
than 24px. They belong to `protocol-oidc`'s view layer, not to the console.
Their styling is P4b's, whose criterion themes every page the server
renders. `signin.spec.ts` holds the check as a `test.fixme`, to be switched
on when it passes.

**Owed by P4d's fourth part, with its first editing feature, and done
there:** the e2e test of a session expiring mid-edit, which restores the
draft after sign-in and saves nothing, and the `beforeunload` prompt a
dirty section registers. When this part closed every area was still a
placeholder, so the test waited, as a skip in `signin.spec.ts`, for a real
section rather than a fake one built into the production app. Tenants
brought one: "a session that ends mid-edit restores the draft after
sign-in and saves nothing" in `apps/admin-console/e2e/tenants.spec.ts`
edits a tenant's display name, deletes the principal's `console_sessions`
row through psql, saves, comes back through `/console/auth/login` to the
restored draft with nothing saved, and closes the page to the
`beforeunload` prompt. The skip is gone. The draft round-trip is also
covered by the component tests in `app/draftRestore.test.tsx`.

Two seeded accounts are single-use per run, so `--repeat-each` fails on
them by construction: the forced password change is spent once, and the
expiring session's test deletes that user's sessions, which would end a
parallel repeat's too.

**For the repository owner:** making `e2e` a required check on `main`
beside `verify`, `container` and `commit-messages` is a branch-protection
setting, which only the owner can change.

## Part 4 spikes

Three browser and proxy behaviours the console's features build on, run on
2026-09-28. S1 and S2 ran in a throwaway change to `apps/admin-console`: two
extra routes under `$tenant` in `app/router.tsx`, two components in
`src/spike/`, and `e2e/spike.spec.ts`. The image was built from that tree,
so the gateway served the split build under `SHELL_CSP`, byte for byte as
`spa.ts` sets it. The spec used the harness's `problems` fixture, which
fails a test on any `securitypolicyviolation` or console error. Pins:
`@playwright/test@1.63.0`, headless shell 1243,
`@tanstack/react-router@1.170.39`, `@tanstack/router-core@1.171.32`,
`vite@8.3.1`. Everything throwaway was deleted and the stack went down.
verified, S1 and S2: `ODUDU_HOST_PORT=3080 POSTGRES_HOST_PORT=5462 bash apps/admin-console/e2e/run.sh spike.spec.ts --reporter=list`
(compose project `odudu-e2e`, which `run.sh` takes down on exit)

### A blob download under `SHELL_CSP`

**Confirmed.** A button built a 5,207,180-byte UTF-8 text containing
`ü`, `—`, `𝄞` and `✓`, read it back through `new Response(text).blob()`,
and wrapped it as `new Blob([body], { type: 'application/vnd.odudu.tenant+json' })`.
It then clicked a detached `<a download="acme.odudu-tenant.json">` on
`URL.createObjectURL(blob)`, and revoked the URL in a `setTimeout(…, 0)`.

```
SPIKE S1 filename acme.odudu-tenant.json url blob:http://localhost:3080/d9c554fb-971f
SPIKE S1 bytes got 5207180 want 5207180 sha got d4407385c03fae3853f09fb1f289521cb579c9ac817b4e665ce60d60f7e9287a want d4407385c03fae3853f09fb1f289521cb579c9ac817b4e665ce60d60f7e9287a equal true
```

The saved file is byte-identical to the one Node built from the same
generator. The suggested name is kept. No directive needs `blob:`, and the
fixture saw no violation. Revoking straight after the click did not cut the
file short.

### Lazy route chunks under `script-src 'self'`

**Confirmed, for both ways of splitting.** One route used
`lazyRouteComponent(() => import(…), 'SpikeLazy')`. The other used
`React.lazy` inside a `Suspense`. The build emitted each as its own chunk,
and the gateway's asset walk served both:

```
SPIKE S2 chunks ["200 http://localhost:3080/console/assets/SpikeLazy-CR16uCpe.js text/javascript; charset=utf-8","200 http://localhost:3080/console/assets/SpikeReactLazy-B38h4GEK.js text/javascript; charset=utf-8"]
```

Both routes rendered, and the fixture saw no violation.

**A stale chunk under `lazyRouteComponent` writes `sessionStorage` and
reloads the page.** The source is
`node_modules/.pnpm/@tanstack+react-router@1.170.39_react-dom@19.3.0_react@19.3.0__react@19.3.0/node_modules/@tanstack/react-router/dist/esm/lazyRouteComponent.js:37-43`.
When `isModuleNotFoundError(error)` holds
(`@tanstack+router-core@1.171.32/…/dist/esm/utils.js:147-150`, a message
prefix match), it writes `tanstack_router_reload:<message>` to
`sessionStorage` without a guard. If the key was not already set, it calls
`window.location.reload()`. A second test answered the chunk with a 404
through `page.route`:

```
SPIKE S2 stale loads 2 sessionStorage {"tanstack_router_reload:Failed to fetch dynamically imported module: http://localhost:3080/console/assets/SpikeLazy-CR16uCpe.js":"1"}
SPIKE S2 stale body Something went wrong!
```

So the page reloaded once. After the reload the key was already set, so the
error reached the router's default error component. The key is never
cleared. A later stale chunk with the same message in the same tab goes
straight to the error and does not reload.

**Recommendation: `React.lazy`, not `lazyRouteComponent`.** The storage
lint (`tests/lint/console-storage-only-in-adapter.test.ts`) scans only
`apps/admin-console/src`, so it would never see the library's write. That
makes an exemption invisible, not merely allowed. It would put storage and
a navigation outside the storage adapter and outside `useLeaveConsole`,
which the Part 3 decision "storage behind adapters" rules out. `React.lazy`
does neither. A failed import rejects into the nearest error boundary. The
console then owns what a stale deployment looks like: a message and a
reload that goes through its own guard. A rejected `React.lazy` stays
rejected, so recovery is a reload, never an in-place retry.

### The conformance proxy's body limit

**Confirmed: 1 MiB, so a 16 MiB import is refused with `413` before it
reaches Odudu.** `infra/conformance/proxy/nginx.conf` sets no
`client_max_body_size`. Its image is `nginx:1.27-alpine`, which reports
`nginx/1.27.5`. The image was built from `infra/conformance/proxy` and run
on a network of its own. A stub nginx named `odudu` stood in for the
server, answering `200` to anything, since the limit is enforced before
anything is proxied. Bodies were POSTed to
`https://localhost:8643/console/api/admin/tenant-imports`:

```
1m: 200
1m1: 413
16m: 413
```

With `client_max_body_size 16m;` added to the `server` block and nginx
reloaded:

```
16m: 200
16m1: 413
```

nginx's `m` is 1,048,576 bytes, so `16m` admits exactly
`TENANT_IMPORT_BODY_LIMIT` (`packages/contracts/src/admin/tenant-document.ts`),
and one byte more is refused at the proxy. **A proxy in front of a
deployment that imports tenants must set `client_max_body_size 16m` or
more,** or its equivalent, on `/console/api/admin/tenant-imports` and
`/admin/tenant-imports` at least. Every other route is capped lower by
the server itself. The conformance suite never imports, so its proxy needs
no change. The deployment section of `README.md` should say this when the
import feature ships.
verified: `docker build -t odudu-s3-proxy infra/conformance/proxy`, then
`docker run` of it and of the stub on network `odudu-s3`, then
`curl -sk -o /dev/null -w '%{http_code}' -X POST --data-binary @<file> https://localhost:8643/console/api/admin/tenant-imports`
for files of 1,048,576, 1,048,577, 16,777,216 and 16,777,217 zero bytes,
and `docker rm -f`, `docker network rm` and `docker rmi` afterwards

## Part 4 — Overview, Tenants and System administrators

**A tenant that does not exist answers whoami with `401`, not `404`.** The
admin router refuses an unknown tenant before it authenticates, and the
gateway passes that through with the session kept. So "Tenant not found" is
the shell's, shown to a system principal on any area of a tenant other than
`system`; a session ending is recognised by its own problem type, never by
a plain `401`, so the two cannot be confused.

**zod's jitless setting has to share a chunk with zod.** A first import is
not enough once the bundle splits: the tenants chunk made rolldown hoist
zod into a shared chunk that ran before `zodConfig.ts`, and every page then
tripped `script-src` on zod's `new Function` probe. `vite.config.ts` now
puts both in one chunk that imports nothing, and
`tests/lint/console-zod-chunk.test.ts` reads the built `dist` to hold it.

**"Ready to promote" is bounded, not computed.** Settings carry no token
lifetime; lifetimes are per client and capped at 3600 s by migration 0013,
and no signed token outlives an access token. So a `rotating` key is ready
after 3600 + 300 s, which can be late but never early. A key is offered
only when its `alg` matches the active key's, since promoting one of
another algorithm re-signs everything the tenant issues. Nothing records
when a key was demoted, so a rotating key older than the active one is
taken to be a demoted one (`shared/service/keyPromotion.ts`).

**Import needs the proxy's body limit raised**, as the spike above found;
`README.md`'s deployment section now says so, and a `413` on import is
worded as a body limit rather than a refusal.

**Addresses.** Creation and import sit at `/console/system/new-tenant` and
`/console/system/import-tenant`, since `new` and `import` are valid tenant
names; adding a system administrator is `/console/system/system-admins/new`,
and the tenant rail's area is `export`. The mid-edit session-end test and
the `beforeunload` prompt, owed by the first editing feature, are in
`e2e/tenants.spec.ts`.

**A system administrator is granted system's `tenant-admin`**, the same
grant `odudu seed admin` makes. Revoke removes only the subject's own
administrator roles; one held through a group or a nested role is pointed
at, and the holders are asked again afterwards rather than the answer being
worked out.

## Part 4 — Subjects: list, create, Profile and Credentials

**Three admin routes the console needed and the API lacked.**
`GET /subjects/:id/lockout` reads the run of failures, judged by the
server's clock; `DELETE /subjects/:id/recovery-codes` revokes a set that
carries no ids; `GET /subjects/username-policy` answers `username_editable`
to `view-users`, so a Profile tab can show the username fixed with its
reason rather than offer it and be refused. The setting stays off the
subject representation on purpose: it would repeat on every list row and
enter the subject's `ETag`, so turning renaming on would answer every open
Account section with a `412` for a field nobody edited.

**A disabled subject's admin token is refused.** Disabling ends nothing a
subject holds, and `authenticateAdmin` checked the grant, the session and
the client but not the subject, so an access token issued before lived out
its lifetime at the admin API. It now reads the subject beside the client,
answering the plain `401` an invalid token gets; the gateway ends a console
session on it as on any `401` its own tenant's whoami confirms. The same
gap stood at `/userinfo`, `/introspect` and token exchange, which checked a
disabled client but not a disabled subject — the one-door defect again —
so all four, and the refresh grant that already had it, now ask one
predicate, `subjectIsEnabled` in `@odudu/domain-identity`.

**One view test was not seen red.** `SubjectsPage.test.tsx` was written
before the page but first run after it; every other test in the feature was
seen failing first.

## Part 4 — Subjects, the admin API's remaining doors, and trying the console

**Disabled means disabled at every door.** Disabling a subject used to stop only the refresh grant. Its unexpired access token still worked at `/userinfo`, `/introspect`, token exchange and the admin API. One predicate now answers for all five: `subjectIsEnabled` in `packages/domain-identity`. Each door refuses the way it already refuses a revoked grant, so the answer never says why. A disabled tenant keeps publishing its keys and discovery document, so relying parties can still check the Back-Channel Logout tokens it sends. Disabling a tenant ends its sessions in batches of 500, and deleting it waits until none are left (ADR 0026, ADR 0040's amendment).

**A gap audit closed the admin API.** The admin API was compared against Keycloak's, Auth0's and Okta's operator surfaces. Twenty routes were missing for features the server already had. They now exist: a subject's grants, tenant-wide sessions, mail status, claim evaluation, tenant deletion, bulk subject operations, audit export and the rest. Capabilities the server does not have are named in their owning phase's §11 criterion. `tests/docs/gap-audit-placement.test.ts` holds that list to §11.

**Trying the console found what tests did not.** The user tried the console by hand, and the mistakes it turned up were about layout and wording:

- three creation flows that shared one stored draft;
- a rail that lit nothing on two pages;
- keyboard hints drawn like buttons;
- form controls of four different heights;
- placeholders thinner than the rows they stand in for;
- a dead-end "Sign-in failed" page.

The last one came from a provider tab restored hours later, which brought back the console's old state. A refused callback now starts one fresh sign-in, and a second refusal shows the page with a way out.

**Typed fields.** Phone numbers are read with `libphonenumber-js`, loaded only with the chunk that shows them. Country names are CLDR's common English names, pinned in the repository rather than taken from whatever the browser ships. Autofill is off on another person's record, because WCAG 1.3.5 concerns the user's own data.

**Two console rules are now lints.** Interfaces carry no property-level `readonly`; readonly arrays, tuples, maps and sets keep theirs. A read is never wrapped in `useMutation`; a confirmation that must reach the server goes through `useFreshRead`.

**Configuration the gap audit placed in P4d.** Token, code, login and email-link lifetimes are now tenant settings. Clients carry RFC 7591's pages, their own ID token algorithm, `default_max_age` and `require_auth_time`. A rotated-out secret stays valid for a bounded grace period. A tenant can let its users sign in with a verified address; an input containing `@` resolves to the address first, with both lookups always run. Groups and roles carry descriptions. Groups and scopes can be defaults. Scopes carry consent text and an order. A tenant chooses which audit event types it stores, though the admin pair can never be turned off. One admin route mails a link through any set of required actions, and every way a password is set retires every outstanding link that could set one.

Two defects turned up only while capturing transcripts:

- A mailed link that sets a password failed for a subject with no password, which is every subject an administrator creates.
- Migration 0082 rewrote rows under `FORCE` row-level security without lifting it, so under a least-privilege owner it would have written nothing. Its backfill test now migrates as that owner.

**Subjects, second half.**

- **Tabs.** A subject's record gains Groups, Roles, Required actions, Sessions, Consents, Grants and Activity. Credentials gains the three emailed actions.
- **Administrators.** The list of administrators is one list everywhere. It reads, in one query, every holder of any admin capability and what each holds: `capability=any` and `admin_capabilities` on the subjects list. A holder's set is edited in place, with ADR 0040's ceiling shown for each capability.
- **Record writes.** Every write on a record is held to the ceiling, not just the capability editor's. A record that is read-only says each reason it is, and judges nothing until effective roles have loaded.
- **Self-loss.** Removing your own capabilities, directly or by leaving a group, asks first.
- **Full administrators.** A new tenant's first administrator stays Full. Without one, nobody in the tenant could grant every capability, and the last-administrator guard would protect nothing.

## Part 4 — sign-in through required actions, and a relying party on another origin

**A finished required action resumed nothing.** Every action — the password change, TOTP, a passkey, recovery codes, and the emailed link's leftovers — answered its own completion with the login form again. Each action cost one more entry of whatever factor finished authentication, and enrolling TOTP added a code prompt per action after it, each waiting for a fresh 30-second step. Two causes:

- `advance` never wrote down the factor that finished a login, so the attempt could only be continued by running that factor again.
- The code that confirms a new authenticator was spent on the credential and credited to nothing, so the next pass asked for another one.

Now every factor that succeeds is written down, an empty submission against a session the flow considers complete resumes it, and the enrolment code is the session's `otp` factor. The required-action route resumes through `handleLoginSubmission` and answers through the same sender as the login form (`view/routes/login-response.ts`), so the next action, consent and the code follow in order, and `remember_me` is parked across the detour. "Complete" is computed from the flow as it stands for the subject, not read off `authenticated_at`: an authenticator enrolled in another tab un-finishes a password-only session, which is what keeps recovery codes from a session that never proved a code. The consent door's ID tokens had carried no `amr` or `acr`, for the same first cause.

**`form-action 'self'` refused the redirect to the client.** Chromium applies the directive to the redirect a form submission follows, so a client on another origin got its code issued and never received it. A page continuing an authorization request now names that request's `redirect_uri` origin, through `RenderedPage.redirectsTo` and `pageHeaders` (ADR 0018's second amendment). `apps/admin-console/e2e/relying-party.spec.ts` is the first browser test against a client that is not same-origin.

Why the conformance runs never showed it: CI runs Config OP, which drives no browser. The only Basic OP run (`results/basic-op-2026-09-12-…`, 02:31Z) predates the policy, which landed at 19:25Z that day in `a0507a2f`. The Dynamic OP run on 2026-09-19 completed no authorization request: every module failed earlier, on PKCE or `private_key_jwt`. The proxy does not hide it, because `https://proxy` and the suite's callback on `localhost.emobix.co.uk:8443` are different origins. assumption: the suite's HtmlUnit browser may not enforce `form-action` at all, so a passing Basic OP run would not have proved the opposite either.

Found by the review of that work and fixed with it:

- **A reused password-only SSO session was never judged against the flow.** For a subject who had since enrolled TOTP and still owed recovery codes, `GET /authorize` promoted it and rendered the codes page, which replaces the subject's codes on every render: a second-factor bypass by reload, and the same session then met a 400 at every consent and required-action POST. `/authorize` and the account chooser now ask `authenticatorsSatisfyFlow` of the reused session's `amr` before promoting it, and show the login form when it fails, as `prompt=login` does (`prompt=none` answers `login_required`). The recovery-codes page also refuses unless `authenticatedSubject` names the subject.
- **A subject disabled between the password and the resume still finished the login** through the consent door or a finished required action. `completeLogin` now refuses before consuming the session.
- The emailed actions page linked "Back to the application" to the bare `redirect_uri`, whose callback carries no `code` or `state`. It now says to sign in to the application. The `redirect_uri`/`client_id` pair on `actions-email` is still validated, stored and audited, and nothing reads it back: the usecase's `redirectStillRegistered` check and the `done` result's `redirectUri` were removed as dead. Whether the pair stays in the admin API is a contract question for the admin API's owner.
- The code form was titled "Sign in" with a "Sign in" button. It is now "Enter your authentication code" with "Verify"; the recovery-code-only form is "Enter a recovery code".
- A bracketed IPv6 loopback `redirect_uri` still gets `form-action 'self'` only, a closed failure recorded in ADR 0018.

**Groups, roles, and a sign-in that resumes.**

- **Ceilings without a request per node.** Groups and roles answer their own admin reach (`admin_reach`, `subtree_admin_reach`, `holds_default_group`), so the console judges every group and role write before offering it.
- **The move race.** A move that races a sibling for its name answers 409, not 500. The test forces the race with a trigger and an advisory lock.
- **Required actions.** Trying the console showed that every required action ran the login again: two or three password forms, and three codes to enrol TOTP. A completed action now resumes the same authentication session. Each factor is recorded as it passes, and the enrolment code counts as the second.
- **Second-factor bypass.** The same work found an older bypass. A reused password-only SSO session could be handed fresh recovery codes for a subject who had since enrolled TOTP. Reuse is now judged against the flow as the subject currently stands, and a disabled subject's session is never reused.
- **Cross-origin redirect.** The login and logout pages' `form-action 'self'` stopped Chromium from following the redirect to a client on another origin. They now name that client's redirect origin, taken from the validated request (ADR 0018's amendment). CI's Config OP plan uses no browser, which is why nothing caught it.

## Part 4 — folder imports

A view component lives in a folder `X/` and is imported as the folder
(`#/shared/view/Button`). The spike moved `shared/view/Button` into
`Button/` (`Button.tsx`, `Button.module.css`, `Button.test.tsx`, an
`index.ts` that re-exports) and changed its importers.

With only `package.json` `"imports": {"#/*": "./src/*"}`, the typecheck
failed and nothing else did:

```
$ pnpm --filter @odudu/admin-console exec tsc --noEmit
src/features/groups/view/GeneralTab.tsx(13,24): error TS2307: Cannot find
module '#/shared/view/Button' or its corresponding type declarations.
... (63 errors)
```

An `imports` target is an exact path, and TypeScript does not look for
`<dir>/index.ts` through it. Vite, Vitest and dependency-cruiser did resolve
it. Vitest's `css.include` patterns (`vitest.config.ts`) matched only
`\w+.module.css?raw`, so a stylesheet inside a folder came back as `''`;
they now take `[\w/]+`.

The fix is `compilerOptions.paths: { "#/*": ["./src/*"] }` in
`apps/admin-console/tsconfig.json`, which does the directory lookup. The alias
now lives in two places, so `tests/lint/console-alias-agrees.test.ts` fails the
build when they disagree. A folder's `index.ts` re-exports its own files by
`#/shared/view/Button/Button.tsx`, because relative imports are banned.

Re-run with the `paths` entry and the pattern fix:

```
$ pnpm --filter @odudu/admin-console exec tsc --noEmit
(exit 0, no output)
$ pnpm --filter @odudu/admin-console exec vite build
✓ built in 272ms
$ pnpm exec vitest run --config vitest.config.ts \
    apps/admin-console/src/shared/view/Button apps/admin-console/src/shared/view/FilterBar
 Test Files  3 passed (3)
      Tests  14 passed (14)
$ pnpm exec depcruise --config .dependency-cruiser.cjs apps/admin-console
✔ no dependency violations found (645 modules, 2429 dependencies cruised)
$ pnpm exec eslint apps/admin-console/src/shared/view/Button \
    apps/admin-console/src/features/groups/view/GeneralTab.tsx
(exit 0, no output)
```

What converting `shared/view` found:

- Six field components drew from `Field.module.css`, so they share the
  `Field/` folder rather than reach into it. `Skeleton` drew its table from
  `DataTable`'s classes and `ButtonLink` took `Button`'s; they now call
  `DataTableShape` and `buttonClass`. A paragraph that three features
  styled with `CapabilityNote`'s class became the `Note` component.
- The gallery's "every component shown" check read file names; it now reads
  each file's exports, so a family folder cannot hide a component.
- A signed-out user on a tenant address still sees the console frame for
  the moment between the session answer and the sign-in card. The frame is
  drawn only after the 200 ms delay, and the card is the same swap the page
  always made; there is nothing to fix short of knowing the answer first.

A folder's `index.ts` is a barrel, and a barrel pulled the phone numbering
plans into the entry chunk: `PhoneField` has top-level calls, so Rollup kept
it once anything in `Field/` was imported. `apps/admin-console/package.json`
now declares `sideEffects` as the stylesheets and `zodConfig.ts`, the only
modules imported for their effect, so an unused re-export is dropped.
That does not help when the import is used and sits in the same file as
something heavy: `Skeleton` took `DataTableShape` from `DataTable.tsx` and
carried react-aria's Table into the entry's static graph, about 95 kB more on
first load. `DataTableShape` has its own file, and
`tests/lint/console-phone-chunk.test.ts` now fails the build when the entry's
static chunks carry the phone metadata or react-aria's Table, ComboBox or
DateInput. First load (entry, zod, and the chunks it imports) was 703 kB at
the base, 798 kB with the regression, and is 704 kB now.

`Rail.module.css` and `DataTable.module.css` keep their own visually-hidden
rule: both sit inside container queries, where `composes` is not allowed, so
only the sign-in copy became `VisuallyHidden`.

## Part 4 — Clients: list, create, General and Redirects & origins

**A client's lists had no bound.** Redirect URIs, web origins, post-logout
URIs, audiences and client-credentials scopes were arrays of any length,
though each web origin and redirect URI is expanded into `client_origins`
rows when it is written and a client is listed whole. They now hold at most
`CLIENT_LIST_LIMIT` (200, `@odudu/contracts`), refused with `400` naming the
field, its count and the limit, on create, `PATCH`, dynamic registration,
import and `odudu seed client`, all in one sentence (`listLimitMessage`). The
console shows the count against the limit beside each list and takes the
server's own refusal for a non-canonical origin or URI, placed under the list
it names.

A write refuses only a list it changes. A client registered before the bound
existed, over 200, still has its other fields amended (the amendment no longer
re-checks `redirect_uris` it did not send), exports as it is stored, and is
refused on re-import with the field, count and limit, so the document has to be
trimmed first. Nothing in the database holds the bound: the doors are the
validators above, and `provisionAdminClient` refuses by name
(`admin_client_list_full`) to append the console's URI past it.

**The ceiling over a client is judged from its record.** Every confidential
client has a service account, and every write on the client is held to the
ceiling on it (ADR 0040). The record now carries
`service_account_admin_reach`, what that account holds of the admin
capabilities, derived on every read in one query per page
(`adminReachOfSubjects`) and outside the `ETag` as groups' `admin_reach` is. So
an operator holding `manage-clients` alone edits a confidential client the
account of which holds nothing beyond them, with no `view-users` read, and is
told, in one line, when it does. The server's own check needed nothing: it
already resolves the same set through `effectiveRoles`.

**The clients list filtered by `type` and nothing indexed it.** The plan check
did not drive that filter until the console offered it; at 10,000 clients it
read the whole tenant. `clients_by_type` (`0097`) serves it, and the plan volume
now holds confidential clients with service accounts, a fifth holding an admin
capability, so a page of answers is planned with its reach.
`GET /clients?client_id_exact=` is the unique-index lookup a creation whose
answer was lost uses, in place of paging a prefix.

**Placed beside the brief.**

- Delete, with the typed client ID, sits in General's danger zone as the design
  spec has it.
- Activity is built. It shows the changes filed under the client's row id; a
  creation refused before the client existed is filed under the `client_id`
  string and names no row, so the tab says it is not there. Showing both would
  need the audit read to take two ids or the console to merge two cursor-paged
  lists, which this does not do.
- Tokens, Scopes, Logout and Advanced were tabs that said they were not built yet; the next section builds them.
- A client is created as a web application, a service (`client_credentials`, no
  redirect URI) or a public application.

**Not every test was seen red.** The `redirect_uris` bound in
`parseClientMetadata`, the unbounded-field amendment, and the reach field's
console judgement were. The document-schema, create-over-limit and `seed
client` cases were written in the same step as their code and first run green.

## Part 4 — Clients: Tokens, Scopes, Logout, Advanced, Roles, Service account and Sessions

**What a client may be given is stated once.** The grant types, the
authentication methods, the userinfo and ID-token algorithms, the userinfo
encryption algorithms and encodings, and the token lifetime ranges now live in
`@odudu/contracts` (`client-rules.ts`). The validators import them, so the
console offers exactly the choices the server takes, and a parity test holds
the encryption algorithms to `@odudu/crypto`'s. No server behaviour changed:
no route, no response and no default moved, so `README.md`, `request-paths.md`,
`admin-paths.md` and the OpenAPI document stand as they were, and the plan check
had nothing new to drive.

**Five routes the plan never placed are Clients'.** Task 8b built a client's
sessions, the revocation of every grant it issued, its logout deliveries, its
installation and the evaluation of a subject's claims, and no console task named
a screen for any of them, so the route-coverage lint could never empty its
list. They are on the client's page: Sessions (a tab, with the revocation behind
the client's typed ID), Back-channel deliveries (under Logout), Installation
(under Advanced) and Evaluate (under Scopes).

**Placed beside the brief.**

- `id_token_signed_response_alg`, `default_max_age` and `require_auth_time` are
  Tokens' ID token section; `tls_client_auth_subject_dn` sits beside the
  authentication method and is sent only for `tls_client_auth`, as the server
  keeps it; `token_exchange_impersonation_allowed` is Advanced's own section.
- Userinfo encryption (algorithm and content encryption) is on Advanced beside
  signing, since the API takes it and the brief named signing alone.
- A lifetime or the default maximum age is "the tenant's" or a number, the
  toggle sending `null`. A number the server's range does not admit is held to it
  by the field, and one it refuses is placed under it.
- A JWKS pasted here is checked for shape only (JSON, a `keys` array); a private
  member is the server's refusal, shown in the field in its words.
- Scopes assign and unassign at once, not by a Save: the server's routes are one
  assignment each, and each is followed by a read of the client for its new
  `ETag`. A scope needs `manage-tenant`, not `manage-clients`, so a caller with
  only the second sees the list as text and what it lacks.
- The service account's admin capabilities are kept as they are by a save on
  the tab, and set on the account's own page, which the tab links to.
- Rotating a secret takes its grace period in seconds with the reading beside it,
  confirms before it sends, and shows the secret once in the existing dialog.
- `NumberWithUnitField` moved to a module of its own. Used for the first time,
  it brought react-aria's NumberField into every page's first load through the
  sign-in page's text field; the chunk lint now holds NumberField to a page that
  edits a number.

**No test was seen red before its code.** The tests were written beside the code
in this increment, then run and their failures read. Two rules were checked by
breaking the code by hand and watching the tests fail: the grants held back for a
client with no redirect URI, and the one key source sent with the other cleared.

### Fix round

**The scopes a client carries are bounded at 200.** The record and the list
answered every assignment of a client, and the tenant's own 1,000 scopes were the
only limit, so a page of 200 clients could carry 200,000 of them. Chosen: a bound
per client, `CLIENT_SCOPE_LIMIT` (the `ASSIGNMENT_LIMIT` of every other set the
API replaces), over a paged read of a client's scopes. A paged read would have
taken `scopes` out of the client's record, its `ETag` and the assign routes'
answers, a wire change for every caller, where a bound changes nothing for a
client under it. Because a new client is assigned every scope marked for it, the
marks are held to the same 200 (`DefaultScopeLimitError`), and the repository
refuses past both, so the admin API (`409`), an import (`400` at the path), the
seed command and registration all meet one rule. A client over it before keeps
its scopes and takes no new one. The existing `query-plans` drive of `PUT
/scopes/{id}/clients/{clientId}` covers the count it adds, which reads the
client's own rows by the key that leads with the client.

**What else changed.** Evaluate asks once per press, since each ask is audited, and
not again on a refocus. Revoking the console's own client says you will be signed
out. The access, readability and picker-choice decisions left the usecases. A
previous secret past its grace reads as past. Each Clients view component is a
folder. The back-channel deliveries, the revocation with real grants and the
keyboard and conflict passes of Tokens and Advanced run against real data: a
person signs in through an application of its own, a failed delivery is the
sender's attempts spent on an address it may not reach, and the backoff between
them is stepped over by moving `next_attempt_at`.

**The entry has under 4 KB of headroom.** 149.04 KB gzip against a budget of 153
KB (97.4%), and about 233.8 KB first load against 242 KB. The next task that
imports a shared view with a heavy dependency should check the build before it
spends the rest.

## Part 4 — `odudu-admin` becomes a confidential client

The decision and its rejected alternatives are ADR 0038's amendment of
2026-10-09. What building it found:

**The plan's CHECK could not be written.** It proposed relaxing
`clients_secret_matches_type` to `confidential AND (secret_hash IS NOT NULL OR
token_endpoint_auth_method <> 'client_secret_*')`. The method is on
`client_oidc_config`, and a CHECK on `clients` reads no other table, so the
constraint now says only that a public client holds no secret
(`0098_clients_secret_by_type.sql`). `grep -n -A3 clients_secret_matches_type
packages/db/drizzle/0004_clients.sql` was run before the plan was believed
here, as CLAUDE.md asks of a claim about this repository, and showed the
columns of one table only.

**`jwks_uri` was not a choice.** `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` does not admit a
loopback address, and a `jwks_uri` must be `https`; a stack whose base URL is
`http://localhost:3080` can never serve its own key set. Run, not read:
`assertPublicAddresses(['127.0.0.1'], { allowPrivate: true })` throws
`address 127.0.0.1 is a loopback address`, and `assertFetchableUrl('http://…')`
throws `scheme must be https, not http`.

**`/revoke` and `/introspect` never dispatched `private_key_jwt`.** Discovery
said so in a comment, and `[ODUDU-PRIVATE-KEY-JWT-02]` failed first for it. A
client authenticating that way could not revoke its own token, so the gateway's
logout would have answered `401` to a revocation it ignores the result of: the
refresh token would have outlived the session it belonged to. The check moved to
`usecase/private-key-jwt-authentication.ts` and both endpoints share it, with the
token endpoint's URL as the one `aud` at all three. `tls_client_auth` stays at
`/token` alone, placed on P13 as before.

**A `/revoke` test against a fixed clock would have passed for the wrong reason.** Revoking an
access token reads its signature and expiry against the real clock, so a token
minted under a clock pinned in 2026-09 was "unknown" and `/revoke` answered `200`
having revoked nothing, which RFC 7009 §2.2 requires. The suite's clock is now the
wall clock, and the first case proves the grant is revoked before the others rely
on its not being.

**The key's shape.** Base64 of the private JWK, as `ODUDU_KEK` is base64: a bare JWK in
an `.env` file wants quoting that `docker compose`, `source` and `node --env-file`
each do differently. The `kid` is the RFC 7638 thumbprint, never configuration.
The gateway stamps assertions with the wall clock, not the console clock tests move,
because the server checks an assertion's lifetime against its own.

**Rotation touches every tenant's row, and says so.** One `odudu console
provision` pass visits each tenant in a transaction of its own and writes only where
the registered keys differ; rotation is two such passes around a roll, and a third
if a tenant was created during it (README, "Rotating the console's key").
Measured, on the transcript stack with 1,000 bare tenants added by `insert`: a pass that
creates every tenant's admin client took 18.2 s over 1,002 tenants, a pass that
writes nothing 12.4 s, a pass that rewrites every tenant's registered keys 16.1 s,
and the pass that drops the old key 11.0 s. That is 11 to 18 ms a tenant, so 10,000
tenants is two to three minutes a pass: a tenant is read and, only when its keys
differ, written once, in a transaction of its own, so no pass holds more than one
tenant's rows.

**Things this made false, found by running the suites rather than by search.**
Every test that seeded under a console base URL needed the key; they take a
per-run key from `tests/setup/console-client-key.ts` rather than a committed one.
Three console tests presented a refresh token or a revocation with no client
authentication and expected `invalid_grant`; they got `invalid_client` until given
the gateway's assertion. A rotate-secret route that answered
`200` with a secret no `private_key_jwt` client could present now answers `409`,
and the client page says why instead of offering a rotation.

## Performance

### The React Compiler

The compiler is on for all of `apps/admin-console/src` except test files
(`*.test.ts(x)`, which are not shipped), in the build and in the DOM tests: `babel-plugin-react-compiler` 1.0.0, run by
`@rolldown/plugin-babel` 0.2.4 through `@vitejs/plugin-react`'s
`reactCompilerPreset` (`apps/admin-console/reactCompiler.ts`).
`panicThreshold: 'all_errors'` makes a component it cannot compile fail the
build. The ESLint plugin's compiler rules did not see any of the nine files
the compiler refused (try/finally, a default parameter that reads another
value, a hook declared inside a hook, a method read off a hook), so the build
is the check that catches a bail-out, and the lint is the check for the
patterns it does name.

Function-component renders after the page is up, counted from React DOM's
commit hook (`src/app/renderCounts/renderCounts.test.tsx`, which keeps the
numbers as ceilings):

| Journey                                      | Before             | After            |
| -------------------------------------------- | ------------------ | ---------------- |
| Ten characters typed into the Account tab    | 5,752 (12 commits) | 332 (12 commits) |
| One page of the Subjects list                | 494 (11 commits)   | 328 (11 commits) |
| One capability picked in the new-tenant flow | 134 (7 commits)    | 125 (7 commits)  |

A keystroke used to re-render the whole profile form, some 575 components;
it now renders `ProfileTab`, `OwnDataFields` and `Account` and what they
hand a changed value to. Paging renders rows that are new, so most of what
remains is mounting.

Bundle, from `pnpm --filter @odudu/admin-console build`: the entry chunk was
428.60 kB, 137.80 kB gzipped by Vite (136,410 B by `gzip` at its default
level), and is 452.46 kB, 146.62 kB (145,018 B). Entry, zod and the chunks
the entry imports first: 711,034 B raw and 219,445 B gzipped before,
740,173 B and 229,795 B after, a rise of 4.7 per cent gzipped, which is the
compiler's cache code and its runtime. `ENTRY_GZIP_BUDGET` in
`tests/lint/console-phone-chunk.test.ts` is the entry's gzipped size now
plus 5 per cent, rounded up to a whole kB.

The four hand-written `useMemo`s, three in `ClaimFields.tsx` and one in
`PhoneField.tsx`, went: the compiler memoises the same lists on the same
keys. `tests/lint/console-no-manual-memo.test.ts` holds the rest of the
console to none, unless the line above names a measurement.

What the compiler changed that the DOM tests did not show: it keeps
`picker.options.map(...)` as one array between renders, and React Aria caches
a dynamic collection's item rendering by item, so a reason an option cannot be
chosen that arrived after the options (the system administrators' holders,
read second) was never drawn. The browser test for the grant picker failed;
`Picker` now passes `dependencies` for everything its item render reads, and
its test re-renders with the same options and a new reason. The other dynamic
collections (the field select, the filter bar's select, the combo box) read
only their item.

`Timestamp` took a default `now = new Date()`, which the compiler cannot
handle, and caches `now ?? new Date()` once per mount; it now reads a clock
(`useNow`, 30 s) so its relative time keeps moving. First load, entry
and the chunks it imports statically, is budgeted at 242 kB gzipped
(`FIRST_LOAD_GZIP_BUDGET`). Lazy chunks are not budgeted yet and grew more than
the entry did, by the compiler's cache code. Raw / gzip by Vite, before to
after: subjects 421.41 / 120.14 to 502.29 / 150.32 kB; tenants 42.12 / 13.59 to
65.78 / 22.79; groups 30.25 / 9.77 to 49.26 / 16.62; roles 26.78 / 9.01 to
44.52 / 15.60; overview 17.13 / 5.81 to 23.95 / 8.47; system-admins
5.53 / 2.57 to 8.83 / 4.02; AuditActor 96.93 / 28.84 to 99.49 / 30.01.
`tests/lint/console-collection-dependencies.test.ts` is a backstop for the
collection-cache case above; it cannot see a value reached through a called
function.

### Server query plans

`apps/server/tests/query-plans.plan.test.ts` (`pnpm test:plans`, the
`query-plans` job in CI, not part of `verify`) runs the server's real code over a
seeded volume and fails on what ADR 0041 forbids: a foreign key without an
index, a collection answered with more than `MAX_LIMIT` rows, a list that
sends more statements for 200 rows than for one, and a statement whose plan
scans a large table or sorts an unbounded input.

**Volume.** One tenant with 200,000 subjects, 10,000 clients, 5,000 roles,
5,000 groups, 980 scopes, 200,000 sessions, 300,000 grants and refresh
tokens, 100,000 each of authorization codes, mail, logout deliveries and
client-assertion ids, and 600,000 audit events, beside 5,000 tenants with
twenty subjects and clients each and 400,000 more audit events: about 3.5
million rows (more once the roles, groups, scopes and console rows are counted), a fifth of the subjects, the design count of clients and a
hundredth of the audit events (1,000,000 in all). The planner already prefers an index wherever
one fits and a sequential scan wherever none does at that size, so a plan
wrong there is wrong at the design volume. It is written in SQL
(`apps/server/src/testing/plan-volume.ts`), with foreign keys and triggers
off for the load, then vacuumed and analyzed. Loading takes 76 s and the whole test 176 s on a development machine at a load average near 30, so a CI run should expect more than a minute for it.

**What runs.** 172 paths run, 171 of them sending statements: discovery, JWKS, authorize (with and without
a session), login, consent, the token endpoint for every grant, userinfo,
introspection, revocation, end-session, CORS preflights, registration,
verification, reset, required actions, dynamic client registration, 57 admin
lists, 20 admin reads, 22 admin writes, the mail and logout senders, every
retention rule, the console gateway and the credential repository. Each
statement is captured as the code sends it, under the connection's tenant
setting, and replayed as `EXPLAIN (ANALYZE)` in a transaction that is rolled
back (a statement that writes is explained without running, on estimates).

**The rules.** A scan of a table over 5,000 rows is a finding when it reads
more than 2,000 rows (ten pages), when it is a sequential scan not stopped
inside that by a `LIMIT`, or when it sits under a `LIMIT` and still reads more
than a count's own cap plus a page. A sort of more than 2,000 rows is a
finding. A whole-tenant export and the retention deletes are exempt from the
read-size rules: the first is bounded by the caps below and the second reads
what it deletes. Rows read are counted from the executed plan, not estimated:
the first runs flagged 188 to 221 findings from the planner's estimates alone,
nearly all of them its misjudgement of a recursive query, and were replaced
by what the plan actually read.

**Plan before and after `ANALYZE`.** The subjects list searching
`?username=user1` (`0073`'s `users_username_search`), with the statistics of
`users` and `subjects` deleted and their row estimates reset, then with the
statistics `ANALYZE` wrote. The plan does not change: both read 201 rows
through the index, and the first plans and runs slower only because the
planner is working from no statistics (the transaction was rolled back, so the
deleted statistics were not lost):

```
 Limit (actual rows=201 loops=1)
   ->  Nested Loop (actual rows=201 loops=1)
         ->  Index Scan using users_username_search on users (actual rows=201 loops=1)
               Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_search >= 'user1'::text) AND (username_search < 'user2'::text))
         ->  Index Scan using subjects_pkey on subjects (actual rows=1 loops=201)
               Index Cond: (id = users.subject_id)
               Filter: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
 Planning Time: 6.461 ms
 Execution Time: 3.102 ms
```

```
 Limit (actual rows=201 loops=1)
   ->  Nested Loop (actual rows=201 loops=1)
         ->  Index Scan using users_username_search on users (actual rows=201 loops=1)
               Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (username_search >= 'user1'::text) AND (username_search < 'user2'::text))
         ->  Index Scan using subjects_pkey on subjects (actual rows=1 loops=201)
               Index Cond: (id = users.subject_id)
               Filter: (tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)
 Planning Time: 4.128 ms
 Execution Time: 0.687 ms
```

Migrations `0073` to `0076` added a search column and an index for each of
subjects, tenants, clients, roles, groups, scopes and keys. Every search path
reaches its index and stops at the page. Subjects and tenants read it in
order (201 rows for a page of 200). Clients, roles, groups and scopes read the
page's keys from the index alone, an index-only scan that stops at the limit,
then the rows by id: with one statement the planner chose a bitmap of every
match (1,112 rows for a prefix matching 11% of 10,000 clients) whenever it priced
that under an ordered scan, which it does for a prefix near five pages of matches.
The check holds a searched list to two pages of reads on its own table.

**Defects found, and fixed in the increment that found them.**

- _The effective-roles walk read every role of the tenant_ on 96 paths,
  because the planner hashed `roles` against its scan: authorize, every token
  grant, userinfo, introspection and each admin read that evaluates
  capabilities. Each hop of the closure is now a lateral lookup the planner
  cannot hash (`closureOf` in `effective-roles.ts`), and the same in
  `descendantsOf`, `ancestorsOf`, `closureFrom`, `rolesReachableFrom` and the
  holder queries of `capability-ceiling.ts`.
- _A CORS preflight read every client's origins in the tenant._ The union is
  now `client_origins`, one row per origin, written by the repository with the
  request side's own normaliser (migration `0096`), so the preflight is one
  probe. The existing rows are backfilled in SQL only where the value is
  already in the parser's form; an IDN, zero-padded port, numeric-shorthand
  or IPv6 host gets no row until its client is amended, so it fails closed until
  `odudu client-origins rebuild` rewrites it. A
  hand-written `UPDATE` of the lists empties the client's rows.
- _Twenty-two foreign keys had no index_, and about twenty lookups (a subject's
  credentials, sessions, grants and action tokens, a client's grants, default
  roles and groups, locked subjects, the disabled rows of clients and tenants,
  every audit filter) had none either: migration `0095`.
- _Six collections answered unbounded_: a subject's consents, its effective
  roles, a role's composites, and the roles of a group, a scope and a
  subject. The first two are now paged; the rest are whole sets with a write
  cap of 200 (`ASSIGNMENT_LIMIT`) enforced on every route that writes them,
  and a tenant defines at most 1,000 scopes (`SCOPE_LIMIT`).
- _Unbounded counts and bulk writes:_ the tenant-sessions `remaining`, the
  lockouts clear, a client's grants revoke and the tenant-delete preflight
  counted or wrote without a ceiling; each is now capped (10,000, with
  `remaining` reported where the call is repeatable).
- _The tenant export read the whole tenant:_ refused above 20,000 clients,
  roles or groups or 200,000 link rows, with `413`.
- _Tenant enumeration read every tenant id into memory_ in the mail, logout
  and retention passes; they page the ids (`tenantIdPages`, 500 at a time).
- _Retention rules scanned_ because their cutoff depended on a joined tenant
  row; each now binds a cutoff the index ranges on and applies the exact
  window to the rows it finds.
- _Authorize and discovery read every scope_ and then one by one; they ask for
  the scopes the request names.
- _The registration capacity count, the last-administrator guard and the
  capability-holder merge_ read or sorted the tenant's subjects.
- _The clients list walked the primary key across every tenant_ (2,265 rows
  for a page of 200) because the planner estimates a policy's `current_setting`
  as an average tenant. The list now names the tenant, so the tenant's own
  statistics choose `(tenant_id, id)`. _A scope's clients read every client of
  the tenant_ when the planner hashed them; the page is now ordered by the
  assignment index `(client_scope_id, client_id)` and probes `clients` by key.
  Both were intermittent: the plan changed with the sample `ANALYZE` took, and
  the check failed on some runs and not others before they were fixed, and has
  passed three of three since; a plan can still flip, and the failure then
  names it.
- _JIT compiled the closure queries_: a recursive closure is costed above
  `jit_above_cost` (100,000) whatever it reads, so on a Postgres built with JIT
  the holders query compiled 416 functions and took 1.2 s to return seventeen
  ids; the end-to-end browser tests timed out on it. Every connection now opens
  with `jit = off` (`createDatabase`). The check cannot see it: the test image
  has no JIT, so it reads plans, not compile time.
- _`= ANY(ARRAY(...))`_, not a hashed subquery, wherever a set of subject ids
  filters a large table: the holders beyond a caller's ceiling hashed against
  a scan of every grant and session.

**The console's half.** The consents and effective-roles tabs follow `next`
(the adapters take the cursor, `useResourceList` keeps the pages, the view
says "Load more"). Nothing that decides on a subject's reach reads them: it
reads `GET /subjects/:id/admin-capabilities`, the admin capabilities held and
the roles that carry them, whole or refused (`complete`); that covers a
subject's reach on its record and in the capability editor, the group-removal
confirmation, and what a write would take from the signed-in administrator.

**What was accepted, and why it is not in the list.** A count's `LIMIT` is a
bound the planner may read up to: a capped count reads at most its cap, which
is why the rule above allows a scan under a `LIMIT` that much. A capped count
no longer orders by the list's key, because ordering by a column the filter
does not lead with made the planner walk the whole index to find a rare
client's few rows.

**What this does not cover, for P11.** Replicas, load and partitioning:
`audit_events` takes four more indexes here, each a write on every event, and
at 100,000,000 events it needs partitioning by month with retention by
dropping partitions, which no migration of this increment does. The retention
deletes are one statement per tenant per table, unbatched by row count; at
the design volume a batch size is P11's. Both are named in P11's row of the
design spec.
