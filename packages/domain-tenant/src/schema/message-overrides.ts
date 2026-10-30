import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';

// Policy and the CHECKs on the locale shape and the lengths are in
// packages/db/drizzle/0108_tenant_locales.sql.
export const messageOverrides = pgTable(
  'message_overrides',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    key: text('key').notNull(),
    message: text('message').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.locale, table.key] })],
).enableRLS();
