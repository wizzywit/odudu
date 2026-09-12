import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are hand-authored SQL in drizzle/, never declared with pgPolicy():
// realms_isolation exists in every migrated database while
// meta/0002_snapshot.json records policies: {}, so anything generating DDL
// from this declaration emits a CREATE POLICY that fails 42710 against a
// database already carrying it. The SQL in drizzle/ is the schema's source of
// truth and this declaration is a typed view of it — packages/db/README.md
// says why. packages/db/tests/rls-policy.int.test.ts is what stops a new
// table shipping without a policy; packages/db/tests/schema-drift.int.test.ts
// is what stops the view drifting from the migrated database.
export const realms = pgTable('realms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
