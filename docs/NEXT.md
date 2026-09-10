# Next

**Position:** P0 complete. All exit criteria met:

- `pnpm verify` green locally and in CI (format, typecheck, lint,
  boundaries, unit, integration)
- the server boots in a container and reports ready; CI proves it on every
  push
- the migration runner is proven, including idempotency
- ADRs 0001–0012 committed
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

Wiring `odudu_svc` into RLS needed one thing the brief's literal SQL did
not have: `infra/docker/initdb/01-app-role.sql` creates the role via
Postgres's `docker-entrypoint-initdb.d`, which runs once, before the
`odudu` container ever starts — i.e. before migration 0001 has created the
`odudu_app` role that `odudu_svc` needs to inherit from. Granting that
membership from `initdb` is impossible (the role it would grant doesn't
exist yet); granting it unconditionally from a migration breaks the
integration tests, which create `odudu_svc` the other way around (`@odudu/
testkit`'s `createAppRole` runs after migrations). `packages/db/drizzle/
0002_grant_service_role.sql` resolves this with a guarded `DO` block —
`GRANT odudu_app TO odudu_svc` only `IF EXISTS` — so it grants immediately
in compose and no-ops harmlessly in tests, where `createAppRole` does the
grant explicitly once the role exists.

The host-side `postgres` port in `compose.yaml` was moved from `5432` to
`5442` (the container still listens on 5432) because this machine already
has a native PostgreSQL bound to host port 5432; changing the host mapping
rather than the in-container port keeps every service in the file
addressing postgres by its default port.

`infra/docker/smoke.sh` brings the stack up, polls `/health/ready` for up
to 120s, and tears the stack down on exit either way; it is now also the
`container` job in `.github/workflows/verify.yml`, run on every push
alongside the existing `verify` job.

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

**Verify:** `pnpm verify` exits zero; `./infra/docker/smoke.sh` exits zero.

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
  database directly from the host needs to use that port.
