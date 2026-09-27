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

`audit_events_resource` (`packages/db/drizzle/0067_admin_audit.sql`) orders
on `(tenant_id, resource_type, resource_id)`, not on `(occurred_at, id)` the
listing itself orders by, so this is not the sort-free shape the six
search columns above get: the index bounds the read to one resource, and a
small `Sort` orders what is left. `list-plans.int.test.ts` seeds one audit
row per client (30,000 per tenant) and holds the case to what that scan
looks like — an `Index Scan` on `audit_events_resource`, no `Seq Scan` —
rather than to a no-sort shape that is not there.

verified: `cd packages/protocol-admin && LIST_PLANS_OUT=<file> pnpm vitest run --config ../../vitest.config.ts tests/list-plans.int.test.ts -t "resource index"`
(1 passed in 24.2 s against `postgres:17-alpine`). The first (and only)
page of `?resource_type=client&resource_id=<id>`, one row bounded entirely
by the index condition:

```
Limit  (cost=8.46..8.46 rows=1 width=238) (actual time=0.025..0.025 rows=1 loops=1)
  Buffers: shared hit=4
  ->  Sort  (cost=8.46..8.46 rows=1 width=238) (actual time=0.024..0.024 rows=1 loops=1)
        Sort Key: occurred_at DESC, id DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=4
        ->  Index Scan using audit_events_resource on audit_events  (cost=0.43..8.45 rows=1 width=238) (actual time=0.018..0.018 rows=1 loops=1)
              Index Cond: ((tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid) AND (resource_type = 'client'::text) AND (resource_id = '0000079a-6ea2-4929-951c-012d655b282f'::text))
              Buffers: shared hit=4
Planning Time: 0.049 ms
Execution Time: 0.040 ms
```

Acceptable for a per-resource trail: a resource's own rows are few enough
that sorting them in memory costs nothing next to the index read that found
them, and no tenant writes enough rows against one resource to change that.
