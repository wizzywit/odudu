import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are hand-authored SQL in drizzle/, never declared with pgPolicy():
// realms_isolation exists in every migrated database while
// meta/0002_snapshot.json records policies: {}, so generating DDL from this
// declaration emits a CREATE POLICY that fails 42710. The SQL is the
// schema's source of truth and this is a typed view of it
// (packages/db/README.md); rls-policy.int.test.ts stops a table shipping
// without a policy, schema-drift.int.test.ts stops the view drifting.
export const realms = pgTable('realms', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull().unique(),
  displayName: text('display_name'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
