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

**Found while verifying Task 8:** plain `node apps/server/src/main.ts`
cannot actually resolve the codebase's own `#/*.js` subpath imports back to
their `.ts` files — Node's native type-stripping strips syntax but does no
`.js`-to-`.ts` extension mapping, contradicting ADR 0013's claim that the
same specifier resolves identically under `node`, Vitest, and a bundle.
Vitest's resolver (esbuild-based) masks this, so it went uncaught through
Tasks 4–7. The real end-to-end boot in this task's verification (migrations
ran, `/health/ready` returned `{"status":"ok","checks":{"database":"ok"}}`
against a live container, graceful shutdown observed) only succeeded using
a throwaway Node loader hook outside the repo; no repository file relies on
it. ADR 0013 needs a correction or Task 9's `tsup` build needs to be treated
as required for any real `node` execution, not just production packaging.

**Next increment:** Task 9.

**Verify:** `pnpm verify` exits zero, but now requires a running Docker
daemon — the `integration` Vitest project starts a real PostgreSQL
container.

**Blocked on:** nothing, but see the ADR 0013 discrepancy noted above.
