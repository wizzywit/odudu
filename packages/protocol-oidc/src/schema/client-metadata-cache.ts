import { tenants } from '@odudu/db';
import { jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see @odudu/db's tenants.ts for why.
export const clientMetadataCache = pgTable(
  'client_metadata_cache',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    body: jsonb('body').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.url] })],
).enableRLS();
