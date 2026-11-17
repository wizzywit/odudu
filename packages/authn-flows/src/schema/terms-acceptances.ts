import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// The version of the tenant's terms a subject accepted, one row per subject and
// version (packages/db/drizzle/0136_more_required_actions.sql). The composite
// foreign key to subjects lives only in the migration.
export const subjectTermsAcceptances = pgTable(
  'subject_terms_acceptances',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    subjectId: uuid('subject_id').notNull(),
    version: text('version').notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.subjectId, table.version] })],
).enableRLS();
