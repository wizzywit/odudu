# P0 decision log

Decisions taken during P0's execution that are not evident from the code or
the commit history. Written as they were made, in order, each with what it
would cost if it turned out wrong.

Most were routine. Six are worth singling out, because they were defects in
the **plan** rather than in anyone's implementation, and each was caught by
running something rather than by reading it:

- `no-protocol-to-protocol` used a `\1` back-reference across two patterns
  that dependency-cruiser compiles independently. The rule matched nothing on
  repo-relative paths — dead enforcement of a package-graph invariant, with no
  protocol package yet existing to expose it. (#8)
- The RLS policy predicate cast `current_setting(...)` straight to `uuid`.
  Once a connection has touched that GUC the value reverts to `''`, not
  `NULL`, so the policy would have raised `22P02` instead of filtering to zero
  rows. (Task 7, ADR 0009 Correction)
- The `#/` subpath mapping could not resolve under Node's native type
  stripping. Every test passed for eight tasks because Vitest's resolver
  rewrites the extension and Node does not. (#20)
- The ESLint relative-import rule's glob missed bare `.` and `..`. (#13)
- The `ODUDU_LOG_LEVEL` enum omitted a value a later task's test supplied,
  so a cast would have type-checked while `loadConfig` threw. (#1)
- **The default configuration served as the RLS-bypassing owner role**, and
  `.env.example` never mentioned the variable that would prevent it — so the
  documented local setup was the insecure one. Nine task reviews missed this;
  only the whole-branch review saw it. (#28)

The pattern they share: a claim about how a library, database or resolver
_behaves_, asserted from documentation and written into the plan as fact. The
mitigation adopted for P1 is in `docs/NEXT.md`.

---

## 1

Add `'silent'` to the `ODUDU_LOG_LEVEL` enum in Task 4, and drop the
`as never` cast from Task 8's health test — pino supports `silent`, the Zod
enum did not, so the cast would have type-checked while `loadConfig` threw at
runtime. Cost if wrong: one extra enum member that pino already honours.

## 2

In Task 6's Vitest unit project, `exclude` must be
`['**/node_modules/**', '**/dist/**', '**/*.int.test.ts']`. Specifying
`exclude` replaces Vitest's defaults rather than extending them, so the plan's
single-entry array would have started scanning `node_modules`. Cost if wrong:
slower discovery, or nothing.

## 3

Task 3's Files block says it excludes the fixture tree from Vitest;
its steps widen `include` instead. The steps govern — fixtures are named
`.ts`, not `.test.ts`, so Vitest never collects them and no exclusion is
needed. Cost if wrong: none.

## 4

Task 3 puts `tests/boundaries/boundaries.test.ts` outside every
package tsconfig, which ESLint's `projectService` may reject. The implementer
may either add a tsconfig covering `tests/` or add a non-type-checked ESLint
override for `tests/**`; prefer the tsconfig so the file keeps its type
checking. Cost if wrong: a lint-configuration detour, no production impact.

## 5

Tasks 6 and 7 modify `packages/kernel/src/config.test.ts` without
listing it in their Files blocks. The steps govern. Cost if wrong: none.

## 6

Task 6's `migrate.int.test.ts` has an intra-file order dependency —
the duplicate-name test relies on the previous test's insert. Vitest runs
tests within a file sequentially, so it holds; accepted as written rather
than restructured. Cost if wrong: a confusing failure whose fix is a local
insert in the third test.

## 7

Task 2's workflow triggers on `push: branches: [main]` plus
`pull_request`. Work happens on the `p0-foundation` branch with no PR open, so
neither trigger would fire and the task's own `gh run watch` gate would hang on
nothing. Changed to trigger on `push` with no branch filter, and dropped the
`pull_request` trigger — in a solo private repo every PR head is a branch in
the same repo, so keeping both would run every check twice against different
concurrency groups. Cost if wrong: pull requests from forks would go ungated;
re-adding the `pull_request` trigger is a one-line change if outside
contributors ever appear.

## 8

the Important finding is a defect in MY plan, not the implementer's
work. `no-protocol-to-protocol` was written with a `\1` back-reference across
`from`/`to` patterns, but dependency-cruiser compiles those as independent
regexes and its cross-pattern group syntax is `$N`. Group 1 is `(^|/)`, so the
correct placeholder is `$2`. On repo-relative paths the rule currently never
fires at all — dead enforcement of one of the two package-graph invariants the
task exists to provide, and no protocol package exists yet to expose it. Enters
the fix loop. Cost if wrong: none; the reviewer executed both patterns against
concrete paths and dependency-cruiser's own source.

## 9

pulling Minor 2 (regex form) into the fix round even though Minors
normally stay out. The reviewer supplied a verified order-preserving
alternative, `/src/(?:view|.*/view)/`, that passes dependency-cruiser's
safe-regex check and reproduces the brief's match set exactly, where the
shipped lookahead form over-matches a `view/` directory above `src/`. It lands
on the same lines as the Important fix and leaving it would strand a six-line
comment justifying a form we no longer use. Cost if wrong: a slightly different
regex idiom, no behavioural risk.

## 10

pulling in the negative-control assertion from Minor 3 — a legal
`view` → `service` import asserting zero violations. We are rewriting the
layer regexes in this very round, and no current test can detect an over-broad
rule; a regex matching everything would pass both existing tests. Cost if
wrong: one extra fixture and assertion.

## 11

pulling in Minor 5 — `tests/tsconfig.json` sits outside
`turbo run typecheck`, so plain compiler diagnostics under `tests/` go
unnoticed. One line closes a hole in the `pnpm verify` gate. Cost if wrong:
marginally slower typecheck.

## 12

enforce "no relative imports" with ESLint, not dependency-cruiser.
A dependency-cruiser rule would fire on `tests/boundaries/fixtures`, whose
files import relatively on purpose — including the new negative-control
fixture, whose whole assertion is that it produces zero violations. Scoping
around that would need a second parallel fixture tree and a `pathNot`
exclusion. ESLint already lints exactly `packages/*/src` and `apps/*/src` and
already ignores the fixtures tree, so the rule lands where it belongs with no
entanglement. Cost if wrong: the rule runs at lint time rather than in the
boundaries gate; both are stages of `pnpm verify`, so the gate is equally
binding.

## 13

the Important finding is another defect in my own brief. The mandated
`group: ['./*', '../*']` catches `./x.js`, `./sub/x.js`, `../x.js`,
`../../x.js` — the reviewer loaded ESLint's actual matcher and confirmed deeper
traversal is covered — but a bare `.` or `..` specifier, which Node and
TypeScript both resolve to a directory index, matches neither pattern. That is
a real hole in the one thing the rule exists to close, and nothing tests it.
Enters the fix loop. Cost if wrong: none; the reviewer verified empirically
against ESLint's own matcher rather than reasoning from the docs.

## 14

pulling the Minor in with it. We are changing the pattern form, and a
regex anchored for relative specifiers could over-match bare package names
(`zod`, `node:url`, `@odudu/kernel`). An assertion that those stay allowed is
the same guard `good-view.ts` provides for the boundary rules, and it is the
natural test to write while touching this rule. Cost if wrong: one extra
assertion.

## 15

the Important finding stands and enters the loop. The stop-continues-
past-throw test was changed from the brief's `stop: async () => { throw ... }`
to a synchronous throw. Assertions survived, but the stimulus narrowed: every
real module (pool drain, server close) rejects a promise rather than throwing
synchronously, and no test now covers that path. Dropping the `await` at
registry.ts:43 would still pass this test while turning a production
rejection into an unhandled one and a silently-successful `stop()` — exactly
the failure the task exists to prevent. The implementer attributed the change
to `require-await`, but `() => Promise.reject(...)` satisfies that rule while
preserving the specified path, so the lint did not force it. Cost if wrong:
none; the reviewer verified the registry catches both paths, so this is about
test coverage, not a live bug.

## 16

pulling in two Minors that are the other half of the same requirement.
The stop test asserts only `toThrow(OduduError)` — not that `code` is
`module_stop_failed`, nor that `cause` is an `AggregateError` carrying both
failures — so "reports the aggregate" is currently asserted as "some error".
And the cycle trail prints the full DFS path from the iteration root, so
`x -> a -> b -> a` names a node not in the cycle; the message is an operator's
only clue on a fail-loudly path. Both cheap, both on lines the fix already
touches. Cost if wrong: marginally more assertion code.

## 17

four of Task 6's six Minors are one-liners that will cost more later
than now, so rather than open a fix round on an approved task I am carrying
them into Task 7's dispatch, which legitimately edits every file involved:

- `afterAll` calls `handle.close()` unguarded; if the container fails to
  start, this throws a TypeError that buries the real cause. On a bursty
  schedule "Docker wasn't running" is the likeliest first failure, so this
  matters more than its size.
- the duplicate-name test uses bare `rejects.toThrow()`, which accepts any
  error — asserting Postgres code 23505 or the constraint name rules out an
  unrelated failure passing as success.
- `ODUDU_MIGRATIONS_DIR` is asserted with `toBeUndefined()`, which passes
  whether the key is absent or present-with-undefined — exactly the
  distinction exactOptionalPropertyTypes exists for. The reviewer probed the
  real behaviour and it is absence; the test should say so.
- `allowDefaultProject` gained `packages/*/*.config.ts` but not
  `apps/*/*.config.ts`, a predictable Task 9 failure when the server ships
  tsup.config.ts. Free to fix now.
  Cost if wrong: Task 7's diff is slightly wider than its brief.

## 18

all four Importants enter the loop, plus two Minors that are really
coverage holes in a security predicate.

- Nested `withRealm` rebinds the realm for the remainder of the OUTER
  transaction. set_config(..., true) is transaction-scoped, not
  savepoint-scoped, so a successful inner block leaves app.realm_id = B
  while the outer author believes they are bound to A. That is precisely
  the cross-realm read this task exists to prevent, arriving through the
  helper rather than around it. Fixing structurally with a branded callback
  type, per ADR 0009's own "omitting it fails to compile" standard.
- The callback handle is typed as an unscoped, unexpiring `Database`, so it
  can be returned and used after commit. Same fix.
- ALTER DEFAULT PRIVILEGES automates the GRANT half for future tables but
  ENABLE/FORCE/policy stays manual per table, so a later migration that
  forgets a policy yields a fully-readable table with no test to notice.
  The reviewer's proposed guard — assert every public table has
  relrowsecurity AND relforcerowsecurity and at least one pg_policies row —
  is one query and protects every future phase. Highest long-term value in
  this round.
- ALTER DEFAULT PRIVILEGES has no FOR ROLE, so it covers only the role that
  ran the migration. Fails loud, not open, but cheap to pin down.
- Minor pulled in: the never-touched-GUC branch is untested, because test 2
  runs after test 1 on a max:1 pool so the GUC is already in the '' state.
  Flipping current_setting's missing_ok to false would leave the suite green
  while making a fresh connection error instead of returning zero rows.
  That is an untested branch of a security predicate.
- Minor pulled in: five eslint-disable-next-line no-unnecessary-condition
  suppressions instead of declaring the bindings `| undefined` honestly.
  Cost if wrong: a wider Task 7 diff and a branded type other repositories must
  adopt — which is the intended constraint, not a side effect.

## 19

carrying one Minor into Task 8's dispatch — the RLS coverage assertion
filters `relkind = 'r'`, so a future partitioned table (`relkind = 'p'`) is
silently skipped by the very guard that exists to catch "someone forgot a
policy". One character, and the hole would leave no trace. Cost if wrong:
Task 8's diff touches one line in a db test file.

## 20

the #/* mapping was wrong repo-wide and is a defect in MY ADR 0013.
`"#/*": "./src/*"` cannot work under Node's native type stripping — #/clock.js
resolves to src/clock.js and the file is clock.ts; Node does not rewrite the
extension, Vitest's resolver does. Every test passed for eight tasks because
nothing had run plain `node` until now. I verified in an isolated probe that
`"#/*.js": "./src/*.ts"` resolves under BOTH Node 24 type stripping and tsc
with nodenext, and reproduced the failure in this repo first. Plan, spec and
ADR 0013 corrected in the commit correcting the mapping in the plan, spec and ADR 0013 with an honest note that the resolution claim
was asserted from documentation rather than executed. The code change enters
the fix loop. Cost if wrong: none; both halves were run before deciding.

## 21

Important 1 also enters the loop — redaction is only tested on the bare
pino instance, never through the path fastify actually logs on. The reviewer
read fastify 5.12.3's logger-pino source and confirmed the user instance's
serializers currently win the merge, so it works today, but nothing pins it: a
fastify minor bump reversing that merge order would leave every test green
while bearer tokens stopped being redacted. That is the incident the config
exists to prevent.

## 22

pulling in six Minors, all cheap and all closing gaps between "looks
protective" and "is protective":

- health.test.ts sets ODUDU_LOG_LEVEL 'silent' but builds the app logger from
  a fresh loadConfig that defaults to info, so the setting is dead and the
  503 test prints a real JSON log line on every suite run. Pristine test
  output is a stated standard.
- the fake database's `sql` returns a rejected promise rather than throwing,
  so the liveness test cannot distinguish "never touched the database" from
  "touched it and swallowed the error".
- the third redact path, res.headers["set-cookie"], is inert because no `res`
  serializer is supplied — the very trap the brief calls out for `req`.
- nothing asserts httpModule declares dependsOn: ['database'], nor that the
  shared-handle double-close guard works; removal of either would be silent
  because main.ts happens to register database first.
- readiness failures log through app.log rather than request.log, so the one
  line most likely to be correlated with an incident lacks the correlation id.
- pino-pretty is pinned but referenced by nothing.
  Cost if wrong: a wider Task 8 diff.

## 23

carrying one residual into Task 9 — finding 5 added a `res` serializer
so the `res.headers["set-cookie"]` redact path is live, and the re-reviewer
confirmed `getHeaders()` produces the shape the path addresses, but no test
sets a real set-cookie header and proves it gets redacted. Every other
protective claim in this phase has been proven rather than asserted, and
cookie redaction on an identity provider is not the place to stop. One test.
Cost if wrong: Task 9's diff gains a test in apps/server.

## 24

all three Importants enter the loop.

- smoke.sh probes only /health/ready, which runs `select 1` and needs no
  table privilege. So it proves odudu_svc can authenticate and nothing more
  — the report concedes both smoke runs were green before AND after the
  grant migration existed. The most consequential change in the diff has
  zero regression coverage, and the failure it guards is invisible to CI and
  to any orchestrator health check while every real request 500s. Step 8
  must be encoded in the script, not left in a transcript.
- 0002's IF EXISTS guard claims to make "both orders safe", but there is a
  third order and it is the production one: role created after migrations
  with nothing playing testkit's part. Drizzle marks 0002 applied on that
  first run, so no redeploy repairs it, and /health/ready still returns 200
  while every query on realms raises permission denied. Healthy-but-broken
  is worse than loud.
- compose commits fixed credentials, publishes Postgres and the app on all
  host interfaces, and carries nothing marking it development-only — in a
  public repository for a security product. That is the file someone lifts
  into a staging box.

## 25

pulling in three Minors, each one line: .npmrc is not copied into the
build stage so the image build runs pnpm install with engine-strict silently
off; `set -e` inside the EXIT trap can turn a success into a spurious CI
failure; and NEXT.md says "ADRs 0001-0012" while 0013 exists.

## 26

the user asked for extensionless imports (`#/clock`, not `#/clock.js`).
Verified empirically across all four resolvers that matter — node type
stripping, tsc nodenext, esbuild (tsup's engine, including running the bundle),
and nested paths — with the mapping `"#/*": "./src/*.ts"`. It works and is
strictly better: the mapping performs the translation, so the specifier never
names a file that does not exist. Scheduling as its own task (9b) after Task
9's fix round, because it touches all four package.json files plus every
specifier in source and deserves a reviewable diff of its own rather than
being buried in container work. Cost if wrong: one more task; the change is
mechanical and fully covered by pnpm verify plus a native node boot.

## 27

the user chose "co-locate unit tests, separate integration tests"
after seeing the trade-offs. Combining it with the extensionless-imports
change into ONE follow-up task (9b), because both touch import specifiers,
the Vitest config, package tsconfigs and the ESLint relative-import rule —
doing them separately would mean two rounds of identical mechanical churn
over the same files. Cost if wrong: one slightly wider diff instead of two
narrow ones.

## 28

the Critical is a foundation defect nine task reviews all missed, and
it is mine — the plan specified it. main.ts falls back to the owner handle
when ODUDU_APP_DATABASE_URL is unset and only warns; .env.example never
mentions the variable, so the DOCUMENTED local setup is the RLS-bypass mode,
and in compose the owner is a superuser that FORCE ROW LEVEL SECURITY cannot
constrain. Every P1 repository would be written and tested against a handle
whose behaviour differs from production's. Fixing before merge.

## 29

also fixing before merge, per the reviewer's triage — the RLS coverage
assertion ignoring policy predicates, withRealm's missing uuid validation,
trustProxy becoming config-driven before rate limiting and audit depend on
request.ip, the boundaries script's fail-open conditional, the vacuous smoke
assertion (count=0 on an empty table holds whether or not RLS works), the
missing service-is-a-leaf fixture, an explicit minimumReleaseAge, and the CI
pull_request trigger plus a permissions block.

## 30

also pulling in Important 5 (header/URL logging is a two-entry
denylist) even though the reviewer allowed deferring it. It is cheaper now
than after P1 adds /authorize, whose query string carries state,
code_challenge, login_hint and code — and "log everything except two named
headers" on an identity provider's request log is the classic
credential-in-logs shape.

## 31

the reviewer corrected one of my own deferred items — testkit's
`postgres` and db's `@odudu/kernel` are NOT unused; tx.ts imports OduduError
in production code and createAppRole is exported testkit surface. My earlier
ledger entry was wrong. Dropped.

## 32

deferring the reviewer's suggestion to delete migration 0002. It is a
judgment call, the file is honest about its own limits, and deleting a
journalled migration to remove a no-op safety net is not worth the churn
during a fix wave. Revisit at P1.

## 33

fixed both residuals myself rather than opening a second fix wave,
which the process forbids. Both are one-liners — a workflow `if` condition
and a sentence in a plan document — and both are verifiable by CI, which is
green by CI on the commit closing the final review's residuals. Leaving a comment in a public repository that asserts a
protection it does not provide was not an acceptable park. Cost if wrong: a
controller-authored change reviewed only by CI rather than by a fresh
reviewer.

## 34

user chose to keep development credentials committed inline after
seeing three options. Recorded as ADR 0014 rather than left implicit —
including the residual lift-and-run risk, the three controls that make it
acceptable, and explicit revisit conditions — because a public IdM repository
with plaintext passwords will draw this question again and the reasoning
should be findable. Cost if wrong: an ADR to supersede.

## 35

recorded the affected-package CI answer in NEXT.md with trigger
conditions rather than acting on it. Turborepo and pnpm already support
`--filter='...[ref]'`, so no tooling change is needed, but CI runs in ~50s
and `test` is not yet a per-package Turbo task. Noted that caching should
precede filtering, because a wrong dependency graph turns "skipped" into
"untested code merged" — a semantics an identity provider should not adopt
for a speed win it does not need. Cost if wrong: CI stays slower than
necessary for a phase or two.

## 36

the owner rejected the smoke.sh `.env` bootstrap after seeing it,
and they were right — a script that silently materialises .env from the
example defeats the exact property the task bought, since the normal entry
point would then always start with the example's values. Replaced with a
fail-closed check plus an explicit named CI step, so the deliberate act is
recorded in the pipeline rather than hidden in a script. Cost if wrong: one
manual `cp` on first run, now documented in the README.

## 37

the owner also caught that drizzle.config.ts defaulted to
localhost:5432 — their machine's real Postgres — where compose publishes 5442. Latent because db:generate never connects, but `drizzle-kit push`
would have modified their actual database. First fixed by throwing, which
broke offline codegen on a fresh clone; settled on the 5442 fallback, which
is safe precisely because that port is the throwaway stack. Cost if wrong:
a connecting drizzle-kit command with the variable unset talks to the dev
stack instead of failing.

## 38

parking the final Minor rather than reopening a loop — ADR 0015's
Decision prose was style-trimmed in place instead of being left untouched
with the change noted in its dated Amendment, which is a literal deviation
from the immutability rule the repo documents for itself. Meaning unchanged;
re-editing to un-edit is churn. Recorded here so the deviation is not
silent. Cost if wrong: the ADR's own convention is slightly less strictly
observed than it claims.

## 39

documented both run paths in the README after verifying each one for
real, and fixed a defect the verification surfaced — .env.example defaulted
ODUDU_HTTP_HOST to 0.0.0.0, so a host-run dev server published to the LAN,
inconsistent with the trouble taken to loopback-bind compose. 0.0.0.0 is
needed only inside the container, which the image already sets. Nothing in
the repo had said how to start the application at all. Cost if wrong: a dev
who genuinely wants LAN access must set the variable back.

---

## Note on commit references

This log deliberately refers to commits by description rather than by SHA.
The branch's history was rewritten twice before landing — once to strip
tool-attribution trailers from two commits (messages only; the resulting
trees were byte-identical, verified by diffing against the pre-rewrite head),
and again by the rebase that merged it. A SHA quoted here would have gone
stale both times.

A `commit-msg` hook and a CI job now enforce the rule that was violated, so
this should not recur.
