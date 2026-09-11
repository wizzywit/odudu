import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are written as hand-authored SQL in drizzle/, never declared with
// pgPolicy(). meta/0002_snapshot.json records policies: {} while
// realms_isolation exists in every migrated database, so a declarative policy
// would make drizzle-kit generate a CREATE POLICY that fails 42710 against any
// database already carrying it. packages/db/tests/tenant-tables.int.test.ts is
// what stops a new table shipping without one.
export const realms = pgTable('realms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
