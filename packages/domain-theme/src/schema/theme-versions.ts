import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from '@odudu/db';
import { type ThemeBody } from '#/service/body';
import { type ThemeState } from '#/service/record';

// The foreign key to clients, the partial unique indexes and the policy are in
// packages/db/drizzle/0107_themes.sql (and the one-version index in 0110);
// drizzle-kit does not generate them.
export const themeVersions = pgTable(
  'theme_versions',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id'),
    state: text('state').$type<ThemeState>().notNull(),
    version: integer('version').notNull(),
    body: jsonb('body').$type<ThemeBody>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [index('theme_versions_by_scope').on(table.tenantId, table.clientId, table.state)],
).enableRLS();
