import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// The address a subject has asked for and not yet proved: one row per subject
// (packages/db/drizzle/0127_pending_email_changes.sql), so a second request
// replaces the first. The composite foreign key to subjects lives only in the
// migration.
export const pendingEmailChanges = pgTable(
  'pending_email_changes',
  {
    tenantId: uuid('tenant_id').notNull(),
    subjectId: uuid('subject_id').notNull(),
    email: text('email').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subjectId] })],
).enableRLS();
