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

**Next increment:** Task 8.

**Verify:** `pnpm verify` exits zero, but now requires a running Docker
daemon — the `integration` Vitest project starts a real PostgreSQL
container.

**Blocked on:** nothing.
