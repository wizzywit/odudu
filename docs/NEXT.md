# Next

**Position:** P0.6 complete. `@odudu/db` aggregates per-domain Drizzle
schema slices into one ordered migration timeline — `realms` is the first
slice — with a `postgres.js`-backed client and a `runMigrations(db, folder)`
runner that takes its folder as a parameter so Task 9's bundling doesn't
break `import.meta.url` resolution. `@odudu/testkit` provides
`startTestDatabase()`, a Testcontainers-backed real PostgreSQL 17 instance
for integration tests.

**Next increment:** Task 7.

**Verify:** `pnpm verify` exits zero, but now requires a running Docker
daemon — the `integration` Vitest project starts a real PostgreSQL
container.

**Blocked on:** nothing.
