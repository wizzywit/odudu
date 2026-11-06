import { tenants } from '@odudu/db';
import { integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Policies are hand-authored SQL in packages/db/drizzle/, never declared
// with pgPolicy() — see @odudu/db's tenants.ts for why.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    route: text('route').notNull(),
    fingerprint: text('fingerprint').notNull(),
    status: text('status').notNull(),
    responseStatus: integer('response_status').notNull(),
    responseBody: text('response_body').notNull(),
    responseHeaders: jsonb('response_headers')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.tenantId, table.key, table.route] })],
).enableRLS();
