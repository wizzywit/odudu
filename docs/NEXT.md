# Next

**Position:** P0.7 complete. `realms` is force-RLS protected: the app
connects as the non-superuser `odudu_svc` role (member of `odudu_app`),
and `withRealm(db, realmId, fn)` binds `app.realm_id` for the transaction
via `set_config(..., true)` — the bindable form of `SET LOCAL`. An unset
or reverted realm setting fails closed to zero rows, not every row; this
required guarding the RLS predicate with `nullif(..., '')` because Postgres
resets a touched custom GUC to `''`, not `NULL`, once a connection has used
it — verified against a live container, not assumed from docs.
`@odudu/testkit` adds `createAppRole(adminUrl)` to provision that role for
tests. `@odudu/kernel` adds the optional `ODUDU_APP_DATABASE_URL` for the
restricted runtime connection (owner `ODUDU_DATABASE_URL` is still used for
migrations).

**Task 7 hardening fixes:** `withRealm`'s callback now receives a branded
`RealmScopedDatabase` (`Omit<Database, 'transaction'>`, exported from
`@odudu/db`) instead of the full `Database`, so a nested `withRealm` call —
which would silently rebind `app.realm_id` for the rest of the outer
transaction once its savepoint released — fails to compile instead of
misbehaving at runtime. `packages/db/src/rls-policy.int.test.ts` asserts
every table in `public` has `relrowsecurity`, `relforcerowsecurity`, and at
least one `pg_policies` row, so a future table that forgets its policy fails
CI instead of leaking silently. The default-privileges grant is now
`FOR ROLE CURRENT_USER`, made explicit rather than implicit. Two more
regression tests close review gaps: a fresh, never-touched-GUC connection
returning zero rows, and two sequential `withRealm` calls on one pooled
connection each seeing only their own realm.

**Position:** P0.8 complete. `apps/server` is the single deployable: it
composes itself from `ModuleRegistry` entries rather than wiring things
inline — a `database` module that runs migrations and a `http` module that
depends on it, so the socket never opens against a half-migrated schema.
`/health/live` never touches the database, so a database outage can't take
down an otherwise-healthy process; `/health/ready` does, and reports 503 on
failure. pino redacts `authorization` and `cookie` headers, with a request
serializer that actually includes headers (Fastify's default one omits them
entirely, which would make the redaction decorative). `main.ts` warns on
every boot when `ODUDU_APP_DATABASE_URL` is unset, since serving as the
owner role then bypasses row-level security.

**Task 8 review fix:** the repo-wide subpath-imports mapping was corrected
to `"#/*.js": "./src/*.ts"` in all four `package.json` files (`kernel`,
`db`, `testkit`, `server`), matching ADR 0013's Correction section. The
previous mapping (`"#/*": "./src/*"`) resolved under Vitest (whose esbuild
resolver rewrites the extension) but not under plain Node, which throws
`ERR_MODULE_NOT_FOUND` because it strips TypeScript syntax without ever
mapping `.js` specifiers back to `.ts` files on disk. The brief's literal
step-12 command, `node apps/server/src/main.ts`, now boots against a real
PostgreSQL container with no loader hook of any kind: migrations run,
`/health/ready` returns `{"status":"ok","checks":{"database":"ok"}}`, and
SIGTERM shuts the process down gracefully (verified socket-closed, not
process-killed). `pnpm --filter @odudu/server dev` also starts cleanly.
Specifiers in source (`#/app.js`, etc.) were unchanged — only the mapping
moved.

Also closed from the same review: readiness/liveness fakes now prove
independence instead of merely tolerating it (the down-fake throws
synchronously and the live test asserts zero database calls); the silent
log level from `health.test.ts`'s config is actually passed into
`createLogger` instead of being shadowed by a second, defaulted
`loadConfig()` call; redaction is now also tested end-to-end through
`buildApp`/`inject()`, exercising Fastify's real `prevLogger.child()`
serializer merge rather than only the standalone `createLogger` instance;
the `res.headers["set-cookie"]` redact path got an actual `res` serializer
so it's no longer decorative; `health.ts` logs readiness failures via
`request.log` so the correlation id is attached; `httpModule`'s `dependsOn`
and `databaseModule`'s close-once-when-shared behavior are now covered by
`apps/server/src/modules/*.test.ts`; and the unused `pino-pretty`
dependency was removed.

**Next increment:** Task 9.

**Verify:** `pnpm verify` exits zero, but now requires a running Docker
daemon — the `integration` Vitest project starts a real PostgreSQL
container.

**Blocked on:** nothing.
