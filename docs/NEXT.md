# Next

## Start here

**P0 is complete and merged. P1 (the OAuth 2.1 / OpenID Connect core) is
underway on `p1-oauth-oidc-core`; task 19 (the conformance harness) is the
most recent increment — see "Task 19" below. The two tasks after it close
the phase: closing the remaining MUST-level clause gaps the conformance
run surfaced, and the phase's final exit-criteria confirmation.**

Before any endpoint code, write the clause tables:
`docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md`, mapping each
MUST and SHOULD to the test that covers it (design spec, section 10). That
table is what makes "P1 is done" countable instead of a feeling, and it is
the same activity as the learning goal.

Then follow the phase sequence in `CLAUDE.md` — brainstorm P1's scope,
write its spec and plan, execute it task by task.

Everything below is the record of P0: what it delivered, what it
deliberately deferred, and the decisions taken with their trigger
conditions.

---

**Task 19: the conformance harness.** `infra/conformance/` stands up the
OpenID Foundation suite (pinned `release-v5.1.36`) against odudu. Both
open spikes are answered and recorded in `infra/conformance/README.md`:
a Config OP plan demands `https://` unconditionally (verified against the
suite's own source and by provoking the failure directly), and Config OP
is fully driveable through the suite's HTTP API with no browser and — in
the dev-mode setup this harness uses — no token either. `compose.yaml`
puts a self-signed-TLS `nginx` proxy in front of the otherwise-unmodified
odudu container (`ODUDU_TLS=true`, `ODUDU_TRUST_PROXY=true`), which is the
trigger condition Task 10's `__Host-` cookie fallback was waiting for.
`.github/workflows/verify.yml`'s new `conformance` job runs Config OP on
every push to `main` and every pull request, mirroring `container`'s
structure.

Running the **Basic OP** plan (35 modules, `results/`) found that 30 fail
for one shared reason: odudu makes PKCE mandatory on every
`authorization_code` request, and the Basic OP profile's tests (bar the
one built to test PKCE, which passes) don't send it. This is reported,
not patched — reversing PKCE-mandatory to chase Basic OP certification
would undo a deliberate OAuth 2.1 alignment decision, and that trade is
not this task's to make. Whether it is ever closed, and how, is for the
next task to decide with the full clause-gap picture in view.

A latent, unrelated bug surfaced while wiring the TLS proxy: odudu's
issuer and endpoint URLs (`packages/protocol-oidc/src/view/routes/
discovery.ts`, `login.ts`) are built from Fastify's `request.hostname`,
which silently drops the port even when `X-Forwarded-Host` supplies one
under `trustProxy` — verified directly against the container. The
conformance proxy sidesteps it by listening on the default HTTPS port
443, but a real deployment on any other port behind a reverse proxy would
advertise the wrong endpoint URLs. Not fixed here; flagged for whoever
picks it up next.

---

**Position:** P0 complete. All exit criteria met:

- `pnpm verify` green locally and in CI (format, typecheck, lint,
  boundaries, unit, integration)
- the server boots in a container and reports ready; CI proves it on every
  push
- the migration runner is proven, including idempotency
- ADRs 0001–0013 committed
- dependency-cruiser enforces both package and layer boundaries, with
  fixtures proving the rules reject violations

**Task 9: container, compose, and the boot proof.** The bundler path was
taken, not the `pnpm deploy` fallback: `apps/server` builds with tsup
(`noExternal: [/.*/]`, ESM, `target: node24`), and the bundle was run for
real against a live PostgreSQL container before it went anywhere near the
Dockerfile — pino's transport machinery, the documented risk, did not
misbehave under the bundle. The multi-stage `infra/docker/Dockerfile` builds
with `pnpm --filter @odudu/server build` and ships only `dist/` plus a
separately-copied `packages/db/drizzle` (bundling destroys the
`import.meta.url`-relative path `MIGRATIONS_DIR` computes, so the directory
is passed explicitly via `ODUDU_MIGRATIONS_DIR`). The runtime stage runs as
a non-root `odudu` user — confirmed inside a running container
(`uid=100(odudu) gid=101(odudu)`), not just read off the Dockerfile.

