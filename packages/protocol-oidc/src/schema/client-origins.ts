import { pgTable, primaryKey, text, uuid } from 'drizzle-orm/pg-core';

// One row per origin a client allows, in the form origins are compared in.
// Written by `clientOidcConfigRepository` whenever it writes the lists they
// derive from, and read by what a preflight asks of a tenant
// (packages/db/drizzle/0096_client_origins.sql).
export const clientOrigins = pgTable(
  'client_origins',
  {
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id').notNull(),
    origin: text('origin').notNull(),
  },
  (table) => [primaryKey({ columns: [table.clientId, table.origin] })],
);
