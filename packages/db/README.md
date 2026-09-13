# @odudu/db

The connection pool, the realm-scoped transaction helper (`withRealm`), the
migration runner, and the `realms` table.

## SQL is the source of truth for the schema

Every schema change is a hand-written file in `drizzle/`, registered in
`drizzle/meta/_journal.json`, applied by `runMigrations`. The `pgTable`
declarations are a typed view of what those files produced — they are not
what produces it, and nothing generates them.

This is not the arrangement drizzle-kit assumes, so three things follow.

**There is no `db:generate`.** It was a script that reported "1 tables /
realms / No schema changes, nothing to migrate" for a repository with
twelve tables: `drizzle.config.ts` pointed at `src/schema/index.ts`, which
re-exports `realms` and nothing else, because the other eleven tables are
declared in the packages that own them and importing those here would
invert the dependency (`@odudu/db` sits underneath all of them). A
generator that is blind to eleven of twelve tables does not detect drift;
it conceals it. Pointing it at every table instead would mean reconciling
its generated SQL with fifteen hand-written migrations whose RLS policies,
CHECK constraints and guarded DO blocks it cannot express — and declaring
the policies so that it could is the thing that fails 42710 against every
database that already carries them (see the comment in
`src/schema/realms.ts`). The script and its config file are gone.

**`drizzle/meta/` is not maintained.** Snapshots exist for two of fifteen
journalled migrations. `runMigrations` reads `_journal.json` and the `.sql`
files; nothing reads the snapshots. Do not treat a missing snapshot as a
missing migration.

**Drift is caught by a test, not by a generator.**
`tests/schema-drift.int.test.ts` runs the migrations into a throwaway
PostgreSQL, discovers every `pgTable` on disk under `packages/*/src/schema/`,
and compares the two: the set of tables, and for each column its name, SQL
type, nullability and whether it has a default. It also holds a verbatim
inventory of every CHECK constraint in the migrated database, because those
exist only in SQL — `users.email` is `text('email')` in TypeScript with no
sign of the addr-spec pattern the column enforces.

So: a migration that adds a column nobody declared fails the build. A
declaration describing a column that does not exist fails the build. A
table declared in a package this file has never heard of is compared the day
it lands, because discovery is by directory, not by an import list. A CHECK
constraint added, renamed or rewritten fails the build until the inventory
records it — including a rewrite that only PostgreSQL's own rendering
notices.

What it does not compare: default _expressions_ (only their presence),
indexes, and foreign keys.