`infra/docker/compose.yaml` uses two connection strings on purpose:
`ODUDU_DATABASE_URL` (the `odudu` owner) runs migrations; the server itself
serves on `ODUDU_APP_DATABASE_URL` (`odudu_svc`), which is subject to the
`realms_isolation` RLS policy from Task 7. Verified from inside the running
stack, not asserted: `psql -U odudu_svc -d odudu -c 'select count(*) from
realms;'` returns `0` (not a permission error), and `select policyname from
pg_policies where tablename = 'realms'` returns `realms_isolation`. Setting
`ODUDU_APP_DATABASE_URL` also means `main.ts`'s bypass warning never fires
in the compose stack — confirmed absent from the container's logs.

Wiring `odudu_svc` into RLS originally needed a workaround the brief's
literal SQL did not have — see "Review fixes" below for the finished
shape. `infra/docker/initdb/01-app-role.sql` now creates `odudu_app`,
`odudu_svc`, and grants membership between them during Postgres cluster
init, all before the `odudu` container (and therefore any migration) ever
starts. `packages/db/drizzle/0001_row_level_security.sql`'s `CREATE ROLE
odudu_app` is guarded (`IF NOT EXISTS`) so it still creates the role in
the integration-test path, where no `initdb` script runs and
`@odudu/testkit`'s `createAppRole` grants membership explicitly after
migrations, the same as before. `packages/db/drizzle/0002_grant_service_role.sql`
is kept as a harmless guarded no-op backstop rather than deleted (Drizzle
already recorded it applied); its comment is now explicit that it does not
make every ordering safe — see "Review fixes" for the production ordering
it still cannot repair.

The host-side `postgres` port in `compose.yaml` was moved from `5432` to
`5442` (the container still listens on 5432) because this machine already
has a native PostgreSQL bound to host port 5432; changing the host mapping
rather than the in-container port keeps every service in the file
addressing postgres by its default port. Both host-side ports
(`127.0.0.1:5442:5432` and `127.0.0.1:3000:3000`) are now bound to
loopback only — see "Review fixes".

`infra/docker/smoke.sh` brings the stack up, polls `/health/ready` for up
to 120s, then asserts from inside the running stack that `odudu_svc` can
query `realms` and sees `0` rows (not a permission error) and that the
`realms_isolation` policy exists, before tearing the stack down on exit
either way. It is the `container` job in `.github/workflows/verify.yml`,
run on every push alongside the existing `verify` job.

**Review fixes (post-merge hardening of this task).** A scoped review
found three hardening gaps and two smaller issues, all now closed:

1. `smoke.sh` originally only probed `/health/ready`, which runs `select 1`
   and needs no table privilege — it could not tell a working RLS grant
   from a broken one, and both smoke runs during the original
   implementation were green before and after the grant migration existed.
   `smoke.sh` now runs the brief's step 8 as hard, automatic assertions
   (query `realms` as `odudu_svc`, expect `0` not `permission denied`;
   query `pg_policies` for `realms_isolation`) so CI enforces this on every
   push. Verified by breaking the grant deliberately (commenting out both
   the `initdb` grant and the 0002 migration's grant) and confirming
   `smoke.sh` still reports `odudu became ready` but then fails on the new
   check with `permission denied for table realms`, not a readiness
   timeout; restored, and confirmed green again.
2. The grant migration's `IF EXISTS` guard made it a permanent silent
   no-op in a third ordering — `odudu_svc` created by tooling after
   migrations, with nothing playing `createAppRole`'s part — which is
   invisible to `/health/ready` forever after. Fixed by moving role and
   membership provisioning for the compose stack into
   `infra/docker/initdb/01-app-role.sql`, which always runs before
   migrations, rather than depending on a migration to grant membership
   into a role that may not exist yet. `0001`'s `CREATE ROLE odudu_app`
   was made idempotent so it still works standalone in the
   Testcontainers-based integration-test path. `0002` is kept as a
   redundant backstop with an honest comment about what it still cannot
   fix (a real deployment with a third provisioning path).
3. `compose.yaml` committed a plainly-passworded Postgres and app server
   published on `0.0.0.0`, unmarked, in a public repository for a security
   product. Added a header comment stating this file is local-development
   only and the credentials are public knowledge, and bound both publishes
   to `127.0.0.1`.
4. The Dockerfile's build stage did not copy the root `.npmrc`
   (`engine-strict=true`), so the image build silently ran `pnpm install`
   with engine enforcement off. Added `.npmrc` to the `COPY`.
5. `smoke.sh`'s `cleanup` trap ran under `set -e`; a failing
   `docker compose down` could mask a pending success exit code. `cleanup`
   now tolerates its own failure.

**Carried review item, closed:** Task 8 added a `res` serializer so
`res.headers["set-cookie"]` redaction was live but unproven.
`apps/server/src/logger.test.ts` now has a test that sets a real
`set-cookie` header on a reply via `buildApp`/`inject()` and asserts the
cookie value is absent from the captured log while `[redacted]` is present.
Confirmed this test actually exercises the redact path: removing
`'res.headers["set-cookie"]'` from `logger.ts`'s redact paths makes it fail
with the raw cookie value in the log line.

**Next increment:** P1.1 — begin the OAuth 2.1 / OIDC core. Start by
writing `docs/protocols/rfc6749.md` and `docs/protocols/rfc7636.md` with
the clause tables described in spec section 10, before any endpoint code.
The requirement table is what makes "P1 is done" countable.

**Verify:** `pnpm verify` exits zero; `./infra/docker/smoke.sh` exits zero
(one-time setup: `cp infra/docker/.env.example infra/docker/.env` — the
stack deliberately refuses to start without it, see ADR 0015; CI does this
itself as an explicit step in `.github/workflows/verify.yml`'s `container`
job).

**Blocked on:** nothing.

**Known limitations carried into P1:**

- Realm cookies are namespaced rather than host-isolated (spec section 6).
- Only the `realms` table has an RLS policy. Every new tenant table needs
  `ENABLE`/`FORCE ROW LEVEL SECURITY` plus a policy, and a foreign-realm
  probe in the adversarial suite.
- The server bundle inlines all dependencies (tsup, `noExternal: [/.*/]`).
  P2 introduces `@node-rs/argon2`, a native module that must be marked
  external in `tsup.config.ts` regardless of which bundling path is in use
  by then — a native `.node` binary cannot be inlined into an ESM bundle.
- `infra/docker/compose.yaml` publishes postgres on host port `5442`
  instead of the default `5432` to avoid colliding with a native postgres
  on the development host; anyone connecting to the compose stack's
  database directly from the host needs to use that port. Both host
  publishes are bound to `127.0.0.1`, and the file is local-development
  only — its credentials are fixed and public.
- `infra/docker/initdb/01-app-role.sql` is what makes `odudu_svc`'s RLS
  grant reliable in this repository's only deployment surface (compose). A
  real production deployment that provisions `odudu_svc` a different way —
  after migrations, with nothing playing the part of that script or
  `@odudu/testkit`'s `createAppRole` — would still hit the silent,
  permanent no-op described in `packages/db/drizzle/0002_grant_service_role.sql`'s
  comment: Drizzle marks the grant migration applied on the first run
  regardless, and no later redeploy repairs it, while `/health/ready` stays
  green throughout. There is no production deployment target yet to build
  the equivalent safeguard for; whoever adds one needs an explicit,
  idempotent, post-migration provisioning step for this role, not a
  migration.
- `databaseModule` runs `runMigrations` on every boot, from every process,
  with no advisory lock. One replica is fine; the three replicas P11
  promises would all attempt the migration runner concurrently on
  deployment, racing each other. Whoever adds the second replica needs a
  `pg_advisory_lock`-guarded runner (or an out-of-band migration step) before
  scaling `odudu` horizontally.
- The plan for this phase listed `apps/server/src/context.ts` as a file to
  create. It was never created — its job (correlation id generation,
  per-request setup) folded into `app.ts`'s `genReqId` option and its
  `onRequest` hook instead, which turned out to be all that was needed.

## Login page theming, for P2 to decide

The design spec lists `ThemeProvider` among `kernel`'s registries (section 8)
and puts theming in P10, whose exit criterion is that a third-party provider
loads without a rebuild. Nothing is in place yet: the registry does not exist,
and the sign-in and error pages are hardcoded HTML in
`packages/protocol-oidc/src/view/authorize-html.ts` — dependency-free, with
every interpolated value escaped.

Those forty-odd lines are not the risk. The risk is page count: P2 adds an OTP
page and a passkey page, P3 a consent screen, P4 the console. Each one written
the same way, by a different task, leaves P10 retrofitting a theming contract
across six pages that never shared a shape. The spec's promise that
extensibility is "additive rather than a rewrite" is made about modules, and
does not extend to pages on its own.

Defining that contract now, against a single page, would be guessing. **P2 is
where it should be decided**, when three pages exist and the real variation is
visible. Whoever picks it up: the seam is the render function's signature, and
the question is what a theme is allowed to replace — the whole document, a
body fragment, or only styling.

## Deployment gaps, for whoever asks next

`README.md` now has a Deploying section stating plainly that the container
image is the artifact and the compose file is development-only. What it lists
as missing, in the order it would matter: there is no protocol surface to
serve until P1; there is no published image or release process; secrets are
environment variables and nothing more; there is no backup or restore
guidance; and multi-replica deployment is blocked on migration locking and a
shared session cache, both P11.

The fully-local path (your own Postgres, no Docker) needs exactly one
bootstrap statement — `CREATE USER odudu_svc` — because migration 0001
creates `odudu_app` and 0002 grants membership when the serving role already
exists. Verified against a bare PostgreSQL 17 with no init scripts: the
server boots, migrations apply, and the serving role sees zero rows through
row-level security rather than a permission error.

## Recorded decisions with trigger conditions

**Affected-package-only CI.** Turborepo and pnpm both support
`--filter='...[<ref>]'` — changed packages plus their dependents — so no
tooling change is needed to adopt it. Not adopted now: CI runs in about 50
seconds end to end, and `test` is a root-level `vitest run` rather than a
per-package Turbo task, which is a prerequisite. When adopting, prefer
Turborepo **caching** first: an unchanged package replays its cached result
instead of being skipped, which gives the same wall-clock win without the
"we did not run those tests" semantics that a wrong graph turns into an
untested merge. Apply filtering only to genuinely slow jobs, keep typecheck,
lint, boundaries and unit tests always-full, and set `globalDependencies` at
the same time so a root config or lockfile change still forces everything.

- Trigger for caching: CI exceeds roughly 5 minutes (likely P4, when
  Playwright arrives).
- Trigger for filtering: slow suites dominate — P8 SAML interop, P9 policy
  evaluation, or the nightly conformance suite.

**Committed development credentials.** Kept inline deliberately; see
ADR 0014 for the reasoning, the three controls that make it acceptable, and
the conditions under which to revisit.

## Deferred from the final review

- `meta/0002_snapshot.json` records `policies: {}` while `realms_isolation`
  exists in every migrated database. Declaring `pgPolicy(...)` on the table
  would make `drizzle-kit generate` emit a `CREATE POLICY` that fails with
  42710 on existing databases. Record the policy in the snapshot, or leave a
  comment in `realms.ts`, before touching policies declaratively.
- `ODUDU_TRUST_PROXY=` (a bare key) now refuses boot rather than defaulting
  off — correct by strictness, but a new way for a previously-booting
  environment to fail.
- The boundary suite's negative control filters a fixture with no imports at
  all, so it cannot demonstrate that `service-is-a-leaf` is not over-broad.
  A service importing another service would.
- The `res` serializer still emits all reply headers with only `set-cookie`
  denylisted — the remaining instance of the pattern removed on the request
  side.
